#!/usr/bin/env node
/**
 * #117/#119/#121/#125: join CDC PLACES 2025 release (GIS-friendly tract file, Socrata yjkw-uj5s) → adults ≥18:
 *   CASTHMA (current asthma, #117), DIABETES (diagnosed diabetes, #119), OBESITY (obesity, #121), MHLTH (frequent mental distress, #125) and PHLTH (frequent physical distress, #127) in one pass.
 *   node scripts/add-cdc-places.mjs public/data[/<city-id>] ...
 * Source (public domain, no key; download into gitignored data-raw/cdc-places/; NEVER commit the national CSV):
 *   curl -L -o data-raw/cdc-places/places-tract-2025-gis.csv \
 *     'https://data.cdc.gov/api/views/yjkw-uj5s/rows.csv?accessType=DOWNLOAD'
 *   (soft per-state alt: https://data.cdc.gov/resource/yjkw-uj5s.csv?stateabbr=FL&$limit=50000)
 * Headers matched case-insensitively. Exact names in the 2025 bulk export (recorded in meta.cdcPlaces.columns):
 *   join            ← TractFIPS          (padStart 11 ↔ pack geoid)
 *   pctAsthma       ← CASTHMA_CrudePrev  (crude prevalence, already 0–100 %; NOT age-adjusted; no /100)
 *   pctAsthmaLo/Hi  ← CASTHMA_Crude95CI  ("( 8.1, 10.3)")
 *   pctDiabetes     ← DIABETES_CrudePrev (#119; crude, 0–100 %)
 *   pctDiabetesLo/Hi← DIABETES_Crude95CI
 *   pctObesity      ← OBESITY_CrudePrev  (#121; crude, 0–100 %)
 *   pctObesityLo/Hi ← OBESITY_Crude95CI
 *   obesityAdultPop ← TotalPop18plus
 *   pctMentalHealth ← MHLTH_CrudePrev    (#125; crude, 0–100 %)
 *   pctMentalHealthLo/Hi ← MHLTH_Crude95CI
 *   mentalHealthAdultPop ← TotalPop18plus
 *   pctPhysicalHealth ← PHLTH_CrudePrev  (#127; crude, 0–100 %)
 *   pctPhysicalHealthLo/Hi ← PHLTH_Crude95CI
 *   physicalHealthAdultPop ← TotalPop18plus
 *   asthmaAdultPop / diabetesAdultPop ← TotalPop18plus (weights)
 * Blank / non-finite → prop absent (null ≠ 0).
 * meta.metricBreaks.{asthma,diabetes} = densityBreaks(values,5); meta.overall.pctAsthma/pctDiabetes = Σ(pct×pop18)/Σpop18 (adult-pop-weighted;
 * falls back to median tract % if no pop, logged); meta.overall.pct*Median = median tract %.
 * City-pack recipe: run after the FEMA / USDA steps. Build-time only — no runtime CDC/Socrata calls.
 */
import fs from 'node:fs'
import path from 'node:path'
import { densityBreaks } from './lib/geo-utils.mjs'
import { loadPacks, writePack, tractGeoid } from './lib/acs.mjs'
import { readPlaces, placesNum, parseCi } from './lib/places.mjs'

const DIR = process.env.PLACES_DIR || 'data-raw/cdc-places'
const CSV = process.env.PLACES_CSV || path.join(DIR, 'places-tract-2025-gis.csv')
const DOWNLOAD_URL = 'https://data.cdc.gov/api/views/yjkw-uj5s/rows.csv?accessType=DOWNLOAD'
const SOURCE_URL = 'https://data.cdc.gov/500-Cities-Places/PLACES-Census-Tract-Data-GIS-Friendly-Format-2025-/yjkw-uj5s'
const POP = 'totalpop18plus', JOIN = 'tractfips'
// #119: measures in one pass (append-only). metricId → meta.metricBreaks key; key → TractProps prefix.
const MEASURES = [
  { measure: 'CASTHMA', metricId: 'asthma', key: 'pctAsthma', popKey: 'asthmaAdultPop', value: 'casthma_crudeprev', ci: 'casthma_crude95ci' },
  { measure: 'DIABETES', metricId: 'diabetes', key: 'pctDiabetes', popKey: 'diabetesAdultPop', value: 'diabetes_crudeprev', ci: 'diabetes_crude95ci' },
  { measure: 'OBESITY', metricId: 'obesity', key: 'pctObesity', popKey: 'obesityAdultPop', value: 'obesity_crudeprev', ci: 'obesity_crude95ci' },
  { measure: 'MHLTH', metricId: 'mentalHealth', key: 'pctMentalHealth', popKey: 'mentalHealthAdultPop', value: 'mhlth_crudeprev', ci: 'mhlth_crude95ci' },
  { measure: 'PHLTH', metricId: 'physicalHealth', key: 'pctPhysicalHealth', popKey: 'physicalHealthAdultPop', value: 'phlth_crudeprev', ci: 'phlth_crude95ci' },
]
const dirs = process.argv.slice(2)
if (!dirs.length) throw new Error('usage: add-cdc-places.mjs <packDir> [...]')
if (!fs.existsSync(CSV)) throw new Error(`missing ${CSV} — curl -L -o ${CSV} '${DOWNLOAD_URL}'`)

const packs = loadPacks(dirs)
const want = new Set(packs.flatMap((p) => p.fc.features.map(tractGeoid)))
const { columns: cols, rows, total } = await readPlaces(CSV, [...MEASURES.flatMap((M) => [M.value, M.ci]), POP], want, JOIN)
const columns = { join: cols[JOIN], adultPop: cols[POP] }
for (const M of MEASURES) { columns[M.key] = cols[M.value]; columns[`${M.key}Ci`] = cols[M.ci] }
console.log(`[places] ${CSV}: ${total} rows; columns ${JSON.stringify(columns)}`)
const retrievedAt = process.env.PLACES_RETRIEVED || fs.statSync(CSV).mtime.toISOString().slice(0, 10)
const r1 = (x) => Math.round(x * 10) / 10
const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : r1((s[n / 2 - 1] + s[n / 2]) / 2)) : null }

for (const p of packs) {
  const m = p.meta
  m.metricBreaks = { ...(m.metricBreaks ?? {}) }
  for (const M of MEASURES) {
    const { key, popKey } = M
    const vals = []; let sw = 0, sp = 0, noPop = 0, sample = null
    for (const f of p.fc.features) {
      for (const k of [key, `${key}Lo`, `${key}Hi`, popKey]) delete f.properties[k]
      const r = rows.get(tractGeoid(f))
      const v = placesNum(r?.[M.value])
      if (v == null || v < 0 || v > 100) continue
      f.properties[key] = r1(v)
      vals.push(f.properties[key])
      if (!sample && tractGeoid(f).startsWith('12086')) sample = `${tractGeoid(f)}=${v}`
      const ci = parseCi(r[M.ci])
      if (ci) { f.properties[`${key}Lo`] = r1(ci[0]); f.properties[`${key}Hi`] = r1(ci[1]) }
      const pop = placesNum(r[POP])
      if (pop != null && pop > 0) { f.properties[popKey] = pop; sw += v * pop; sp += pop } else noPop++
    }
    m.metricBreaks[M.metricId] = densityBreaks(vals, 5)
    m.overall[`${key}Median`] = median(vals)
    if (sp > 0) m.overall[key] = r1(sw / sp)
    else { m.overall[key] = m.overall[`${key}Median`]; if (vals.length) console.warn(`[places] ${p.dir} ${M.measure}: no adult pop — overall falls back to median`) }
    const pct = p.fc.features.length ? ((vals.length / p.fc.features.length) * 100).toFixed(1) : '0'
    console.log(`[places] ${p.dir} ${M.measure}: ${vals.length}/${p.fc.features.length} joined (${pct}%), ${noPop} without adult pop, breaks ${JSON.stringify(m.metricBreaks[M.metricId])}, overall ${m.overall[key]}% (median ${m.overall[`${key}Median`]}%)${sample ? `, Miami-Dade check ${sample}` : ''}`)
  }
  // Shared release fields; `measure` kept for #117 back-compat, `measures` lists all joined.
  m.cdcPlaces = { release: '2025', measure: 'CASTHMA', measures: MEASURES.map((M) => M.measure), dataYear: 2023, valueType: 'crude', retrievedAt, sourceUrl: SOURCE_URL, columns }
  m.attribution = { ...m.attribution, cdcPlaces: 'CDC PLACES 2025 release (not endorsed by CDC or HHS)' }
  writePack(p)
}

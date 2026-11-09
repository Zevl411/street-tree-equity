#!/usr/bin/env node
/**
 * #117/#119/#121/#125: join CDC PLACES 2025 release (GIS-friendly tract file, Socrata yjkw-uj5s) → adults ≥18:
 *   CASTHMA (current asthma, #117), DIABETES (diagnosed diabetes, #119), OBESITY (obesity, #121), MHLTH (frequent mental distress, #125) PHLTH (frequent physical distress, #127), CHD (coronary heart disease, #129), BPHIGH (high blood pressure, #131) and LPA (no leisure-time physical activity / inactivity, #133) in one pass.
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
 *   pctChd ← CHD_CrudePrev  (#129; crude, 0–100 %)
 *   pctChdLo/Hi ← CHD_Crude95CI
 *   chdAdultPop ← TotalPop18plus
 *   pctBpHigh ← BPHIGH_CrudePrev  (#131; crude, 0–100 %)
 *   pctBpHighLo/Hi ← BPHIGH_Crude95CI
 *   bpHighAdultPop ← TotalPop18plus
 *   pctInactivity ← LPA_CrudePrev  (#133; crude, 0–100 %)
 *   pctInactivityLo/Hi ← LPA_Crude95CI
 *   inactivityAdultPop ← TotalPop18plus
 *   asthmaAdultPop / diabetesAdultPop ← TotalPop18plus (weights)
 *   #133: BRFSS year for LPA is read from PLACES Socrata column metadata (not hardcoded) → meta.cdcPlaces.years.LPA
 * Blank / non-finite → prop absent (null ≠ 0).
 * meta.metricBreaks.{asthma,diabetes} = densityBreaks(values,5); meta.overall.pctAsthma/pctDiabetes = Σ(pct×pop18)/Σpop18 (adult-pop-weighted;
 * falls back to median tract % if no pop, logged); meta.overall.pct*Median = median tract %.
 * City-pack recipe: run after the FEMA / USDA steps. Build-time only — browser never calls CDC/Socrata; build may read column metadata for BRFSS year (#133).
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
/** #133: BRFSS data year for LPA from PLACES Socrata column metadata (never hardcode). */
const COLUMNS_META_URL = 'https://data.cdc.gov/api/views/yjkw-uj5s/columns.json'
const COLUMNS_CACHE = path.join(DIR, 'yjkw-uj5s-columns.json')
async function resolveLpaYear() {
  if (process.env.PLACES_LPA_YEAR) {
    const y = Number(process.env.PLACES_LPA_YEAR)
    if (!Number.isFinite(y)) throw new Error(`PLACES_LPA_YEAR must be a year, got ${process.env.PLACES_LPA_YEAR}`)
    console.log(`[places] LPA BRFSS year ${y} (from PLACES_LPA_YEAR)`)
    return y
  }
  let cols
  try {
    const res = await fetch(COLUMNS_META_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    cols = await res.json()
    try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(COLUMNS_CACHE, JSON.stringify(cols)) } catch { /* cache best-effort */ }
  } catch (e) {
    if (fs.existsSync(COLUMNS_CACHE)) {
      cols = JSON.parse(fs.readFileSync(COLUMNS_CACHE, 'utf8'))
      console.warn(`[places] LPA year: live metadata failed (${e.message}); using cache ${COLUMNS_CACHE}`)
    } else {
      throw new Error(`#133: could not read PLACES column metadata for LPA BRFSS year (${e.message}). Set PLACES_LPA_YEAR or cache ${COLUMNS_CACHE}.`)
    }
  }
  const col = (cols || []).find((c) => String(c.fieldName || '').toLowerCase() === 'lpa_crudeprev')
  const desc = col?.description || ''
  const m = desc.match(/\b(19|20)\d{2}\b/)
  if (!m) throw new Error(`#133: no BRFSS year in LPA_CrudePrev description: ${JSON.stringify(desc)}`)
  const y = Number(m[0])
  console.log(`[places] LPA BRFSS year ${y} (from Socrata column metadata: ${desc})`)
  return y
}
// #119: measures in one pass (append-only). metricId → meta.metricBreaks key; key → TractProps prefix.
const MEASURES = [
  { measure: 'CASTHMA', metricId: 'asthma', key: 'pctAsthma', popKey: 'asthmaAdultPop', value: 'casthma_crudeprev', ci: 'casthma_crude95ci' },
  { measure: 'DIABETES', metricId: 'diabetes', key: 'pctDiabetes', popKey: 'diabetesAdultPop', value: 'diabetes_crudeprev', ci: 'diabetes_crude95ci' },
  { measure: 'OBESITY', metricId: 'obesity', key: 'pctObesity', popKey: 'obesityAdultPop', value: 'obesity_crudeprev', ci: 'obesity_crude95ci' },
  { measure: 'MHLTH', metricId: 'mentalHealth', key: 'pctMentalHealth', popKey: 'mentalHealthAdultPop', value: 'mhlth_crudeprev', ci: 'mhlth_crude95ci' },
  { measure: 'PHLTH', metricId: 'physicalHealth', key: 'pctPhysicalHealth', popKey: 'physicalHealthAdultPop', value: 'phlth_crudeprev', ci: 'phlth_crude95ci' },
  { measure: 'CHD', metricId: 'chd', key: 'pctChd', popKey: 'chdAdultPop', value: 'chd_crudeprev', ci: 'chd_crude95ci' },
  { measure: 'BPHIGH', metricId: 'bphigh', key: 'pctBpHigh', popKey: 'bpHighAdultPop', value: 'bphigh_crudeprev', ci: 'bphigh_crude95ci' },
  { measure: 'LPA', metricId: 'inactivity', key: 'pctInactivity', popKey: 'inactivityAdultPop', value: 'lpa_crudeprev', ci: 'lpa_crude95ci' },
]
const dirs = process.argv.slice(2)
if (!dirs.length) throw new Error('usage: add-cdc-places.mjs <packDir> [...]')
if (!fs.existsSync(CSV)) throw new Error(`missing ${CSV} — curl -L -o ${CSV} '${DOWNLOAD_URL}'`)

const packs = loadPacks(dirs)
const lpaYear = await resolveLpaYear()
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
  m.cdcPlaces = { release: '2025', measure: 'CASTHMA', measures: MEASURES.map((M) => M.measure), dataYear: 2023, valueType: 'crude', retrievedAt, sourceUrl: SOURCE_URL, columns, years: { ...(m.cdcPlaces?.years ?? {}), LPA: lpaYear } }
  m.attribution = { ...m.attribution, cdcPlaces: 'CDC PLACES 2025 release (not endorsed by CDC or HHS)' }
  writePack(p)
}

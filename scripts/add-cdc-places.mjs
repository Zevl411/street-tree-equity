#!/usr/bin/env node
/**
 * #117: join CDC PLACES 2025 release (GIS-friendly tract file, Socrata yjkw-uj5s) → current asthma among adults ≥18.
 *   node scripts/add-cdc-places.mjs public/data[/<city-id>] ...
 * Source (public domain, no key; download into gitignored data-raw/cdc-places/; NEVER commit the national CSV):
 *   curl -L -o data-raw/cdc-places/places-tract-2025-gis.csv \
 *     'https://data.cdc.gov/api/views/yjkw-uj5s/rows.csv?accessType=DOWNLOAD'
 *   (soft per-state alt: https://data.cdc.gov/resource/yjkw-uj5s.csv?stateabbr=FL&$limit=50000)
 * Headers matched case-insensitively. Exact names in the 2025 bulk export (recorded in meta.cdcPlaces.columns):
 *   join            ← TractFIPS          (padStart 11 ↔ pack geoid)
 *   pctAsthma       ← CASTHMA_CrudePrev  (crude prevalence, already 0–100 %; NOT age-adjusted; no /100)
 *   pctAsthmaLo/Hi  ← CASTHMA_Crude95CI  ("( 8.1, 10.3)")
 *   asthmaAdultPop  ← TotalPop18plus     (weights)
 * Blank / non-finite → prop absent (null ≠ 0).
 * meta.metricBreaks.asthma = densityBreaks(values,5); meta.overall.pctAsthma = Σ(pct×pop18)/Σpop18 (adult-pop-weighted;
 * falls back to median tract % if no pop, logged); meta.overall.pctAsthmaMedian = median tract %.
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
const VALUE = 'casthma_crudeprev', CI = 'casthma_crude95ci', POP = 'totalpop18plus', JOIN = 'tractfips'
const dirs = process.argv.slice(2)
if (!dirs.length) throw new Error('usage: add-cdc-places.mjs <packDir> [...]')
if (!fs.existsSync(CSV)) throw new Error(`missing ${CSV} — curl -L -o ${CSV} '${DOWNLOAD_URL}'`)

const packs = loadPacks(dirs)
const want = new Set(packs.flatMap((p) => p.fc.features.map(tractGeoid)))
const { columns: cols, rows, total } = await readPlaces(CSV, [VALUE, CI, POP], want, JOIN)
const columns = { join: cols[JOIN], pctAsthma: cols[VALUE], ci: cols[CI], asthmaAdultPop: cols[POP] }
console.log(`[places] ${CSV}: ${total} rows; columns ${JSON.stringify(columns)}`)
const retrievedAt = process.env.PLACES_RETRIEVED || fs.statSync(CSV).mtime.toISOString().slice(0, 10)
const r1 = (x) => Math.round(x * 10) / 10
const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : r1((s[n / 2 - 1] + s[n / 2]) / 2)) : null }
const KEYS = ['pctAsthma', 'pctAsthmaLo', 'pctAsthmaHi', 'asthmaAdultPop']

for (const p of packs) {
  const vals = []; let sw = 0, sp = 0, noPop = 0
  for (const f of p.fc.features) {
    for (const k of KEYS) delete f.properties[k]
    const r = rows.get(tractGeoid(f))
    const v = placesNum(r?.[VALUE])
    if (v == null || v < 0 || v > 100) continue
    f.properties.pctAsthma = r1(v)
    vals.push(f.properties.pctAsthma)
    const ci = parseCi(r[CI])
    if (ci) { f.properties.pctAsthmaLo = r1(ci[0]); f.properties.pctAsthmaHi = r1(ci[1]) }
    const pop = placesNum(r[POP])
    if (pop != null && pop > 0) { f.properties.asthmaAdultPop = pop; sw += v * pop; sp += pop } else noPop++
  }
  const m = p.meta
  m.metricBreaks = { ...(m.metricBreaks ?? {}), asthma: densityBreaks(vals, 5) }
  m.overall.pctAsthmaMedian = median(vals)
  if (sp > 0) m.overall.pctAsthma = r1(sw / sp)
  else { m.overall.pctAsthma = m.overall.pctAsthmaMedian; if (vals.length) console.warn(`[places] ${p.dir}: no adult pop — overall falls back to median`) }
  m.cdcPlaces = { release: '2025', measure: 'CASTHMA', dataYear: 2023, valueType: 'crude', retrievedAt, sourceUrl: SOURCE_URL, columns }
  m.attribution = { ...m.attribution, cdcPlaces: 'CDC PLACES 2025 release (not endorsed by CDC or HHS)' }
  writePack(p)
  const pct = p.fc.features.length ? ((vals.length / p.fc.features.length) * 100).toFixed(1) : '0'
  console.log(`[places] ${p.dir}: ${vals.length}/${p.fc.features.length} joined (${pct}%), ${noPop} without adult pop, breaks ${JSON.stringify(m.metricBreaks.asthma)}, overall ${m.overall.pctAsthma}% (median ${m.overall.pctAsthmaMedian}%)`)
}

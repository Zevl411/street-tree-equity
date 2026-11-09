#!/usr/bin/env node
/**
 * #117/#119/#121/#125: join CDC PLACES 2025 release (GIS-friendly tract file, Socrata yjkw-uj5s) → adults ≥18:
 *   CASTHMA (current asthma, #117), DIABETES (diagnosed diabetes, #119), OBESITY (obesity, #121), MHLTH (frequent mental distress, #125) PHLTH (frequent physical distress, #127), CHD (coronary heart disease, #129), BPHIGH (high blood pressure, #131) LPA (no leisure-time physical activity / inactivity, #133), COPD (chronic obstructive pulmonary disease, #136), CSMOKING (current cigarette smoking, #138), STROKE (stroke, #141), DISABILITY (any disability, #143), SLEEP (short sleep duration, #144; BRFSS 2022 even-year core) and ACCESS2 (lack of health insurance, ages 18–64, #146) in one pass.
 *   node scripts/add-cdc-places.mjs public/data[/<city-id>] ...
 *   #150 incremental join: PLACES_MEASURES=DEPRESSION preserves all existing tract fields.
 *   DEPRESSION is ever-diagnosed depression among adults (not MHLTH frequent mental distress).
 *   pctDepression / pctDepressionLo/Hi / depressionAdultPop use the same crude reader and weights.
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
 *   pctCopd ← COPD_CrudePrev  (#136; crude, 0–100 %)
 *   pctCopdLo/Hi ← COPD_Crude95CI
 *   copdAdultPop ← TotalPop18plus
 *   pctSmoking ← CSMOKING_CrudePrev  (#138; crude, 0–100 %)
 *   pctSmokingLo/Hi ← CSMOKING_Crude95CI
 *   smokingAdultPop ← TotalPop18plus
 *   pctStroke ← STROKE_CrudePrev  (#141; crude, 0–100 %)
 *   pctStrokeLo/Hi ← STROKE_Crude95CI
 *   strokeAdultPop ← TotalPop18plus
 *   pctDisability ← DISABILITY_CrudePrev  (#143; crude, 0–100 %)
 *   pctDisabilityLo/Hi ← DISABILITY_Crude95CI
 *   disabilityAdultPop ← TotalPop18plus
 *   pctShortSleep ← SLEEP_CrudePrev  (#144; crude, 0–100 %)
 *   pctShortSleepLo/Hi ← SLEEP_Crude95CI
 *   shortSleepAdultPop ← TotalPop18plus
 *   pctUninsured ← ACCESS2_CrudePrev  (#146; ages 18–64, crude, 0–100 %)
 *   pctUninsuredLo/Hi ← ACCESS2_Crude95CI
 *   uninsuredAdultPop ← TotalPop18plus (adults 18+ proxy weight for the 18–64 measure)
 *   Methods (#146): Pack aggregates weight by adults 18+; ACCESS2 covers 18–64.
 *   The GIS file has no 18–64 denominator; no ACS-derived denominator is introduced.
 *   asthmaAdultPop / diabetesAdultPop ← TotalPop18plus (weights)
 *   #133/#136/#138: BRFSS years for ALL measures from PLACES Socrata column metadata (not hardcoded) → meta.cdcPlaces.years.*
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
/** #133/#136: BRFSS data year from PLACES Socrata column metadata (never hardcode). Prefer year adjacent to "BRFSS". */
const COLUMNS_META_URL = 'https://data.cdc.gov/api/views/yjkw-uj5s/columns.json'
const COLUMNS_CACHE = path.join(DIR, 'yjkw-uj5s-columns.json')
let _placesColumnsMeta = null
async function loadPlacesColumnsMeta() {
  if (_placesColumnsMeta) return _placesColumnsMeta
  try {
    const res = await fetch(COLUMNS_META_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    _placesColumnsMeta = await res.json()
    try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(COLUMNS_CACHE, JSON.stringify(_placesColumnsMeta)) } catch { /* cache best-effort */ }
  } catch (e) {
    if (fs.existsSync(COLUMNS_CACHE)) {
      _placesColumnsMeta = JSON.parse(fs.readFileSync(COLUMNS_CACHE, 'utf8'))
      console.warn(`[places] column metadata: live fetch failed (${e.message}); using cache ${COLUMNS_CACHE}`)
    } else {
      throw e
    }
  }
  return _placesColumnsMeta
}
/** Prefer 4-digit year next to "BRFSS"; else first year in the description (TL soft nit #136). */
function yearFromPlacesDesc(desc) {
  const brfss = desc.match(/BRFSS[^0-9]{0,24}((?:19|20)\d{2})/i) || desc.match(/((?:19|20)\d{2})[^0-9]{0,24}BRFSS/i)
  if (brfss) return Number(brfss[1])
  const m = desc.match(/\b((?:19|20)\d{2})\b/)
  return m ? Number(m[1]) : null
}
async function resolvePlacesMeasureYear(measure, fieldName, envKey) {
  if (process.env[envKey]) {
    const y = Number(process.env[envKey])
    if (!Number.isFinite(y)) throw new Error(`${envKey} must be a year, got ${process.env[envKey]}`)
    console.log(`[places] ${measure} BRFSS year ${y} (from ${envKey})`)
    return y
  }
  let cols
  try {
    cols = await loadPlacesColumnsMeta()
  } catch (e) {
    throw new Error(`#133/#136: could not read PLACES column metadata for ${measure} BRFSS year (${e.message}). Set ${envKey} or cache ${COLUMNS_CACHE}.`)
  }
  const col = (cols || []).find((c) => String(c.fieldName || '').toLowerCase() === fieldName.toLowerCase())
  const desc = col?.description || ''
  const y = yearFromPlacesDesc(desc)
  if (y == null) throw new Error(`#133/#136: no BRFSS year in ${fieldName} description: ${JSON.stringify(desc)}`)
  console.log(`[places] ${measure} BRFSS year ${y} (from Socrata column metadata: ${desc})`)
  return y
}
// #150: DEPRESSION appends after ACCESS2; UI order is separate. metricId → meta.metricBreaks key; key → TractProps prefix.
const MEASURES = [
  { measure: 'CASTHMA', metricId: 'asthma', key: 'pctAsthma', popKey: 'asthmaAdultPop', value: 'casthma_crudeprev', ci: 'casthma_crude95ci' },
  { measure: 'DIABETES', metricId: 'diabetes', key: 'pctDiabetes', popKey: 'diabetesAdultPop', value: 'diabetes_crudeprev', ci: 'diabetes_crude95ci' },
  { measure: 'OBESITY', metricId: 'obesity', key: 'pctObesity', popKey: 'obesityAdultPop', value: 'obesity_crudeprev', ci: 'obesity_crude95ci' },
  { measure: 'MHLTH', metricId: 'mentalHealth', key: 'pctMentalHealth', popKey: 'mentalHealthAdultPop', value: 'mhlth_crudeprev', ci: 'mhlth_crude95ci' },
  { measure: 'PHLTH', metricId: 'physicalHealth', key: 'pctPhysicalHealth', popKey: 'physicalHealthAdultPop', value: 'phlth_crudeprev', ci: 'phlth_crude95ci' },
  { measure: 'CHD', metricId: 'chd', key: 'pctChd', popKey: 'chdAdultPop', value: 'chd_crudeprev', ci: 'chd_crude95ci' },
  { measure: 'BPHIGH', metricId: 'bphigh', key: 'pctBpHigh', popKey: 'bpHighAdultPop', value: 'bphigh_crudeprev', ci: 'bphigh_crude95ci' },
  { measure: 'LPA', metricId: 'inactivity', key: 'pctInactivity', popKey: 'inactivityAdultPop', value: 'lpa_crudeprev', ci: 'lpa_crude95ci' },
  { measure: 'COPD', metricId: 'copd', key: 'pctCopd', popKey: 'copdAdultPop', value: 'copd_crudeprev', ci: 'copd_crude95ci' },
  { measure: 'CSMOKING', metricId: 'smoking', key: 'pctSmoking', popKey: 'smokingAdultPop', value: 'csmoking_crudeprev', ci: 'csmoking_crude95ci' },
  { measure: 'STROKE', metricId: 'stroke', key: 'pctStroke', popKey: 'strokeAdultPop', value: 'stroke_crudeprev', ci: 'stroke_crude95ci' },
  { measure: 'DISABILITY', metricId: 'disability', key: 'pctDisability', popKey: 'disabilityAdultPop', value: 'disability_crudeprev', ci: 'disability_crude95ci' },
  { measure: 'SLEEP', metricId: 'shortSleep', key: 'pctShortSleep', popKey: 'shortSleepAdultPop', value: 'sleep_crudeprev', ci: 'sleep_crude95ci' },
  { measure: 'ACCESS2', metricId: 'uninsured', key: 'pctUninsured', popKey: 'uninsuredAdultPop', value: 'access2_crudeprev', ci: 'access2_crude95ci' },
  { measure: 'DEPRESSION', metricId: 'depression', key: 'pctDepression', popKey: 'depressionAdultPop', value: 'depression_crudeprev', ci: 'depression_crude95ci' },
]
// Selective backfills must not delete/reinsert unrelated fields or change their bytes/order.
const requestedMeasures = process.env.PLACES_MEASURES ? new Set(process.env.PLACES_MEASURES.split(',').map((m) => m.trim())) : null
const selectedMeasures = requestedMeasures ? MEASURES.filter((M) => requestedMeasures.has(M.measure)) : MEASURES
if (requestedMeasures && requestedMeasures.size !== selectedMeasures.length) throw new Error(`Unknown PLACES_MEASURES: ${[...requestedMeasures].filter((m) => !MEASURES.some((M) => M.measure === m)).join(', ')}`)
const dirs = process.argv.slice(2)
if (!dirs.length) throw new Error('usage: add-cdc-places.mjs <packDir> [...]')
if (!fs.existsSync(CSV)) throw new Error(`missing ${CSV} — curl -L -o ${CSV} '${DOWNLOAD_URL}'`)

const packs = loadPacks(dirs)
const placesYears = {}
for (const M of selectedMeasures) {
  placesYears[M.measure] = await resolvePlacesMeasureYear(M.measure, M.value, `PLACES_${M.measure}_YEAR`)
}
console.log(`[places] BRFSS years ${JSON.stringify(placesYears)}`)
const want = new Set(packs.flatMap((p) => p.fc.features.map(tractGeoid)))
const { columns: cols, rows, total } = await readPlaces(CSV, [...selectedMeasures.flatMap((M) => [M.value, M.ci]), POP], want, JOIN)
const columns = { join: cols[JOIN], adultPop: cols[POP] }
for (const M of selectedMeasures) { columns[M.key] = cols[M.value]; columns[`${M.key}Ci`] = cols[M.ci] }
console.log(`[places] ${CSV}: ${total} rows; columns ${JSON.stringify(columns)}`)
// #150 gate: validate every requested tract before mutating/writing any pack. No fallback.
if (selectedMeasures.some((M) => M.measure === 'DEPRESSION')) {
  const missing = [...want].filter((id) => { const v = placesNum(rows.get(id)?.depression_crudeprev); return v == null || v < 0 || v > 100 })
  if (missing.length) throw new Error(`STOP: DEPRESSION coverage ${want.size - missing.length}/${want.size}; missing ${missing.join(', ')}. GHLTH requires TL approval.`)
}
const retrievedAt = process.env.PLACES_RETRIEVED || fs.statSync(CSV).mtime.toISOString().slice(0, 10)
const r1 = (x) => Math.round(x * 10) / 10
const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : r1((s[n / 2 - 1] + s[n / 2]) / 2)) : null }

for (const p of packs) {
  const m = p.meta
  m.metricBreaks = { ...(m.metricBreaks ?? {}) }
  for (const M of selectedMeasures) {
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
  m.cdcPlaces = { release: '2025', measure: 'CASTHMA', measures: MEASURES.filter((M) => selectedMeasures.includes(M) || (m.cdcPlaces?.measures ?? []).includes(M.measure)).map((M) => M.measure), valueType: 'crude', retrievedAt, sourceUrl: SOURCE_URL, columns: { ...(m.cdcPlaces?.columns ?? {}), ...columns }, weightsNote: 'Pack aggregates weight by adults 18+; ACCESS2 covers 18–64', years: { ...(m.cdcPlaces?.years ?? {}), ...placesYears } }
  m.attribution = { ...m.attribution, cdcPlaces: 'CDC PLACES 2025 release (not endorsed by CDC or HHS)' }
  writePack(p)
}
// #136/#138/#141/#143/#144/#146 locked check row (central-miami-fl pack)
for (const p of packs) {
  if (!p.dir.includes('central-miami')) continue
  const f = p.fc.features.find((x) => tractGeoid(x) === '12086002404')
  if (f) {
    console.log(`[places] #136 check 12086002404 pctCopd=${f.properties.pctCopd} CI=(${f.properties.pctCopdLo}, ${f.properties.pctCopdHi}) pop=${f.properties.copdAdultPop}`)
    console.log(`[places] #138 check 12086002404 pctSmoking=${f.properties.pctSmoking} CI=(${f.properties.pctSmokingLo}, ${f.properties.pctSmokingHi}) pop=${f.properties.smokingAdultPop}`)
    console.log(`[places] #141 check 12086002404 pctStroke=${f.properties.pctStroke} CI=(${f.properties.pctStrokeLo}, ${f.properties.pctStrokeHi}) pop=${f.properties.strokeAdultPop}`)
    console.log(`[places] #143 check 12086002404 pctDisability=${f.properties.pctDisability} CI=(${f.properties.pctDisabilityLo}, ${f.properties.pctDisabilityHi}) pop=${f.properties.disabilityAdultPop}`)
    console.log(`[places] #144 check 12086002404 pctShortSleep=${f.properties.pctShortSleep} CI=(${f.properties.pctShortSleepLo}, ${f.properties.pctShortSleepHi}) pop=${f.properties.shortSleepAdultPop}`)
    console.log(`[places] #150 check 12086002404 pctDepression=${f.properties.pctDepression} CI=(${f.properties.pctDepressionLo}, ${f.properties.pctDepressionHi}) pop=${f.properties.depressionAdultPop}`)
    console.log(`[places] #146 check 12086002404 pctUninsured=${f.properties.pctUninsured} CI=(${f.properties.pctUninsuredLo}, ${f.properties.pctUninsuredHi}) adults18plusWeight=${f.properties.uninsuredAdultPop}`)
  } else console.warn('[places] #136/#138/#141/#143/#144/#146 check tract 12086002404 not in pack', p.dir)
}

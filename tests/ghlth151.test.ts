import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { stripTypeScriptTypes } from 'node:module'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { Meta, TractCollection, TractProps } from '../src/types.ts'
import { METRIC_IDS, METRIC_SWITCH_ORDER, resolveMetric } from '../src/utils/metrics.ts'
import { PLACES_MEASURES, PLACES_DATA_IDS, PLACES_METRIC_IDS, placesMetricCitation } from '../src/utils/placesMeasures.ts'
import { SNAPSHOT_EXCLUDED_METRICS, SNAPSHOT_CANDIDATE_METRICS } from '../src/utils/tractSnapshot.ts'
import { CSV_HEADERS, PLACES_EXPORT, csvRow, toCsv } from '../src/utils/fullCsv.ts'
import { GAP_COLUMNS, gapCells, scenarioProps } from '../src/utils/canopyGap.ts'
// @ts-ignore Build-only CSV helpers; tests use temp fixtures, never ignored raw files/network.
import { readPlaces, splitCsv, parseCi, placesNum } from '../scripts/lib/places.mjs'

const baseline = JSON.parse(readFileSync(new URL('fixtures/ghlth151-baseline.json', import.meta.url), 'utf8'))
const fields = ['pctGeneralHealth', 'pctGeneralHealthLo', 'pctGeneralHealthHi', 'generalHealthAdultPop'] as const
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const load = (d: string): { fc: TractCollection; meta: Meta } => ({
  fc: JSON.parse(readFileSync(`${d}/tracts-equity.geojson`, 'utf8')),
  meta: JSON.parse(readFileSync(`${d}/meta.json`, 'utf8')),
})
for (const [dir, expected] of Object.entries(baseline.packs) as [string, any][]) {
  test(`#151 ${dir}: full coverage and strip-new-props restores exact main bytes/geometry/metadata`, () => {
    const { fc, meta } = load(dir)
    assert.equal(fc.features.length, expected.n)
    for (const { properties: p } of fc.features) {
      for (const k of fields) assert.ok(Number.isFinite(p[k]), `${p.geoid} ${k}`)
      assert.ok(0 <= p.pctGeneralHealthLo! && p.pctGeneralHealthLo! <= p.pctGeneralHealth! && p.pctGeneralHealth! <= p.pctGeneralHealthHi! && p.pctGeneralHealthHi! <= 100)
      assert.ok(Number.isInteger(p.generalHealthAdultPop) && p.generalHealthAdultPop! > 0)
    }
    let raw = readFileSync(`${dir}/tracts-equity.geojson`, 'utf8')
    for (const key of fields) {
      const re = new RegExp(String.raw`,"${key}":-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?`, 'g')
      assert.equal([...raw.matchAll(re)].length, expected.n)
      raw = raw.replace(re, '')
    }
    assert.equal(hash(raw), expected.tractSha256, 'byte-for-byte old one-line file, not merely numeric equality')
    assert.equal(hash(JSON.stringify(fc.features.map(f => f.geometry))), expected.geometrySha256)
    assert.equal(meta.cdcPlaces!.years!.GHLTH, baseline.source.brfssYear)
    assert.equal('dataYear' in meta.cdcPlaces!, false)
    assert.equal(meta.cdcPlaces!.measures!.at(-1), 'GHLTH')
    assert.deepEqual(meta.cdcPlaces!.columns.pctGeneralHealth, 'ghlth_crudeprev')
    const p = fc.features.map(f => f.properties), sum = p.reduce((a, t) => a + t.pctGeneralHealth! * t.generalHealthAdultPop!, 0), pop = p.reduce((a, t) => a + t.generalHealthAdultPop!, 0)
    assert.equal(meta.overall.pctGeneralHealth, Math.round(sum / pop * 10) / 10)
    assert.ok(meta.metricBreaks!.generalHealth!.length > 0)
    const old = structuredClone(meta)
    delete old.metricBreaks!.generalHealth; delete old.overall.pctGeneralHealth; delete old.overall.pctGeneralHealthMedian
    delete old.cdcPlaces!.years!.GHLTH; delete old.cdcPlaces!.columns.pctGeneralHealth; delete old.cdcPlaces!.columns.pctGeneralHealthCi
    old.cdcPlaces!.measures = old.cdcPlaces!.measures!.filter(m => m !== 'GHLTH')
    assert.equal(hash(JSON.stringify(old)), expected.metaSha256, 'only new GHLTH metadata changed')
  })
}
test('#151 all 464 tracts and three independent Socrata check rows match including CI/pop/year', () => {
  const tracts = Object.keys(baseline.packs).flatMap(d => load(d).fc.features.map(f => f.properties))
  assert.equal(tracts.length, 464)
  for (const e of baseline.source.checks) {
    const p = tracts.find(t => t.geoid === e.geoid)!
    assert.deepEqual([p.pctGeneralHealth, p.pctGeneralHealthLo, p.pctGeneralHealthHi, p.generalHealthAdultPop], [e.value, ...e.ci, e.adultPop])
    assert.match(e.url, /data\.cdc\.gov\/resource\/yjkw-uj5s\.json/)
  }
  assert.deepEqual(baseline.source.checks[0].ci, [39.2, 50.7])
  assert.equal(baseline.source.checks[0].value, 44.8)
})
test('#151 prepared single shared map and CI key do not expose any new unlocked UI or snapshot exclusion', () => {
  assert.equal(PLACES_DATA_IDS.length, 16); assert.equal(PLACES_DATA_IDS.at(-1), 'generalHealth')
  assert.equal(PLACES_MEASURES.generalHealth![0], 'GHLTH')
  assert.equal(PLACES_MEASURES.generalHealth![1], 'Fair or poor self-rated health status among adults')
  assert.equal(PLACES_METRIC_IDS.length, 15)
  assert.ok(!(PLACES_METRIC_IDS as readonly string[]).includes('generalHealth'))
  assert.ok(!(METRIC_IDS as readonly string[]).includes('generalHealth'))
  assert.ok(!(METRIC_SWITCH_ORDER as readonly string[]).includes('generalHealth'))
  assert.ok(!(SNAPSHOT_EXCLUDED_METRICS as readonly string[]).includes('generalHealth'))
  assert.equal(SNAPSHOT_CANDIDATE_METRICS.length, 24)
  assert.equal(resolveMetric('generalHealth'), null)
  for (const [file, sha] of Object.entries(baseline.uiSha256)) assert.equal(hash(readFileSync(file, 'utf8')), sha, file)
  assert.match(readFileSync('src/utils/currentViewCsv.ts', 'utf8'), /const CI_KEYS[^\n]*'pctGeneralHealth'/)
  assert.match(placesMetricCitation('generalHealth', { GHLTH: 2042 })!, /BRFSS 2042/)
  assert.doesNotMatch(placesMetricCitation('generalHealth', {})!, /BRFSS|undefined|2023/)
})
test('#151 full CSV109 retains all106 old headers, appends GHLTH triple after depression, and every cell aligns in all packs/both targets', () => {
  assert.equal(CSV_HEADERS.length, 109); assert.equal(new Set(CSV_HEADERS).size, 109)
  assert.deepEqual(CSV_HEADERS.filter(h => !h.startsWith('pct_general_health')), baseline.legacyCsvHeaders)
  assert.deepEqual(CSV_HEADERS.slice(87, 90), ['pct_general_health', 'pct_general_health_ci_lo', 'pct_general_health_ci_hi'])
  assert.deepEqual(PLACES_EXPORT.at(-1), ['general_health', 'pctGeneralHealth'])
  for (const dir of Object.keys(baseline.packs)) {
    const { fc, meta } = load(dir)
    for (const mode of ['p75', '30'] as const) {
      const [h, ...rows] = toCsv(fc.features.map(f => f.properties), meta, mode).trimEnd().split('\r\n').map(splitCsv)
      assert.equal(rows.length, fc.features.length)
      rows.forEach((row: string[], i: number) => {
        assert.equal(row.length, h.length)
        for (const [header, key] of [['pct_general_health', 'pctGeneralHealth'], ['pct_general_health_ci_lo', 'pctGeneralHealthLo'], ['pct_general_health_ci_hi', 'pctGeneralHealthHi']] as const) assert.equal(row[h.indexOf(header)], String(fc.features[i].properties[key]))
      })
    }
  }
  const meta = load('public/data').meta
  for (const [value, expected] of [[undefined, ''], [0, '0']] as const) {
    const row = splitCsv(csvRow({ geoid: 'null-or-zero', pctGeneralHealth: value, pctGeneralHealthLo: value, pctGeneralHealthHi: value } as TractProps, meta))
    for (const h of CSV_HEADERS.slice(87, 90)) assert.equal(row[CSV_HEADERS.indexOf(h)], expected)
  }
})
function fixture(dir: string, value: string | number = 44.8) {
  const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,0]]] }, properties: { geoid: '12086002404', name: 'Tract 24.04', canopyPct: 10.479882237487733, landAcres: 226.6226626943888, pctDepression: 14.1, plantNeed: 42 } }] }
  const meta = { overall: { pctDepression: 14.1 }, metricBreaks: { depression: [1,2] }, cdcPlaces: { measures: ['DEPRESSION'], years: { DEPRESSION: 2023 }, columns: { pctDepression: 'depression_crudeprev' } } }
  writeFileSync(join(dir, 'tracts-equity.geojson'), JSON.stringify(fc)); writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta))
  const csv = join(dir, 'source.csv'), ci = value === 0 ? '( 0.0, 0.0)' : '( 39.2, 50.7)'
  writeFileSync(csv, `TractFIPS,GHLTH_CrudePrev,GHLTH_Crude95CI,TotalPop18plus\n12086002404,${value},"${ci}",4491\n`)
  return { fc, env: { ...process.env, PLACES_MEASURES: 'GHLTH', PLACES_GHLTH_YEAR: '2023', PLACES_CSV: csv, PLACES_DIR: dir } }
}
test('#151 existing generic reader accepts GHLTH mixed-case headers and padded CI; zero is not missing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ste-ghlth-reader-'))
  try {
    const { env } = fixture(dir), { columns, rows } = await readPlaces(env.PLACES_CSV, ['ghlth_crudeprev', 'ghlth_crude95ci', 'totalpop18plus'], new Set(['12086002404']))
    assert.equal(columns.ghlth_crudeprev, 'GHLTH_CrudePrev')
    assert.equal(placesNum(rows.get('12086002404').ghlth_crudeprev), 44.8)
    assert.deepEqual(parseCi(rows.get('12086002404').ghlth_crude95ci), [39.2,50.7])
    assert.equal(placesNum('0'), 0); assert.equal(placesNum(''), null)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
for (const value of [44.8, 0]) test(`#151 incremental GHLTH join preserves every old property and merges years; value${value}`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'ste-ghlth-join-'))
  try {
    const { fc, env } = fixture(dir, value)
    execFileSync(process.execPath, ['scripts/add-cdc-places.mjs', dir], { env, stdio: 'pipe' })
    const { fc: out, meta } = load(dir), t = out.features[0].properties
    assert.equal(t.pctGeneralHealth, value); assert.equal(t.generalHealthAdultPop, 4491)
    assert.deepEqual([t.pctGeneralHealthLo, t.pctGeneralHealthHi], value === 0 ? [0,0] : [39.2,50.7])
    for (const k of fields) delete t[k]
    assert.equal(JSON.stringify(out), JSON.stringify(fc))
    assert.deepEqual(meta.cdcPlaces!.years, { DEPRESSION: 2023, GHLTH: 2023 })
    assert.deepEqual(meta.cdcPlaces!.measures, ['DEPRESSION', 'GHLTH'])
    assert.equal(meta.overall.pctDepression, 14.1); assert.equal('dataYear' in meta.cdcPlaces!, false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
for (const value of ['', -1, 101]) test(`#151 missing/invalid GHLTH stops before any pack write: ${JSON.stringify(value)}`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'ste-ghlth-missing-'))
  try {
    const { env } = fixture(dir, value), before = readFileSync(join(dir, 'tracts-equity.geojson'), 'utf8'), metaBefore = readFileSync(join(dir, 'meta.json'), 'utf8')
    assert.throws(() => execFileSync(process.execPath, ['scripts/add-cdc-places.mjs', dir], { env, stdio: 'pipe' }), /STOP: GHLTH coverage 0\/1/)
    assert.equal(readFileSync(join(dir, 'tracts-equity.geojson'), 'utf8'), before)
    assert.equal(readFileSync(join(dir, 'meta.json'), 'utf8'), metaBefore)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
test('#151 GeoJSON data triple is numeric/null/zero and geometry is untouched', () => {
  const src = readFileSync('src/utils/exportData.ts', 'utf8'), fn = src.slice(src.indexOf('export function toGeoJson('), src.indexOf('/** #64:'))
  const geo = new Function('GAP_COLUMNS', 'gapCells', 'scenarioProps', 'ODBL_NOTICE', stripTypeScriptTypes(fn.replace('export function', 'function')) + ';return toGeoJson')(GAP_COLUMNS, gapCells, scenarioProps, 'ODbL')
  const { fc, meta } = load('public/data/central-miami-fl'), out = JSON.parse(geo(fc, meta))
  out.features.forEach((f: any, i: number) => {
    const t = fc.features[i].properties
    assert.deepEqual([f.properties.pct_general_health, f.properties.pct_general_health_ci_lo, f.properties.pct_general_health_ci_hi], [t.pctGeneralHealth, t.pctGeneralHealthLo, t.pctGeneralHealthHi])
    assert.deepEqual(f.geometry, fc.features[i].geometry)
  })
  const f = fc.features[0], empty = JSON.parse(geo({ ...fc, features: [undefined, 0].map(v => ({ ...f, properties: { ...f.properties, pctGeneralHealth: v, pctGeneralHealthLo: v, pctGeneralHealthHi: v } })) }, meta))
  assert.deepEqual(empty.features.map((f: any) => [f.properties.pct_general_health, f.properties.pct_general_health_ci_lo, f.properties.pct_general_health_ci_hi]), [[null,null,null],[0,0,0]])
})
test('#151 both independent softs: all Hotspots titles wrap and snapshot log derives the actual header count', () => {
  const hotspots = readFileSync('src/components/HotspotsPanel.vue', 'utf8')
  assert.match(hotspots, /<v-card-title class="d-flex align-center text-subtitle-1 text-wrap">/)
  assert.doesNotMatch(hotspots, /'text-wrap': ui\.metric\.id === 'depression'/)
  const snapshot = readFileSync('scripts/a11y-tract-snapshot.mjs', 'utf8')
  assert.ok(snapshot.includes('${full[0].length} columns'))
  assert.doesNotMatch(snapshot, /152 rows \/ 103 columns/)
  assert.match(readFileSync('scripts/a11y-canopy-gap.mjs', 'utf8'), /full\[0\]\.length===CSV_HEADERS\.length/)
})

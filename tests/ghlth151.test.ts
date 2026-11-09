import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { stripTypeScriptTypes } from 'node:module'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { Meta, TractCollection, TractProps } from '../src/types.ts'
import { METRICS, METRIC_IDS, METRIC_SWITCH_ORDER, resolveMetric, DEFAULT_METRIC, metricAvailable, fmtMetric, hotspotAscending, type MetricId } from '../src/utils/metrics.ts'
import { PLACES_MEASURES, PLACES_METRIC_IDS, placesMetricCitation, GHLTH_METHODS } from '../src/utils/placesMeasures.ts'
import { SNAPSHOT_EXCLUDED_METRICS, SNAPSHOT_CANDIDATE_METRICS, snapshotMetric, snapshotRow, snapshotLabel, tractSnapshot } from '../src/utils/tractSnapshot.ts'
import { CSV_HEADERS, fullCsvHeaders, PLACES_EXPORT, csvRow, toCsv } from '../src/utils/fullCsv.ts'
import { toCurrentViewCsv, currentViewComments, metricHasCi, metricUnitToken } from '../src/utils/currentViewCsv.ts'
import { readDeepLink, writeDeepLink, DEFAULT_LAYERS } from '../src/composables/useDeepLink.ts'
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
test('#151 shared map, registered polarity, exact32 switch order and explicit25-candidate inclusion', () => {
  assert.equal(PLACES_METRIC_IDS.length,16);assert.equal(PLACES_METRIC_IDS.at(-1),'generalHealth')
  assert.equal(PLACES_MEASURES.generalHealth![0],'GHLTH');assert.equal(PLACES_MEASURES.generalHealth![2],'fair or poor general health')
  assert.equal(METRIC_IDS.at(-1),'generalHealth');assert.equal(METRIC_SWITCH_ORDER.length,32)
  assert.deepEqual(METRIC_SWITCH_ORDER.slice(METRIC_SWITCH_ORDER.indexOf('physicalHealth'),METRIC_SWITCH_ORDER.indexOf('physicalHealth')+3),['physicalHealth','generalHealth','bphigh'])
  assert.equal(SNAPSHOT_CANDIDATE_METRICS.length,25);assert.ok(SNAPSHOT_CANDIDATE_METRICS.includes('generalHealth'))
  assert.equal(SNAPSHOT_EXCLUDED_METRICS.length,7);assert.ok(!SNAPSHOT_EXCLUDED_METRICS.includes('generalHealth'))
  assert.equal(METRICS.generalHealth.higherIsBetter,false);assert.equal(metricHasCi('generalHealth'),true)
  assert.equal(DEFAULT_METRIC,'canopy')
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
  assert.match(hotspots, /<v-card-title class="d-flex align-center text-subtitle-1 hotspots-heading text-wrap">/)
  assert.doesNotMatch(hotspots, /'text-wrap': ui\.metric\.id === 'depression'/)
  const snapshot = readFileSync('scripts/a11y-tract-snapshot.mjs', 'utf8')
  assert.ok(snapshot.includes('${fullCsvHeaders().length} columns'))
  assert.doesNotMatch(snapshot, /152 rows \/ 103 columns/)
  assert.match(readFileSync('scripts/a11y-canopy-gap.mjs', 'utf8'), /full\[0\]\.length===fullCsvHeaders\(\)\.length/)
})

const locked = JSON.parse(readFileSync(new URL('fixtures/ghlth151-locked.json', import.meta.url), 'utf8'))
test('#151 every registry string/flag equals locked rev1.1; aliases preserve all prior meanings and percent scale', () => {
  const def = METRICS.generalHealth
  for (const [key, expected] of Object.entries(locked.registry)) {
    const actual = (def as any)[key]
    assert.deepEqual(typeof actual === 'function' ? actual('acre') : actual, expected, key)
  }
  assert.notEqual(def.percent,true);assert.equal(hotspotAscending(def),false)
  for(const token of ['generalHealth','GENERALHEALTH',' general health ','  FaIr Or PoOr HeAlTh  ','ghlth',' SELF-RATED HEALTH ','self rated health']) assert.equal(resolveMetric(token),'generalHealth')
  for(const token of ['health','poor health','unhealthy people','general health symptoms'])assert.equal(resolveMetric(token),null)
  for(const [token,id]of [['physical','physicalHealth'],['phlth','physicalHealth'],['mental','mentalHealth'],['mhlth','mentalHealth'],['depressive','depression'],['depressive disorder','depression']]as const)assert.equal(resolveMetric(token),id)
  for(const km2 of [false,true]){assert.equal(fmtMetric(def,44.8,km2,247.105),'44.8%');assert.equal(fmtMetric(def,0,km2,247.105),'0.0%')}
})
test('#151 exact shared dynamic citation, methods, readable details/caption/What changed/docs; PHLTH source row unchanged', () => {
  assert.equal(placesMetricCitation('generalHealth',{GHLTH:2023}),locked.citation)
  assert.equal(placesMetricCitation('generalHealth',{GHLTH:2042}),locked.citation.replace('BRFSS 2023','BRFSS 2042'))
  for(const y of [undefined,NaN])assert.equal(placesMetricCitation('generalHealth',{GHLTH:y}),locked.citation.replace('BRFSS 2023 model-based estimates','model-based estimates'))
  assert.equal(GHLTH_METHODS,locked.methods)
  const app=readFileSync('src/App.vue','utf8'),details=readFileSync('src/components/TractDetails.vue','utf8')
  assert.ok(app.includes(locked.changed));assert.ok(app.includes('PLACES_MEASURES.generalHealth![0]'));assert.ok(app.includes('${generalHealthMethods.value}'));assert.ok(app.includes('{{ generalHealthMethods }}'))
  assert.ok(details.indexOf('class="general-health-detail"')>details.indexOf('Adults with frequent physical distress'))
  assert.ok(details.indexOf('class="general-health-detail"')<details.indexOf('Adults with high blood pressure'))
  assert.ok(details.includes('Self-rated overall health, not an objective health assessment. Physical health (PHLTH) measures 14+ days of poor physical health in the past 30 days.'))
  for(const f of ['README.md','docs/user-guide.md'])assert.ok(readFileSync(f,'utf8').includes(locked.docs))
  const p=load('public/data/central-miami-fl').fc.features.find(f=>f.properties.geoid==='12086002404')!.properties
  assert.deepEqual([p.pctPhysicalHealth,p.pctPhysicalHealthLo,p.pctPhysicalHealthHi],[24.9,21.7,28.5])
})
test('#151 all locked source breaks/weighted-overalls and availability handle values above50, zero, missing and empty breaks', () => {
  const expected:Record<string,[number[],number]>={'public/data':[[10.2,12,13.2,15.3],14.1],'central-miami-fl':[[7.5,17.4,26.8,33.2],26],'melbourne-fl':[[13.9,15.4,18.1,23.2],19],'pembroke-pines-fl':[[13.6,14.8,16.2,19.6],18.1],'orlando-fl':[[9.1,12.9,17.1,27.6],20],'tampa-fl':[[8.7,15.8,25.5,30.7],22.7],'central-jacksonville-fl':[[10.8,18.1,24.8,38.3],27.4]}
  for(const [name,[breaks,mean]]of Object.entries(expected)){const {fc,meta}=load(name==='public/data'?name:'public/data/'+name);assert.deepEqual(meta.metricBreaks!.generalHealth,breaks);assert.equal(meta.overall.pctGeneralHealth,mean);assert.equal(metricAvailable('generalHealth',meta,fc),true)}
  const {fc,meta}=load('public/data/central-miami-fl'),zeros={...fc,features:fc.features.map(f=>({...f,properties:{...f.properties,pctGeneralHealth:0}}))}
  assert.equal(metricAvailable('generalHealth',{...meta,metricBreaks:{...meta.metricBreaks,generalHealth:[]}},zeros),true)
  assert.equal(metricAvailable('generalHealth',{...meta,metricBreaks:{...meta.metricBreaks,generalHealth:undefined}},fc),false)
  for(const v of [undefined,null,NaN,Infinity])assert.equal(metricAvailable('generalHealth',meta,{...fc,features:fc.features.map(f=>({...f,properties:{...f.properties,pctGeneralHealth:v}}))}as TractCollection),false)
  assert.ok(load('public/data/orlando-fl').fc.features.some(f=>f.properties.pctGeneralHealth!>50))
})
test('#151 snapshot self-rated label and exact check all151 helper without forcing Miami top3; zero/null/insufficient path', () => {
  const {fc,meta}=load('public/data/central-miami-fl'),t=fc.features.find(f=>f.properties.geoid==='12086002404')!.properties
  const score=snapshotMetric('generalHealth',t.pctGeneralHealth!,fc.features.map(f=>f.properties.pctGeneralHealth!).sort((a,b)=>a-b))!
  assert.deepEqual([score.validCount,score.lower,score.tied,score.higher,score.badness],[152,151,0,0,100])
  assert.equal(snapshotLabel('generalHealth'),'Fair or poor health (self-rated)')
  const row=snapshotRow(score,'Miami','acre');assert.equal(row.line1,'Fair or poor health (self-rated) · 44.8% · model estimate');assert.equal(row.line2,'Higher than all 151 other tracts in Miami')
  assert.equal(row.ariaLabel,'Switch map to Fair or poor health (self-rated), higher than all 151 other tracts in Miami, 44.8%, model estimate')
  const s=tractSnapshot(fc,t.geoid,meta)!;assert.equal(s.eligibleCount,25);assert.deepEqual(s.worst.map(v=>v.metricId),['income','diabetes','physicalHealth'])
  const zero=snapshotMetric('generalHealth',0,[0,1,2,3,4,5,6,7,8,9])!;assert.equal(snapshotRow(zero,'Example','acre').line1,'Fair or poor health (self-rated) · 0.0% · model estimate')
  assert.equal(snapshotMetric('generalHealth',1,[0,1,2,3,4,5,6,7,8]),null)
  assert.equal(snapshotMetric('generalHealth',NaN,[0,1,2,3,4,5,6,7,8,9]),null)
  assert.ok(fc.features.some(f=>tractSnapshot(fc,f.properties.geoid,meta)!.worst.some(s=>s.metricId==='generalHealth')))
})
test('#151 current-view CSV both group directions/single/dual/compare, null/zero, units/targets and meta year all align', () => {
  const {fc,meta}=load('public/data/central-miami-fl'),t=fc.features.find(f=>f.properties.geoid==='12086002404')!.properties
  const props=[t,{...t,geoid:'zero',pctGeneralHealth:0,pctGeneralHealthLo:0,pctGeneralHealthHi:0},{...t,geoid:'missing',pctGeneralHealth:undefined,pctGeneralHealthLo:undefined,pctGeneralHealthHi:undefined}]
  const pairs:MetricId[][]=[['generalHealth'],['generalHealth','trees'],['trees','generalHealth'],['generalHealth','physicalHealth'],['physicalHealth','generalHealth'],['generalHealth','depression'],['generalHealth','income'],['income','generalHealth']]
  for(const unit of ['acre','km2']as const)for(const gapTarget of ['p75','30']as const)for(const compare of [false,true])for(const metrics of pairs){
    const text=toCurrentViewCsv({rows:props.map(props=>({cityId:'miami',cityName:'Miami, FL',meta,props})),metrics,unit,compare,gapTarget,comments:[]})
    const [h,...rows]=text.trimEnd().split('\r\n').filter(l=>!l.startsWith('#')).map(splitCsv)
    const n=(metrics.length===1?16:metrics.includes('income')?24:22)+(compare?2:0),key=metrics.length===1?'metric':metrics[0]==='generalHealth'?'metric_a':'metric_b'
    assert.equal(h.length,n);assert.ok(rows.every((r:string[])=>r.length===n))
    for(const [k,v]of Object.entries({value:'44.8',ci_lo:'39.2',ci_hi:'50.7',unit:'%',id:'generalHealth',label:'Fair or poor health'}))assert.equal(rows[0][h.indexOf(key+'_'+k)],v)
    assert.equal(rows.find((r:string[])=>r[h.indexOf('geoid')]==='zero')![h.indexOf(key+'_value')],'0.0')
    assert.equal(rows.find((r:string[])=>r[h.indexOf('geoid')]==='missing')![h.indexOf(key+'_value')],'')
  }
  const comments=currentViewComments([{id:'miami',meta:{...meta,cdcPlaces:{...meta.cdcPlaces!,years:{...meta.cdcPlaces!.years,GHLTH:2042}}}}],['generalHealth'],'https://example.test/?gapTarget=30').join('\n')
  assert.match(comments,/BRFSS 2042/);assert.match(comments,/self-reported fair or poor general health/)
})
test('#151 canonical and alias URLs preserve dual encoding/gapTarget/unrelated flags; writer emits canonical generalHealth', () => {
  for(const token of ['generalHealth','GENERALHEALTH','general health','fair or poor health','ghlth','self-rated health','self rated health']){
    const link=readDeepLink('?metric='+encodeURIComponent(token)+'&gapTarget=30&dual=trees,generalHealth&audit=keep')
    assert.equal(link.metric,'generalHealth');assert.equal(link.gapTarget,'30');assert.deepEqual(link.dual,{left:'trees',right:'generalHealth'})
  }
  const old=(globalThis as any).window
  try{
    let href='https://example.test/?metric=ghlth&gapTarget=30&audit=keep';(globalThis as any).window={location:{get href(){return href}},history:{state:{},replaceState(_s:any,_t:any,u:any){href=String(u)}}}
    writeDeepLink({city:'central-miami-fl',geoid:'12086002404',basemap:'streets',theme:'treeDark',layers:DEFAULT_LAYERS,unit:'acre',metric:'generalHealth',dual:{left:'trees',right:'generalHealth'},gapTarget:'30'})
    const q=new URL(href).searchParams;assert.equal(q.get('metric'),'generalHealth');assert.equal(q.get('audit'),'keep');assert.equal(q.get('gapTarget'),'30')
    assert.deepEqual(readDeepLink(new URL(href).search).dual,{left:'trees',right:'generalHealth'})
  }finally{if(old===undefined)delete(globalThis as any).window;else(globalThis as any).window=old}
})
test('#151 shared thin fullCsvHeaders accessor returns the exact existing array and agrees with emitted headers', () => {
  assert.equal(fullCsvHeaders(),CSV_HEADERS);assert.equal(fullCsvHeaders().length,109)
  const {fc,meta}=load('public/data/central-miami-fl')
  assert.deepEqual(splitCsv(toCsv([fc.features[0].properties],meta).split('\r\n')[0]),fullCsvHeaders())
})

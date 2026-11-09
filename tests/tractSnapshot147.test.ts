import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import type { Meta, TractCollection, TractProps } from '../src/types.ts'
import { METRICS, METRIC_IDS, METRIC_SWITCH_ORDER, type MetricId } from '../src/utils/metrics.ts'
import { PLACES_MEASURES } from '../src/utils/placesMeasures.ts'
import { SNAPSHOT_CANOPY_METRIC, SNAPSHOT_CANDIDATE_METRICS, SNAPSHOT_EXCLUDED_METRICS, SNAPSHOT_MAPPING_NOTE, SNAPSHOT_INSUFFICIENT, getTractSnapshotIndex, tractSnapshot, snapshotMetric, snapshotRow, snapshotValue, snapshotCityName, snapshotComparison, snapshotCanopyComparison, snapshotMessage, snapshotCanopyUnavailable, snapshotPercent, resetTractSnapshotCache } from '../src/utils/tractSnapshot.ts'

const geoid = (i: number) => String(i).padStart(11, '0')
const pack = (rows: Record<string, unknown>[]): TractCollection => ({ type: 'FeatureCollection', features: rows.map((p, i) => ({
  type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] },
  properties: { geoid: geoid(i), name: `Tract ${i}`, ...p } as unknown as TractProps,
})) })
const rows = (n: number, f: (i: number) => Record<string, unknown>) => Array.from({ length: n }, (_, i) => f(i))
const metadata = (ids: readonly MetricId[] = METRIC_IDS): Meta => ({ cityName: 'Example, FL', metricBreaks: Object.fromEntries(ids.map(id => [id, [1, 2]])) }) as unknown as Meta
const result = (p: TractCollection, i = 0, m = metadata()) => tractSnapshot(p, geoid(i), m)!
const approximately = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`)
const score = (id: MetricId, values: unknown[], selected: number) => snapshotMetric(id, selected, values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b))!
beforeEach(() => resetTractSnapshotCache())

test('#147 explicit allowlist, seven exclusions and replaceable canopy registry id', () => {
  assert.deepEqual(SNAPSHOT_CANDIDATE_METRICS, ['parks', 'groceries', 'income', 'foodAccess', 'poverty', 'noVehicle', 'rentBurden', 'asthma', 'diabetes', 'lep', 'snap', 'obesity', 'mentalHealth', 'physicalHealth', 'bphigh', 'chd', 'stroke', 'inactivity', 'copd', 'smoking', 'disability', 'shortSleep', 'uninsured'])
  assert.deepEqual(SNAPSHOT_EXCLUDED_METRICS, ['canopy', 'canopyGap', 'trees', 'plantNeed', 'risk', 'age65', 'under18'])
  assert.equal(SNAPSHOT_CANOPY_METRIC, 'canopy')
  assert.equal(METRICS[SNAPSHOT_CANOPY_METRIC].valueKey, 'canopyPct')
  assert.deepEqual(METRIC_IDS.filter(id => !SNAPSHOT_CANDIDATE_METRICS.includes(id)).sort(), [...SNAPSHOT_EXCLUDED_METRICS].sort())
  assert.deepEqual(SNAPSHOT_CANDIDATE_METRICS, METRIC_SWITCH_ORDER.filter(id => SNAPSHOT_CANDIDATE_METRICS.includes(id)))
  assert.ok(Object.isFrozen(SNAPSHOT_CANDIDATE_METRICS) && Object.isFrozen(SNAPSHOT_EXCLUDED_METRICS))
  assert.equal(METRICS.plantNeed.higherIsBetter, true)
  assert.equal(METRICS.plantNeed.hotspotSort, 'desc')
})
test('#147 every candidate gets polarity from the registry, and all 14 PLACES carry model markers', () => {
  for (const id of SNAPSHOT_CANDIDATE_METRICS) {
    const s = score(id, [0,1,2,3,4,5,6,7,8,9], 9)
    assert.equal(s.badness, METRICS[id].higherIsBetter ? 0 : 100)
    assert.equal(s.modelEstimate, id in PLACES_MEASURES)
    assert.equal(snapshotRow(s, 'Example', 'acre').line1.includes('model estimate'), id in PLACES_MEASURES)
  }
  assert.equal(Object.keys(PLACES_MEASURES).length, 14)
  assert.match(snapshotRow(score('uninsured', [0,1,2,3,4,5,6,7,8,9], 9), 'Example', 'acre').ariaLabel, /No health insurance \(ages 18–64\)/)
})
test('#147 TL synthetic half ties exclude self; invalid peers never enter n', () => {
  const values = [0,1,2,2,2,3,4,5,6,7, null, undefined, NaN, Infinity, -Infinity, '2', false, '']
  const adverseHigh = score('poverty', values, 2), adverseLow = score('income', values, 2)
  assert.deepEqual([adverseHigh.validCount, adverseHigh.lower, adverseHigh.higher, adverseHigh.tied], [10,2,5,2])
  approximately(adverseHigh.badness, 100 / 3)
  approximately(adverseLow.badness, 200 / 3)
  assert.equal(snapshotComparison(adverseLow, 'Example'), 'Lower than 66% of other tracts in Example')
  const p = pack(values.map(value => ({ pctPoverty: value })))
  for (let i = 10; i < values.length; i++) assert.deepEqual(result(p, i).worst, [])
  assert.equal(score('poverty', values, 0).value, 0)
})
test('#147 all equal X/C=50, raw strict floor excludes shared midpoint', () => {
  const p = pack(rows(19, () => ({ pctPoverty: 1, medianIncome: 2, canopyPct: 0 })))
  const s = result(p)
  assert.equal(s.eligibleCount, 2)
  assert.equal(s.aboveFloorCount, 0)
  assert.deepEqual(s.worst, [])
  assert.equal(s.canopy!.percentile, 50)
  assert.equal(s.canopy!.badness, 50)
  assert.equal(snapshotMessage(s, 'Example'), 'No measures here stand out as higher-need than most other tracts in Example.')
})
test('#147 n=9 vs10 independently for candidates and canopy; own missing is never zero', () => {
  const p = pack(rows(11, i => ({ pctPoverty: i < 9 ? i : null, pctUninsured: i < 10 ? i : null, canopyPct: i < 9 ? i : null })))
  assert.deepEqual(result(p, 8).worst.map(m => m.metricId), ['uninsured'])
  assert.equal(result(p, 8).worst[0].validCount, 10)
  assert.equal(result(p, 8).canopy, null)
  assert.equal(snapshotCanopyUnavailable(result(p, 8)), 'Not enough tree-canopy data to compare this tract (10 tracts needed).')
  const q = pack(rows(11, i => ({ pctPoverty: i < 10 ? i : null, canopyPct: i < 10 ? i : null })))
  assert.equal(result(q, 9).canopy!.validCount, 10)
  assert.equal(result(q, 10).canopy, null)
  assert.deepEqual(result(q, 10).worst, [])
  assert.equal(snapshotCanopyUnavailable(result(q, 10)), 'Tree-canopy comparison unavailable for this tract.')
})
test('#147 map availability metadata gate excludes otherwise finite eligible metrics', () => {
  const p = pack(rows(10, i => ({ pctPoverty: i, medianIncome: 10-i })))
  assert.equal(result(p, 9).worst.length, 2)
  assert.deepEqual(result(p, 9, metadata(['income'])).worst.map(m => m.metricId), ['income'])
  assert.deepEqual(result(p, 9, metadata([])).worst, [])
  assert.equal(snapshotMessage(result(p, 9, metadata([])), 'Example'), SNAPSHOT_INSUFFICIENT)
})
test('#147 no candidates, absent selections and unknown geoid are honest/safe', () => {
  const p = pack(rows(10, () => ({}))), m = metadata()
  assert.equal(tractSnapshot(null, geoid(0), m), null)
  assert.equal(tractSnapshot(p, null, m), null)
  assert.equal(tractSnapshot(p, geoid(0), null), null)
  assert.equal(tractSnapshot(pack([]), geoid(0), m), null)
  assert.equal(tractSnapshot(p, 'missing', m), null)
  assert.equal(snapshotMessage(result(p), 'Example'), SNAPSHOT_INSUFFICIENT)
})
test('#147 excluded composites/demographics never consume shortlist slots, canopy is separate', () => {
  const p = pack(rows(12, i => ({ canopyPct: 11-i, nriRiskScore: i, plantNeed: 11-i, pctAge65Plus: i, pctUnder18: 11-i, pctPoverty: i, pctNoVehicle: i, pctRentBurden: i, pctAsthma: i })))
  const s = result(p, 11)
  assert.equal(s.canopy!.badness, 100)
  assert.deepEqual(s.worst.map(m => m.metricId), ['poverty', 'noVehicle', 'rentBurden'])
  for (let i=0; i<12; i++) assert.ok(result(p, i).worst.every(m => !SNAPSHOT_EXCLUDED_METRICS.includes(m.metricId)))
})
test('#147 exact ties sort by switch order, including equal fractions across different n', () => {
  const p = pack(rows(10, i => ({ pctCopd: i, pctChd: i, pctStroke: i, pctBpHigh: i })))
  assert.deepEqual(result(p, 9).worst.map(m => m.metricId), ['bphigh', 'chd', 'stroke'])
  const q = pack(rows(19, i => ({ pctPoverty: i, medianIncome: i < 9 ? i : i === 14 ? 1.5 : null })))
  const tied = result(q, 14).worst
  assert.deepEqual(tied.map(m => m.metricId), ['income', 'poverty'])
  assert.deepEqual(tied.map(m => m.validCount), [10,19])
  approximately(tied[0].badness, tied[1].badness)
})
test('#147 X=50.9 qualifies displaying50 and ordering by raw score, not rounded labels', () => {
  const p = pack(rows(501, i => ({ pctPoverty: i===0 ? 1 : i<=250 ? 0 : i<=259 ? 1 : 2, pctNoVehicle: i===0 ? 1 : i<=254 ? 0 : 2 })))
  const s = result(p)
  assert.deepEqual(s.worst.map(m => m.metricId), ['poverty', 'noVehicle'])
  approximately(s.worst[0].badness, 50.9)
  assert.equal(snapshotComparison(s.worst[0], 'Example'), 'Higher than 50% of other tracts in Example')
  assert.equal(snapshotComparison(s.worst[1], 'Example'), 'Higher than 50% of other tracts in Example')
  assert.equal(snapshotMessage(s, 'Example'), 'Only 2 measures here are higher-need than most other tracts in Example.')
  const one = result(pack(rows(10, i => ({ pctPoverty: i }))), 9)
  assert.equal(snapshotMessage(one, 'Example'), 'Only 1 measure here is higher-need than most other tracts in Example.')
})
test('#147 strict count-proven extrema say all N, near/tied extrema floor and clamp only', () => {
  const a = [0,1,2,3,4,5,6,7,8,9]
  for (const id of ['income', 'poverty'] as const) {
    assert.equal(snapshotComparison(score(id,a,9), 'Example'), 'Higher than all 9 other tracts in Example')
    assert.equal(snapshotComparison(score(id,a,0), 'Example'), 'Lower than all 9 other tracts in Example')
  }
  assert.equal(snapshotPercent(99.6),99)
  assert.equal(snapshotPercent(77.777777),77)
  assert.equal(snapshotPercent(0.4),1)
  const near = score('poverty', [...Array(249).fill(0),1,2], 1)
  approximately(near.badness,99.6)
  assert.equal(snapshotComparison(near, 'Example'), 'Higher than 99% of other tracts in Example')
  const bottom = score('poverty', [0,1,...Array(249).fill(2)],1)
  assert.equal(snapshotComparison(bottom, 'Example'), 'Higher than 1% of other tracts in Example')
  const tied = score('poverty',[0,1,2,3,4,5,6,7,9,9],9)
  assert.ok(!snapshotComparison(tied,'Example').includes('all'))
})
test('#147 separate canopy C rounds nearest, zero rev3 ties never claim more trees', () => {
  const s = score('trees', [...Array(100).fill(0),...Array(52).fill(1)],0)
  approximately(s.percentile,32.78145695364238)
  assert.equal(snapshotCanopyComparison(s,'Miami','acre'), 'Tied with 99 other tracts in Miami that have no street trees mapped.')
  assert.equal(snapshotRow(s,'Miami','acre').line1,'No street trees mapped')
  assert.equal(snapshotCanopyComparison(score('trees',[0,1,2,3,4,5,6,7,8,9],0),'Example','acre'),'')
  assert.equal(snapshotCanopyComparison(score('trees',[1,2,3,4,5,6,7,8,9,10],1),'Example','acre'),'Fewer street trees per acre than all 9 other tracts in Example')
  assert.equal(snapshotCanopyComparison(score('trees',[1,2,3,4,5,6,7,8,9,10],10),'Example','km2'),'More street trees per km² than all 9 other tracts in Example')
  const middle = score('trees',Array.from({length:19},(_,i)=>i+1),13)
  assert.equal(snapshotCanopyComparison(middle,'Melbourne','acre'),'More street trees per acre than 67% of other tracts in Melbourne')
})
test('#147 formats percentage points, food shares, integer USD and honest positive/zero densities', () => {
  const formatted = (id: MetricId, value: number) => snapshotRow(score(id,Array(10).fill(value),value),'Example','acre')
  assert.equal(formatted('diabetes',28.9).line1,'Diabetes · 28.9% · model estimate')
  assert.equal(formatted('diabetes',0).value,'0.0%')
  assert.equal(formatted('foodAccess',0.123).value,'12.3%')
  assert.equal(formatted('income',19394).value,'$19,394')
  assert.equal(formatted('trees',0.099).value,'0.10 trees/acre')
  assert.equal(formatted('trees',0.064).value,'0.06 trees/acre')
  assert.equal(formatted('trees',0.000123).value,'0.00012 trees/acre')
  assert.equal(formatted('groceries',0.001234).value,'0.0012 groceries/acre')
  assert.equal(formatted('parks',0.001234).value,'0.0012 parks/acre')
  assert.equal(formatted('parks',0).line1,'No parks mapped')
  assert.equal(formatted('groceries',0).line1,'No grocery stores mapped')
  assert.equal(formatted('trees',0).line1,'No street trees mapped')
  assert.equal(formatted('diabetes',28.9).ariaLabel,'Switch map to Diabetes, higher than 50% of other tracts in Example, 28.9%, model estimate')
  assert.match(snapshotValue(score('groceries',Array(10).fill(0.001234),0.001234),'km2'),/groceries\/km²$/)
})
test('#147 city names strip only final state suffix; no slug/subtitle inference', () => {
  assert.equal(snapshotCityName(' Miami, FL '),'Miami')
  assert.equal(snapshotCityName(undefined,'Pembroke Pines, FL'),'Pembroke Pines')
  assert.equal(snapshotCityName(''),'this city')
  assert.equal(snapshotCityName('  '),'this city')
  assert.equal(snapshotCityName('Name, France'),'Name, France')
  assert.equal(snapshotCityName('Place, fl'),'Place, fl')
})
test('#147 immutable sorted arrays cached once per collection; metadata gate wrappers reuse them', () => {
  const p=pack(rows(10,i=>({pctPoverty:i,canopyPct:i}))), m=metadata()
  const before=JSON.stringify(p), first=getTractSnapshotIndex(p,m)
  assert.strictEqual(getTractSnapshotIndex(p,m),first)
  assert.strictEqual(first.select(geoid(9)),first.select(geoid(9)))
  for(const unit of ['acre','km2'] as const) snapshotRow(first.select(geoid(9))!.worst[0],'Example',unit)
  assert.strictEqual(getTractSnapshotIndex(p,m).distributions,first.distributions)
  const gated=getTractSnapshotIndex(p,metadata([]))
  assert.strictEqual(gated.distributions.get('poverty'),first.distributions.get('poverty'))
  for(const a of first.distributions.values()) assert.ok(Object.isFrozen(a))
  const s=first.select(geoid(9))!
  assert.ok(Object.isFrozen(s) && Object.isFrozen(s.worst) && s.worst.every(Object.isFrozen) && Object.isFrozen(s.canopy))
  assert.equal(JSON.stringify(p),before)
  const replacement=pack(rows(10,i=>({pctPoverty:9-i,canopyPct:9-i})))
  assert.notStrictEqual(getTractSnapshotIndex(replacement,m).distributions,first.distributions)
  assert.notDeepEqual(result(replacement,9,m),s)
  resetTractSnapshotCache(p)
  assert.notStrictEqual(getTractSnapshotIndex(p,m),first)
  const other=getTractSnapshotIndex(replacement,m)
  assert.strictEqual(getTractSnapshotIndex(replacement,m),other)
  resetTractSnapshotCache()
  assert.notStrictEqual(getTractSnapshotIndex(replacement,m),other)
})
test('#147 deterministic under feature order and cache reset, without pack mutation', () => {
  const p=pack(rows(12,i=>({pctPoverty:i%4,pctNoVehicle:i%4,pctRentBurden:i%4,canopyPct:12-i})))
  const q={...p,features:[...p.features].reverse()}, m=metadata(), expected=result(p,3,m)
  for(const i of [9,0,11,1,5]) result(p,i,m)
  assert.deepEqual(result(q,3,m),expected)
  resetTractSnapshotCache()
  assert.deepEqual(result(p,3,m),expected)
})

// Portable CI fixture copied from the Designer's rev2 evidence; local runs ALSO compare the
// full /workspace/specs JSON directly. Rev3 supersedes only Miami's zero-tree comparison copy.
const portableChecks = [
  {cityId:'melbourne-fl',cityName:'Melbourne',geoid:'12009064201',total:19,eligibleMetrics:23,aboveFloor:19,
    top:[{id:'lep',value:6.6,n:19,B:17,tied:0,worseThan:94.44444444444444,line1:'Limited English · 6.6%',line2:'Higher than 94% of other tracts in Melbourne'},{id:'snap',value:17.1,n:19,B:15,tied:0,worseThan:83.33333333333333,line1:'SNAP households · 17.1%',line2:'Higher than 83% of other tracts in Melbourne'},{id:'poverty',value:20.7,n:19,B:14,tied:0,worseThan:77.77777777777777,line1:'Poverty · 20.7%',line2:'Higher than 77% of other tracts in Melbourne'}],canopy:{n:19,lower:12,higher:6,tied:0,densityPercentile:66.66666666666667,line1:'Street trees · 0.06 trees/acre',line2:'More street trees per acre than 67% of other tracts in Melbourne'}},
  {cityId:'central-miami-fl',cityName:'Miami',geoid:'12086002404',total:152,eligibleMetrics:23,aboveFloor:22,
    top:[{id:'income',value:19394,n:152,B:151,tied:0,worseThan:100,line1:'Income · $19,394',line2:'Lower than all 151 other tracts in Miami'},{id:'diabetes',value:28.9,n:152,B:151,tied:0,worseThan:100,line1:'Diabetes · 28.9% · model estimate',line2:'Higher than all 151 other tracts in Miami'},{id:'physicalHealth',value:24.9,n:152,B:151,tied:0,worseThan:100,line1:'Physical health · 24.9% · model estimate',line2:'Higher than all 151 other tracts in Miami'}],canopy:{n:152,lower:0,higher:52,tied:99,densityPercentile:32.78145695364238,line1:'No street trees mapped',line2:'More street trees per acre than 33% of other tracts in Miami'}},
  {cityId:'orlando-fl',cityName:'Orlando',geoid:'12095010201',total:43,eligibleMetrics:23,aboveFloor:1,
    top:[{id:'groceries',value:0,n:43,B:17,tied:25,worseThan:70.23809523809524,line1:'No grocery stores mapped',line2:'Lower than 70% of other tracts in Orlando'}],canopy:{n:43,lower:37,higher:5,tied:0,densityPercentile:88.0952380952381,line1:'Street trees · 0.10 trees/acre',line2:'More street trees per acre than 88% of other tracts in Orlando'}},
]
const evidence='/workspace/specs/snapshot147-check-values.json'
const evidenceResults: typeof portableChecks = existsSync(evidence) ? JSON.parse(readFileSync(evidence,'utf8')).results : portableChecks
for(const fixture of evidenceResults) test(`#147 real check-values: ${fixture.cityName} ${fixture.geoid} (rev3 zero-tree override)`,()=>{
  const p:TractCollection=JSON.parse(readFileSync(new URL(`../public/data/${fixture.cityId}/tracts-equity.geojson`,import.meta.url),'utf8'))
  const m:Meta=JSON.parse(readFileSync(new URL(`../public/data/${fixture.cityId}/meta.json`,import.meta.url),'utf8'))
  const s=tractSnapshot(p,fixture.geoid,m)!
  assert.equal(p.features.length,fixture.total)
  assert.equal(s.eligibleCount,fixture.eligibleMetrics)
  assert.equal(s.aboveFloorCount,fixture.aboveFloor)
  assert.deepEqual(s.worst.map(x=>x.metricId),fixture.top.map(x=>x.id))
  fixture.top.forEach((expected,i)=>{
    const actual=s.worst[i], display=snapshotRow(actual,fixture.cityName,'acre')
    assert.deepEqual([actual.value,actual.validCount,actual.better,actual.tied],[expected.value,expected.n,expected.B,expected.tied])
    approximately(actual.badness,expected.worseThan)
    assert.equal(display.line1,expected.line1)
    assert.equal(display.line2,expected.line2)
  })
  const own=p.features.find(f=>f.properties.geoid===fixture.geoid)!.properties
  // Keep #147 OSM examples as historical evidence, not as canopy fixtures.
  const tree=score('trees',p.features.map(f=>f.properties.treesPerAcre),own.treesPerAcre), display=snapshotRow(tree,fixture.cityName,'acre')
  assert.deepEqual([tree.validCount,tree.lower,tree.higher,tree.tied],[fixture.canopy.n,fixture.canopy.lower,fixture.canopy.higher,fixture.canopy.tied])
  approximately(tree.percentile,fixture.canopy.densityPercentile)
  assert.equal(display.line1,fixture.canopy.line1)
  assert.equal(display.line2,fixture.cityName==='Miami'?'Tied with 99 other tracts in Miami that have no street trees mapped.':fixture.canopy.line2)
  assert.equal(SNAPSHOT_MAPPING_NOTE,'Street trees come from OpenStreetMap; some areas are under-mapped, so low counts may reflect mapping gaps.')
})
test('#147 mapping helper is always visible outside collapsed help and immediately after trees',()=>{
  const source=readFileSync(new URL('../src/components/TractDetails.vue',import.meta.url),'utf8')
  const helper=source.indexOf('snapshot-mapping-note')
  assert.ok(helper>source.indexOf('</details>') && helper>source.indexOf('snapshot-trees-unavailable'))
  assert.match(source,/class="text-caption mt-2 snapshot-mapping-note">\{\{ canopyHelper\(meta\) \}\}/)
})

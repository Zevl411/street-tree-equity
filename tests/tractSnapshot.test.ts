// #147 prep only: mathematical/cache contracts, no Designer copy or UI dependencies.
import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { tractSnapshot, resetTractSnapshotCache, SNAPSHOT_MIN_VALID_TRACTS, SNAPSHOT_WORST_LIMIT, SNAPSHOT_EXCLUDED_METRICS } from '../src/utils/tractSnapshot.ts'
import type { TractCollection, TractProps } from '../src/types.ts'
import { METRICS } from '../src/utils/metrics.ts'

const geoid = (i: number) => String(i).padStart(11, '0')
const pack = (rows: Record<string, unknown>[]): TractCollection => ({
  type: 'FeatureCollection',
  features: rows.map((p, i) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] },
    properties: { geoid: geoid(i), name: `Tract ${i}`, ...p } as unknown as TractProps,
  })),
})
const rows = (n: number, props: (i: number) => Record<string, unknown>) => Array.from({ length: n }, (_, i) => props(i))
const approximately = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`)

beforeEach(() => resetTractSnapshotCache())

test('#147 distinct finite values use endpoint-normalized mid-rank percentiles', () => {
  const p = pack(rows(10, (i) => ({ pctPoverty: i })))
  const low = tractSnapshot(p, geoid(0))!.worst[0]
  const high = tractSnapshot(p, geoid(9))!.worst[0]
  assert.equal(low.value, 0) // zero is not missing
  assert.equal(low.percentile, 0)
  assert.equal(high.percentile, 100)
  assert.equal(low.validCount, 10)
  approximately(tractSnapshot(p, geoid(4))!.worst[0].percentile, (4 / 9) * 100)
})

test('#147 ties receive the averaged rank, not the first or last tied rank', () => {
  const p = pack([1, 1, 1, 2, 3, 4, 5, 6, 7, 8].map((v) => ({ pctPoverty: v })))
  const pct = tractSnapshot(p, geoid(0))!.worst[0].percentile
  approximately(pct, (1 / 9) * 100) // average of zero-based positions 0,1,2
  for (const i of [1, 2]) assert.equal(tractSnapshot(p, geoid(i))!.worst[0].percentile, pct)
  const middle = pack([0, 1, 2, 3, 4, 4, 6, 7, 8, 9].map((v) => ({ pctPoverty: v })))
  assert.equal(tractSnapshot(middle, geoid(4))!.worst[0].percentile, 50)
  assert.equal(tractSnapshot(middle, geoid(5))!.worst[0].percentile, 50)
})

test('#147 all-equal metrics are valid with percentile and badness 50', () => {
  const p = pack(rows(10, () => ({ pctPoverty: 12, medianIncome: 50000, treesPerAcre: 0 })))
  for (const i of [0, 4, 9]) {
    const s = tractSnapshot(p, geoid(i))!
    assert.equal(s.canopy!.percentile, 50)
    assert.equal(s.canopy!.badness, 50)
    assert.equal(s.worst.length, 2)
    for (const m of s.worst) { assert.equal(m.percentile, 50); assert.equal(m.badness, 50) }
  }
})

test('#147 null/undefined/NaN/infinities/strings/booleans do not enter the distribution', () => {
  const invalid = [null, undefined, Number.NaN, Infinity, -Infinity, '9', false]
  const p = pack([...rows(10, (i) => ({ pctPoverty: i })), ...invalid.map((v) => ({ pctPoverty: v }))])
  assert.equal(tractSnapshot(p, geoid(9))!.worst[0].validCount, 10)
  assert.equal(tractSnapshot(p, geoid(9))!.worst[0].percentile, 100)
  for (let i = 10; i < 17; i++) assert.deepEqual(tractSnapshot(p, geoid(i))!.worst, [])
})

test('#147 a tract own null skips only that metric, not its other finite metrics', () => {
  const p = pack(rows(11, (i) => ({ pctPoverty: i === 0 ? null : i, medianIncome: i, treesPerAcre: i })))
  const s = tractSnapshot(p, geoid(0))!
  assert.deepEqual(s.worst.map((m) => m.metricId), ['income'])
  assert.equal(s.canopy!.metricId, 'trees')
})

test('#147 minimum-n is per metric: 9 valid skips, 10 qualifies regardless of total pack size', () => {
  assert.equal(SNAPSHOT_MIN_VALID_TRACTS, 10)
  const p = pack(rows(11, (i) => ({ pctPoverty: i < 9 ? i : null, pctUninsured: i < 10 ? i : null })))
  assert.deepEqual(tractSnapshot(p, geoid(0))!.worst.map((m) => m.metricId), ['uninsured'])
  assert.equal(tractSnapshot(p, geoid(0))!.worst[0].validCount, 10)
  assert.deepEqual(tractSnapshot(pack(rows(9, (i) => ({ pctPoverty: i }))), geoid(0))!.worst, [])
})

test('#147 canopy follows the same finite-value and minimum-n rules separately', () => {
  const nine = pack(rows(10, (i) => ({ treesPerAcre: i < 9 ? i : null })))
  assert.equal(tractSnapshot(nine, geoid(0))!.canopy, null)
  const ten = pack(rows(11, (i) => ({ treesPerAcre: i < 10 ? i : null })))
  assert.equal(tractSnapshot(ten, geoid(9))!.canopy!.percentile, 100)
  assert.equal(tractSnapshot(ten, geoid(10))!.canopy, null)
})

test('#147 direction comes from registry higherIsBetter, not metric name or presentation units', () => {
  const p = pack(rows(10, (i) => ({ medianIncome: i, pctPoverty: i })))
  const low = tractSnapshot(p, geoid(0))!.worst
  assert.deepEqual(low.map((m) => m.metricId), ['income', 'poverty'])
  assert.deepEqual(low.map((m) => m.badness), [100, 0])
  const high = tractSnapshot(p, geoid(9))!.worst
  assert.deepEqual(high.map((m) => m.metricId), ['poverty', 'income'])
  assert.deepEqual(high.map((m) => m.badness), [100, 0])
})

test('#147 canopy is excluded even when it would be tied worst; at most three non-canopy metrics', () => {
  assert.equal(SNAPSHOT_WORST_LIMIT, 3)
  const p = pack(rows(10, (i) => ({ treesPerAcre: 9 - i, pctAsthma: i, pctPoverty: i, pctNoVehicle: i, pctRentBurden: i })))
  const s = tractSnapshot(p, geoid(9))!
  assert.equal(s.canopy!.badness, 100)
  assert.deepEqual(s.worst.map((m) => m.metricId), ['poverty', 'noVehicle', 'rentBurden'])
  assert.ok(s.worst.every((m) => m.badness === 100 && m.metricId !== 'trees'))
  assert.deepEqual(tractSnapshot(pack(rows(10, (i) => ({ treesPerAcre: i }))), geoid(0))!.worst, [])
})

test('#147 badness ties use switch order, not append-only registry or object-property order', () => {
  const p = pack(rows(10, (i) => ({ pctCopd: i, pctChd: i, pctStroke: i, pctBpHigh: i })))
  assert.deepEqual(tractSnapshot(p, geoid(9))!.worst.map((m) => m.metricId), ['bphigh', 'chd', 'stroke'])
})

test('#147 opposite directions and different valid-count denominators still break equal ranks by switch order', () => {
  const p = pack(rows(19, (i) => ({ pctPoverty: i, medianIncome: i < 10 ? 9 - i : null })))
  const s = tractSnapshot(p, geoid(1))!.worst
  // poverty rank 1/18; income rank reversed = 1/9 — these are NOT tied yet.
  assert.equal(s[0].metricId, 'income')
  const q = pack(rows(19, (i) => ({ pctPoverty: i === 1 ? 2 : i === 2 ? 1 : i, medianIncome: i < 10 ? 9 - i : null })))
  const tied = tractSnapshot(q, geoid(1))!.worst
  assert.equal(tied[0].badness, tied[1].badness) // 2/18 == 1/9
  assert.deepEqual(tied.map((m) => m.metricId), ['income', 'poverty'])
})

test('#147 missing pack/selection/unknown geoid returns null; empty pack is safe', () => {
  assert.equal(tractSnapshot(null, geoid(0)), null)
  assert.equal(tractSnapshot(undefined, geoid(0)), null)
  assert.equal(tractSnapshot(pack([]), geoid(0)), null)
  const p = pack(rows(10, () => ({})))
  assert.equal(tractSnapshot(p, null), null)
  assert.equal(tractSnapshot(p, undefined), null)
  assert.equal(tractSnapshot(p, 'missing'), null)
  assert.deepEqual(tractSnapshot(p, geoid(0)), { geoid: geoid(0), canopy: null, worst: [] })
})

test('#147 memoizes the whole pack once, including other selections; explicit pack reset refreshes', () => {
  const p = pack(rows(10, (i) => ({ pctPoverty: i })))
  const first = tractSnapshot(p, geoid(0))!
  assert.strictEqual(tractSnapshot(p, geoid(0)), first)
  // Data should be treated as immutable; simulate replacement values to exercise explicit invalidation.
  p.features[9].properties.pctPoverty = 0
  assert.equal(tractSnapshot(p, geoid(9))!.worst[0].value, 9) // already precomputed, no selection-time rescan
  resetTractSnapshotCache(p)
  const refreshed = tractSnapshot(p, geoid(0))!
  assert.notStrictEqual(refreshed, first)
  assert.equal(tractSnapshot(p, geoid(9))!.worst[0].value, 0)
})

test('#147 cache identity is per pack; one-pack and full resets are independent', () => {
  const a = pack(rows(10, (i) => ({ pctPoverty: i })))
  const b = pack(rows(10, (i) => ({ pctPoverty: 9 - i })))
  const ar = tractSnapshot(a, geoid(0))!, br = tractSnapshot(b, geoid(0))!
  assert.notDeepEqual(ar, br)
  resetTractSnapshotCache(a)
  assert.notStrictEqual(tractSnapshot(a, geoid(0)), ar)
  assert.strictEqual(tractSnapshot(b, geoid(0)), br)
  resetTractSnapshotCache()
  assert.notStrictEqual(tractSnapshot(b, geoid(0)), br)
})

test('#147 deterministic across selection/feature order, cache resets, and equivalent pack objects', () => {
  const p = pack(rows(12, (i) => ({ pctPoverty: i % 4, pctNoVehicle: i % 4, pctRentBurden: i % 4, treesPerAcre: 12 - i })))
  const q = { ...p, features: [...p.features].reverse() }
  const before = JSON.stringify(p)
  const expected = tractSnapshot(p, geoid(3))!
  for (const i of [9, 0, 11, 1, 5]) tractSnapshot(p, geoid(i))
  assert.deepEqual(tractSnapshot(q, geoid(3)), expected)
  resetTractSnapshotCache()
  assert.deepEqual(tractSnapshot(p, geoid(3)), expected)
  assert.equal(JSON.stringify(p), before) // no sort/write into the input
  assert.ok(Object.isFrozen(expected) && Object.isFrozen(expected.worst))
  assert.ok(expected.worst.every(Object.isFrozen))
  assert.ok(Object.isFrozen(expected.canopy))
})

test('#147 uses higherIsBetter even when a metric has a different hotspotSort override', () => {
  // Existing under18 entry is higherIsBetter:true with hotspotSort:'desc'; unlike plantNeed it is not a composite.
  // #147 explicitly takes direction from higherIsBetter, not hotspot sorting or semantic guesses.
  const p = pack(rows(10, (i) => ({ pctUnder18: i })))
  assert.equal(tractSnapshot(p, geoid(0))!.worst[0].badness, 100)
  assert.equal(tractSnapshot(p, geoid(9))!.worst[0].badness, 0)
})

test('#147 audited composite/index exclusions are pinned, immutable and do not alter registry polarity', () => {
  assert.deepEqual(SNAPSHOT_EXCLUDED_METRICS, ['risk', 'plantNeed'])
  assert.ok(Object.isFrozen(SNAPSHOT_EXCLUDED_METRICS))
  assert.equal(METRICS.risk.valueKey, 'nriRiskScore')
  assert.equal(METRICS.plantNeed.higherIsBetter, true)
  assert.equal(METRICS.plantNeed.hotspotSort, 'desc')
})

test('#147 excluded indices never appear in worst even with sufficient finite data and extreme ranks', () => {
  const p = pack(rows(12, (i) => ({ treesPerAcre: i, nriRiskScore: i, plantNeed: 11 - i, pctPoverty: i, medianIncome: i })))
  for (let i = 0; i < 12; i++) {
    const s = tractSnapshot(p, geoid(i))!
    assert.ok(s.worst.every((m) => !SNAPSHOT_EXCLUDED_METRICS.includes(m.metricId)))
    assert.equal(s.worst.length, 2) // only poverty and income qualify for worst; canopy stays separate
    assert.equal(s.canopy!.metricId, 'trees')
  }
  const compositesOnly = pack(rows(10, (i) => ({ nriRiskScore: i, plantNeed: 9 - i })))
  for (let i = 0; i < 10; i++) assert.deepEqual(tractSnapshot(compositesOnly, geoid(i))!.worst, [])
})

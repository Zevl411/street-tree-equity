// #137 slimLines: node --test tests/slimLines.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error — build-time .mjs helper (no types)
import { slimLines, slimLine, assertSlimInvariant } from '../scripts/lib/slim-lines.mjs'

const line = (coords: number[][], properties: Record<string, unknown> = { src: 'footway' }) =>
  ({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties })

test('endpoints kept and near-collinear vertices dropped (~1 m)', () => {
  const c = [[-122.6, 45.5], [-122.59995, 45.500003], [-122.5999, 45.5], [-122.59985, 45.500002], [-122.5998, 45.5]]
  const out = slimLine(c)
  assert.deepEqual(out[0], [-122.6, 45.5])
  assert.deepEqual(out[out.length - 1], [-122.5998, 45.5])
  assert.equal(out.length, 2)
})

test('real corners (> 1 m) survive', () => {
  const c = [[-122.6, 45.5], [-122.6, 45.5001], [-122.5999, 45.5001]] // ~11 m legs
  assert.equal(slimLine(c).length, 3)
})

test('rounds to 5 dp', () => {
  const out = slimLine([[-122.123456789, 45.987654321], [-122.2, 45.9]])
  for (const [x, y] of out) {
    assert.equal(x, +x.toFixed(5))
    assert.equal(y, +y.toFixed(5))
  }
  assert.deepEqual(out[0], [-122.12346, 45.98765])
})

test('collapsed line keeps both endpoints', () => {
  const out = slimLine([[-122.000001, 45.000001], [-122.000002, 45.000002]])
  assert.equal(out.length, 2)
})

test('feature count, properties and ids kept; MultiLineString ok', () => {
  const fc = {
    type: 'FeatureCollection',
    features: [
      line([[0, 0], [0.000001, 0], [0.00001, 0]], { src: 'road', side: 'both' }),
      { ...line([[1, 1], [1.001, 1.001]]), id: 7 },
      { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [[[2, 2], [2.001, 2]], [[3, 3], [3, 3]]] }, properties: { src: 'path', isSidewalk: true } },
    ],
  }
  const out = slimLines(fc)
  assert.equal(out.features.length, 3)
  assert.deepEqual(out.features.map((f: any) => f.properties), fc.features.map((f: any) => f.properties))
  assert.equal(out.features[1].id, 7)
  assert.doesNotThrow(() => assertSlimInvariant(fc, out))
  assert.throws(() => assertSlimInvariant(fc, { ...out, features: out.features.slice(1) }))
})

// #137 amended: mergeByProps (sidewalks only)
// @ts-expect-error — build-time .mjs helper (no types)
import { mergeByProps, assertMergeInvariant, slimAndMergeSidewalks, countParts } from '../scripts/lib/slim-lines.mjs'

test('mergeByProps: one MultiLineString per distinct property set; parts preserved', () => {
  const fc = {
    type: 'FeatureCollection',
    features: [
      line([[0, 0], [0, 0.001]], { src: 'footway', isSidewalk: true }),
      line([[1, 0], [1, 0.001]], { src: 'road', side: 'both' }),
      line([[2, 0], [2, 0.001]], { isSidewalk: true, src: 'footway' }), // same set, different key order
      line([[3, 0], [3, 0.001]], { src: 'road', side: 'left' }),
      line([[4, 0], [4, 0.001]], { src: 'road', side: 'both' }),
    ],
  }
  const out = mergeByProps(fc)
  assert.equal(out.features.length, 3)
  assert.ok(out.features.every((f: any) => f.geometry.type === 'MultiLineString'))
  assert.equal(countParts(out), 5)
  const both = out.features.find((f: any) => f.properties.side === 'both')
  assert.deepEqual(both.geometry.coordinates, [[[1, 0], [1, 0.001]], [[4, 0], [4, 0.001]]])
  const r = assertMergeInvariant(fc, out)
  assert.deepEqual(r, { preFeatures: 5, parts: 5, features: 3, propSets: 3 })
  // idempotent: merging an already-merged FC changes nothing
  assert.deepEqual(mergeByProps(out), out)
})

test('assertMergeInvariant fails on lost part or lost property set', () => {
  const fc = { type: 'FeatureCollection', features: [line([[0, 0], [0, 1]], { src: 'path' }), line([[1, 0], [1, 1]], { src: 'road' })] }
  const out = mergeByProps(fc)
  assert.throws(() => assertMergeInvariant(fc, { ...out, features: out.features.slice(1) }))
  const dropped = { ...out, features: [{ ...out.features[0], geometry: { type: 'MultiLineString', coordinates: [] } }, out.features[1]] }
  assert.throws(() => assertMergeInvariant(fc, dropped))
})

test('slimAndMergeSidewalks: 5 dp, endpoints kept, parts == input features', () => {
  const fc = { type: 'FeatureCollection', features: [
    line([[-122.1234567, 45.1], [-122.12341, 45.1000001], [-122.1233, 45.1]]),
    line([[-122.2, 45.2], [-122.2, 45.2001]]),
  ] }
  const r = slimAndMergeSidewalks(fc)
  assert.equal(r.parts, 2)
  assert.equal(r.fc.features.length, 1)
  const [p0] = r.fc.features[0].geometry.coordinates
  assert.deepEqual(p0[0], [-122.12346, 45.1])
  assert.deepEqual(p0[p0.length - 1], [-122.1233, 45.1])
})

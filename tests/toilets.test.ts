// #132 OSM public toilets helpers: node --test tests/toilets.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error — build-time .mjs helper (no types)
import { excludedToilet, toiletProps, applyToilets } from '../scripts/lib/toilets.mjs'

test('public / permissive / untagged access kept', () => {
  for (const access of [undefined, 'yes', 'permissive', 'public']) assert.equal(excludedToilet(access ? { amenity: 'toilets', access } : { amenity: 'toilets' }), false)
})
test('private / no / customers excluded', () => {
  for (const access of ['private', 'no', 'customers']) assert.equal(excludedToilet({ amenity: 'toilets', access }), true)
})
test('disused / abandoned excluded', () => {
  assert.equal(excludedToilet({ amenity: 'toilets', disused: 'yes' }), true)
  assert.equal(excludedToilet({ amenity: 'toilets', 'disused:amenity': 'toilets' }), true)
  assert.equal(excludedToilet({ amenity: 'toilets', 'abandoned:amenity': 'toilets' }), true)
})
test('props: kind required, soft booleans only when =yes', () => {
  assert.deepEqual(toiletProps({ amenity: 'toilets' }), { kind: 'toilets' })
  assert.deepEqual(toiletProps({ amenity: 'toilets', name: 'Park WC', fee: 'yes', wheelchair: 'yes', changing_table: 'yes' }),
    { kind: 'toilets', name: 'Park WC', fee: true, wheelchair: true, changing_table: true })
  assert.deepEqual(toiletProps({ amenity: 'toilets', fee: 'no', wheelchair: 'limited' }), { kind: 'toilets' })
})
test('applyToilets counts inside + nearest km; empty → no nearest', () => {
  const sq = { type: 'Feature', properties: { centroid: [0.5, 0.5] }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } }
  const pt = (x: number, y: number) => ({ type: 'Feature', properties: { kind: 'toilets' }, geometry: { type: 'Point', coordinates: [x, y] } })
  const r = applyToilets([sq], [pt(0.5, 0.5), pt(0.2, 0.2), pt(2, 2)])
  assert.equal(r.toilets, 3)
  assert.equal(sq.properties.toiletsInside, 2)
  assert.equal((sq.properties as { nearestToiletKm?: number }).nearestToiletKm, 0)
  const empty = { ...sq, properties: { centroid: [0.5, 0.5] } }
  applyToilets([empty], [])
  assert.equal((empty.properties as { toiletsInside?: number }).toiletsInside, 0)
  assert.equal('nearestToiletKm' in empty.properties, false)
})

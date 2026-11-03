// #118 parser unit tests: node --test tests/dualParam.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dualPairAvailable, encodeDualParam, parseDualParam } from '../src/utils/dualParam.ts'
import { resolveMetric } from '../src/utils/metrics.ts'

const p = (raw: string | null) => parseDualParam(raw, resolveMetric)

test('valid pair, left first', () => assert.deepEqual(p('trees,risk'), { left: 'trees', right: 'risk' }))
test('case-insensitive', () => {
  assert.deepEqual(p('TREES,Risk'), { left: 'trees', right: 'risk' })
  assert.deepEqual(p('novehicle,FOODACCESS'), { left: 'noVehicle', right: 'foodAccess' })
})
test('whitespace trimmed', () => assert.deepEqual(p('  trees ,  asthma '), { left: 'trees', right: 'asthma' }))
test('aliases resolve like ?metric=', () => {
  assert.deepEqual(p('children,casthma'), { left: 'under18', right: 'asthma' })
  assert.deepEqual(p('under18plus,trees'), { left: 'under18', right: 'trees' })
})
test('identical (incl. via alias) → null', () => {
  assert.equal(p('trees,trees'), null)
  assert.equal(p('asthma,CASTHMA'), null)
})
test('unknown → null', () => {
  assert.equal(p('trees,bogus'), null)
  assert.equal(p('bogus,risk'), null)
})
test('missing / single / empty / >2 → null', () => {
  assert.equal(p(null), null)
  assert.equal(p(''), null)
  assert.equal(p('trees'), null)
  assert.equal(p('trees,'), null)
  assert.equal(p(',risk'), null)
  assert.equal(p('trees,risk,parks'), null)
})
test('availability: both in pack and ≥2 metrics', () => {
  const pair = p('trees,risk')
  assert.equal(dualPairAvailable(pair, ['trees', 'risk', 'parks']), true)
  assert.equal(dualPairAvailable(pair, ['trees', 'parks']), false)
  assert.equal(dualPairAvailable(pair, ['trees']), false)
  assert.equal(dualPairAvailable(null, ['trees', 'risk']), false)
})
test('encode lowercase, left first; round-trips', () => {
  assert.equal(encodeDualParam('noVehicle', 'trees'), 'novehicle,trees')
  assert.deepEqual(p(encodeDualParam('foodAccess', 'rentBurden')), { left: 'foodAccess', right: 'rentBurden' })
})

test('#120 lep resolves with aliases and round-trips in ?dual=', () => {
  assert.deepEqual(p('trees,lep'), { left: 'trees', right: 'lep' })
  assert.deepEqual(p('LimitedEnglish,diabetes'), { left: 'lep', right: 'diabetes' })
  assert.equal(resolveMetric('english'), 'lep')
  assert.equal(resolveMetric('LEP'), 'lep')
})

test('#123 snap resolves with aliases and round-trips in ?dual=', () => {
  assert.deepEqual(p('trees,snap'), { left: 'trees', right: 'snap' })
  assert.deepEqual(p('FoodStamps,lep'), { left: 'snap', right: 'lep' })
  assert.equal(resolveMetric('pctsnap'), 'snap')
  assert.equal(resolveMetric('SNAP'), 'snap')
  assert.equal(encodeDualParam('snap', 'trees'), 'snap,trees')
})

test('#124 plantNeed resolves with aliases and round-trips in ?dual=', () => {
  assert.deepEqual(p('trees,plantNeed'), { left: 'trees', right: 'plantNeed' })
  assert.equal(resolveMetric('plantneed'), 'plantNeed')
  assert.equal(resolveMetric('NEED'), 'plantNeed')
  assert.equal(encodeDualParam('trees', 'plantNeed'), 'trees,plantneed')
  assert.deepEqual(p(encodeDualParam('trees', 'plantNeed')), { left: 'trees', right: 'plantNeed' })
})

test('#125 mentalHealth resolves with aliases and round-trips in ?dual=', () => {
  assert.deepEqual(p('trees,mentalHealth'), { left: 'trees', right: 'mentalHealth' })
  assert.deepEqual(p('MHLTH,obesity'), { left: 'mentalHealth', right: 'obesity' })
  assert.equal(resolveMetric('mental'), 'mentalHealth')
  assert.equal(resolveMetric('MENTALHEALTH'), 'mentalHealth')
  assert.equal(encodeDualParam('mentalHealth', 'trees'), 'mentalhealth,trees')
})

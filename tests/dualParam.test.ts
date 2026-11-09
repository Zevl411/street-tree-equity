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

test('#127 physicalHealth resolves with aliases and round-trips in ?dual=', () => {
  assert.deepEqual(p('trees,physicalHealth'), { left: 'trees', right: 'physicalHealth' })
  assert.deepEqual(p('PHLTH,mentalHealth'), { left: 'physicalHealth', right: 'mentalHealth' })
  assert.equal(resolveMetric('physical'), 'physicalHealth')
  assert.equal(resolveMetric('PHYSICALHEALTH'), 'physicalHealth')
  assert.equal(encodeDualParam('physicalHealth', 'trees'), 'physicalhealth,trees')
})

test('#129 chd resolves with alias heart and round-trips in ?dual=', () => {
  assert.deepEqual(p('trees,chd'), { left: 'trees', right: 'chd' })
  assert.deepEqual(p('HEART,physicalHealth'), { left: 'chd', right: 'physicalHealth' })
  assert.equal(resolveMetric('CHD'), 'chd')
  assert.equal(encodeDualParam('chd', 'trees'), 'chd,trees')
})

test('#131 bphigh resolves with aliases bp/hypertension and round-trips in ?dual=', () => {
  assert.deepEqual(p('trees,bphigh'), { left: 'trees', right: 'bphigh' })
  assert.deepEqual(p('BP,chd'), { left: 'bphigh', right: 'chd' })
  assert.equal(resolveMetric('hypertension'), 'bphigh')
  assert.equal(resolveMetric('BPHIGH'), 'bphigh')
  assert.equal(encodeDualParam('bphigh', 'trees'), 'bphigh,trees')
})

test('#133 inactivity resolves with aliases lpa/activity and round-trips in ?dual=', () => {
  assert.deepEqual(p('trees,inactivity'), { left: 'trees', right: 'inactivity' })
  assert.deepEqual(p('LPA,bphigh'), { left: 'inactivity', right: 'bphigh' })
  assert.equal(resolveMetric('activity'), 'inactivity')
  assert.equal(resolveMetric('INACTIVITY'), 'inactivity')
  assert.equal(encodeDualParam('inactivity', 'trees'), 'inactivity,trees')
})

test('#136 copd resolves with aliases lung and round-trips in ?dual=', () => {
  assert.deepEqual(p('trees,copd'), { left: 'trees', right: 'copd' })
  assert.deepEqual(p('LUNG,inactivity'), { left: 'copd', right: 'inactivity' })
  assert.equal(resolveMetric('lung'), 'copd')
  assert.equal(resolveMetric('COPD'), 'copd')
  assert.equal(encodeDualParam('copd', 'trees'), 'copd,trees')
})

test('#138 smoking resolves with aliases tobacco/cigarettes and round-trips in ?dual=', () => {
  assert.deepEqual(p('trees,smoking'), { left: 'trees', right: 'smoking' })
  assert.deepEqual(p('TOBACCO,copd'), { left: 'smoking', right: 'copd' })
  assert.equal(resolveMetric('cigarettes'), 'smoking')
  assert.equal(resolveMetric('SMOKING'), 'smoking')
  assert.equal(encodeDualParam('smoking', 'trees'), 'smoking,trees')
})

test('#141 stroke resolves with alias cerebrovascular and round-trips in ?dual=', () => {
  assert.deepEqual(p('trees,stroke'), { left: 'trees', right: 'stroke' })
  assert.deepEqual(p('CEREBROVASCULAR,smoking'), { left: 'stroke', right: 'smoking' })
  assert.equal(resolveMetric('cerebrovascular'), 'stroke')
  assert.equal(resolveMetric('STROKE'), 'stroke')
  assert.equal(encodeDualParam('stroke', 'trees'), 'stroke,trees')
})

test('#143 disability resolves (no accessibility alias) and round-trips in ?dual=', () => {
  assert.deepEqual(p('trees,disability'), { left: 'trees', right: 'disability' })
  assert.deepEqual(p('DISABILITY,stroke'), { left: 'disability', right: 'stroke' })
  assert.equal(resolveMetric('Disability'), 'disability')
  assert.notEqual(resolveMetric('accessibility'), 'disability')
  assert.equal(encodeDualParam('disability', 'trees'), 'disability,trees')
})

test('#144 shortSleep resolves with aliases sleep / "short sleep" (no insomnia/short_sleep) and round-trips in ?dual=', () => {
  assert.equal(resolveMetric('shortSleep'), 'shortSleep')
  assert.equal(resolveMetric('SHORTSLEEP'), 'shortSleep')
  assert.equal(resolveMetric('sleep'), 'shortSleep')
  assert.equal(resolveMetric('short sleep'), 'shortSleep')
  assert.equal(resolveMetric('  Short Sleep '), 'shortSleep')
  assert.equal(resolveMetric(new URLSearchParams('metric=short%20sleep').get('metric')), 'shortSleep')
  assert.equal(resolveMetric('insomnia'), null)
  assert.equal(resolveMetric('short_sleep'), null)
  assert.deepEqual(p('trees,sleep'), { left: 'trees', right: 'shortSleep' })
  assert.deepEqual(p('short sleep,disability'), { left: 'shortSleep', right: 'disability' })
  assert.equal(encodeDualParam('shortSleep', 'trees'), 'shortsleep,trees')
})

test('#146 uninsured resolves all locked aliases, including "no insurance", and round-trips in ?dual=', () => {
  for (const alias of ['uninsured', 'insurance', 'noinsurance', 'no insurance', 'access2', '  No Insurance ']) {
    assert.equal(resolveMetric(alias), 'uninsured', alias)
  }
  assert.equal(resolveMetric(new URLSearchParams('metric=no%20insurance').get('metric')), 'uninsured')
  assert.deepEqual(p('trees,no insurance'), { left: 'trees', right: 'uninsured' })
  assert.deepEqual(p('ACCESS2,shortSleep'), { left: 'uninsured', right: 'shortSleep' })
  assert.equal(encodeDualParam('uninsured', 'trees'), 'uninsured,trees')
})

test('#146 access is NOT an uninsured alias; foodAccess and other aliases are unchanged', () => {
  assert.notEqual(resolveMetric('access'), 'uninsured')
  assert.equal(resolveMetric('access'), null)
  assert.equal(resolveMetric('healthcare'), null)
  assert.equal(resolveMetric('healthinsurance'), null)
  assert.equal(resolveMetric('foodAccess'), 'foodAccess')
})

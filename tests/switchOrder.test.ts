// #143: Layers switch order — cardio trio bphigh → chd → stroke; disability after smoking; asthma/diabetes unmoved.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { METRIC_IDS, METRIC_SWITCH_ORDER } from '../src/utils/metrics.ts'

test('#143/#144 METRIC_SWITCH_ORDER matches the locked AFTER list', () => {
  assert.deepEqual(METRIC_SWITCH_ORDER, [
    'canopy', 'canopyGap', 'trees', 'plantNeed', 'parks', 'groceries', 'risk', 'income', 'foodAccess', 'poverty', 'noVehicle', 'rentBurden', 'age65', 'under18',
    'asthma', 'diabetes', 'lep', 'snap', 'obesity', 'mentalHealth', 'depression', 'physicalHealth', 'bphigh', 'chd', 'stroke', 'inactivity', 'copd', 'smoking', 'disability', 'shortSleep', 'uninsured',
  ])
  assert.equal(new Set(METRIC_SWITCH_ORDER).size, METRIC_IDS.length)
})

test('#150 registry is append-only: depression after uninsured', () => {
  assert.deepEqual(METRIC_IDS.slice(-4), ['disability', 'shortSleep', 'uninsured', 'depression'])
})

// #146: explicit ages 18–64 measure / adults-18+ weight and view CSV CI regression.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { METRICS } from '../src/utils/metrics.ts'
import { PLACES_MEASURES, placesMetricCitation } from '../src/utils/placesMeasures.ts'
import { metricHasCi, toCurrentViewCsv } from '../src/utils/currentViewCsv.ts'
import type { TractProps } from '../src/types.ts'

test('#146 locked copy keeps ages 18–64 explicit and discloses adults-18+ proxy weighting', () => {
  const d = METRICS.uninsured
  assert.equal(d.shortLabel, 'No health insurance')
  assert.equal(d.legendTitle('acre'), 'Adults 18–64 with no health insurance')
  assert.equal(d.hotspotTitle, 'Highest share of adults 18–64 with no health insurance')
  assert.match(d.bmCaption, /18–64/)
  assert.match(d.tooltip!, /adults aged 18–64/)
  assert.match(d.tooltip!, /weighted by adults 18\+/)
  assert.match(d.tooltip!, /no 18–64 denominator/)
  assert.equal(d.higherIsBetter, false)
  assert.equal(d.usesDensityUnit, false)
  assert.equal(d.percentPoints, true)
  assert.deepEqual(PLACES_MEASURES.uninsured, ['ACCESS2', 'Current lack of health insurance among adults aged 18-64 years', 'current lack of health insurance among adults aged 18–64'])
  const c = placesMetricCitation('uninsured', { ACCESS2: 2023 })!
  assert.match(c, /aged 18-64 years/)
  assert.match(c, /self-reported current lack of health insurance among adults aged 18–64/)
  const src = readFileSync(new URL('../src/components/TractDetails.vue', import.meta.url), 'utf8')
  assert.match(src, /v-if="tract.pctUninsured != null">Adults 18–64 with no health insurance/)
  assert.ok(src.indexOf('v-if="tract.pctUninsured != null"') > src.indexOf('v-if="tract.pctShortSleep != null"'))
})

test('#146 current-view CSV emits uninsured 45.3 and 95% CI 37.6–53.3', () => {
  assert.equal(metricHasCi('uninsured'), true)
  const props = { geoid: '12086002404', name: 'Tract 24.04', treesPerAcre: 1, pctUninsured: 45.3, pctUninsuredLo: 37.6, pctUninsuredHi: 53.3 } as unknown as TractProps
  const csv = toCurrentViewCsv({ rows: [{ cityId: 'central-miami-fl', props }], metrics: ['uninsured'], unit: 'acre', comments: [] })
  const [h, r] = csv.trimEnd().split('\r\n').map((l) => l.split(','))
  assert.equal(r[h.indexOf('metric_value')], '45.3')
  assert.equal(r[h.indexOf('metric_ci_lo')], '37.6')
  assert.equal(r[h.indexOf('metric_ci_hi')], '53.3')
})

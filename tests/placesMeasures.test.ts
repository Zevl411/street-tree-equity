// #140: shared PLACES map stays in sync with the metric registry and the join script's MEASURES.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { METRICS, METRIC_IDS, type MetricId } from '../src/utils/metrics.ts'
import { PLACES_MEASURES, PLACES_METRIC_IDS, PLACES_DATA_IDS, placesMetricCitation } from '../src/utils/placesMeasures.ts'
import { CSV_VIEW_TOOLTIP, citationLines } from '../src/utils/currentViewCsv.ts'
import type { Meta } from '../src/types.ts'

/** PLACES metrics in the registry: tooltip cites "(CDC PLACES)". */
const registryPlacesIds = METRIC_IDS.filter((id) => /\(CDC PLACES\)/.test(METRICS[id].tooltip ?? ''))

/** `{ measure, metricId }` pairs parsed from scripts/add-cdc-places.mjs MEASURES (script has top-level side effects; not importable). */
function scriptMeasures(): { measure: string; metricId: string }[] {
  const src = readFileSync(new URL('../scripts/add-cdc-places.mjs', import.meta.url), 'utf8')
  const block = src.match(/const MEASURES = \[([\s\S]*?)\n\]/)
  assert.ok(block, 'MEASURES array not found in add-cdc-places.mjs')
  return [...block[1].matchAll(/measure: '([A-Z0-9]+)', metricId: '(\w+)'/g)].map((m) => ({ measure: m[1], metricId: m[2] }))
}

test('#140 every PLACES MetricId in metrics.ts has a PLACES_MEASURES entry (and vice versa)', () => {
  assert.ok(registryPlacesIds.length >= 10)
  assert.deepEqual([...registryPlacesIds].sort(), [...PLACES_METRIC_IDS].sort())
  for (const id of PLACES_METRIC_IDS) assert.ok(METRIC_IDS.includes(id), `${id} not a MetricId`)
})

test('#140 every PLACES_MEASURES measure is in add-cdc-places.mjs MEASURES with the same metricId', () => {
  const ms = scriptMeasures()
  assert.equal(ms.length, PLACES_DATA_IDS.length)
  for (const id of PLACES_DATA_IDS) {
    const [measure] = PLACES_MEASURES[id]!
    const hit = ms.find((m) => m.measure === measure)
    assert.ok(hit, `${id}: ${measure} missing from MEASURES`)
    assert.equal(hit.metricId, id, `${measure} metricId mismatch`)
  }
})

test('#140 entries are complete and unique', () => {
  const measures = new Set<string>()
  for (const id of PLACES_DATA_IDS) {
    const [measure, title, topic] = PLACES_MEASURES[id]!
    assert.ok(measure && title && topic, id)
    assert.ok(!measures.has(measure), `duplicate ${measure}`)
    measures.add(measure)
  }
})

test('#140 LPA topic is "no leisure-time physical activity" in App + CSV citations', () => {
  assert.equal(PLACES_MEASURES.inactivity![2], 'no leisure-time physical activity')
  const app = placesMetricCitation('inactivity', { LPA: 2023 })!
  assert.match(app, /self-reported no leisure-time physical activity, not diagnoses/)
  const meta = { cdcPlaces: { release: '2025', measure: 'CASTHMA', measures: ['LPA'], valueType: 'crude', retrievedAt: 'x', sourceUrl: 'y', columns: {}, years: { LPA: 2023 } } } as unknown as Meta
  assert.deepEqual(citationLines(meta, ['inactivity' as MetricId]), [`citation: ${app}`])
})

test('#140 CSV tooltip copy is the Designer-locked string', () => {
  assert.equal(CSV_VIEW_TOOLTIP, 'Download the tracts and metrics in this view as a CSV file')
})

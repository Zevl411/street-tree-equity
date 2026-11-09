// #144: PLACES parity regression — the three PLACES lists must name the same measures, and the full CSV
// header count must equal the row cell count. Lists: PLACES_EXPORT (src/utils/fullCsv.ts),
// PLACES_MEASURES (src/utils/placesMeasures.ts), MEASURES (scripts/add-cdc-places.mjs, parsed — not importable).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { METRICS, METRIC_IDS, type MetricId } from '../src/utils/metrics.ts'
import { PLACES_MEASURES, PLACES_METRIC_IDS } from '../src/utils/placesMeasures.ts'
import { CSV_HEADERS, PLACES_EXPORT, csvRow } from '../src/utils/fullCsv.ts'
import type { Meta, TractProps } from '../src/types.ts'

const PACKS = ['', 'melbourne-fl', 'pembroke-pines-fl', 'central-miami-fl', 'orlando-fl', 'tampa-fl', 'central-jacksonville-fl']

function scriptMeasures(): { measure: string; metricId: string; key: string }[] {
  const src = readFileSync(new URL('../scripts/add-cdc-places.mjs', import.meta.url), 'utf8')
  const block = src.match(/const MEASURES = \[([\s\S]*?)\n\]/)
  assert.ok(block, 'MEASURES array not found in add-cdc-places.mjs')
  return [...block[1].matchAll(/measure: '([A-Z0-9]+)', metricId: '(\w+)', key: '(\w+)'/g)].map((m) => ({ measure: m[1], metricId: m[2], key: m[3] }))
}
const exportIds = (): MetricId[] =>
  PLACES_EXPORT.map(([stem, key]) => {
    const id = METRIC_IDS.find((m) => METRICS[m].valueKey === key)
    assert.ok(id, `PLACES_EXPORT ${stem}: ${key} is not a shared/registered valueKey`)
    return id!
  })
const sorted = <T>(xs: readonly T[]) => [...xs].map(String).sort()

test('#144 PLACES_EXPORT, PLACES_MEASURES and add-cdc-places MEASURES list the same measures', () => {
  const script = scriptMeasures()
  assert.equal(script.length, 16)
  assert.deepEqual(sorted(exportIds()), sorted(PLACES_METRIC_IDS))
  assert.deepEqual(sorted(script.map((m) => m.metricId)), sorted(PLACES_METRIC_IDS))
  assert.deepEqual(sorted(script.map((m) => m.measure)), sorted(PLACES_METRIC_IDS.map((id) => PLACES_MEASURES[id]![0])))
  // same TractProps key per metric in the join script and the CSV list
  for (const m of script) assert.equal(PLACES_EXPORT.find(([, k]) => k === m.key)?.[1], m.key, `${m.measure} key ${m.key} missing from PLACES_EXPORT`)
  // All data/export lists are append-only; the UI switch order is maintained separately.
  assert.deepEqual(exportIds(), script.map((m) => m.metricId))
  assert.deepEqual(script.map((m) => m.metricId), PLACES_METRIC_IDS)
})

test('#144 CSV_HEADERS.length === csvRow cell count (every PLACES value + CI populated)', () => {
  const t: Record<string, unknown> = { geoid: '12086002404', name: 'Tract 24.04' }
  PLACES_EXPORT.forEach(([, k], i) => { t[k] = i + 1; t[`${k}Lo`] = i + 0.5; t[`${k}Hi`] = i + 1.5 })
  const meta = { cityName: 'Miami FL', subtitle: 'x', censusVintage: '2023', generatedAt: 'g' } as unknown as Meta
  const cells = csvRow(t as unknown as TractProps, meta).split(',')
  assert.equal(cells.length, CSV_HEADERS.length)
  PLACES_EXPORT.forEach(([stem], i) => {
    assert.equal(cells[(CSV_HEADERS as readonly string[]).indexOf(`pct_${stem}`)], String(i + 1), stem)
      assert.equal(cells[(CSV_HEADERS as readonly string[]).indexOf(`pct_${stem}_ci_lo`)], String(i + 0.5), stem)
      assert.equal(cells[(CSV_HEADERS as readonly string[]).indexOf(`pct_${stem}_ci_hi`)], String(i + 1.5), stem)
  })
})

test('#144 every pack: years map covers all 16 measures from metadata; SLEEP resolves to 2022 (even-year core)', () => {
  const script = scriptMeasures()
  for (const p of PACKS) {
    const meta = JSON.parse(readFileSync(new URL(`../public/data/${p ? `${p}/` : ''}meta.json`, import.meta.url), 'utf8'))
    const cdc = meta.cdcPlaces
    assert.deepEqual(cdc.measures, script.map((m) => m.measure), p || 'portland')
    assert.deepEqual(sorted(Object.keys(cdc.years)), sorted(cdc.measures), p || 'portland')
    assert.equal(cdc.years.SLEEP, 2022, p || 'portland')
    for (const m of cdc.measures) if (m !== 'SLEEP') assert.equal(cdc.years[m], 2023, `${p || 'portland'} ${m}`)
    assert.equal('dataYear' in cdc, false)
    assert.ok(Array.isArray(meta.metricBreaks?.shortSleep), `${p || 'portland'} breaks`)
    assert.ok(Array.isArray(meta.metricBreaks?.depression), `${p || 'portland'} depression breaks`)
    assert.ok(Array.isArray(meta.metricBreaks?.uninsured), `${p || 'portland'} uninsured breaks`)
    assert.equal(cdc.weightsNote, 'Pack aggregates weight by adults 18+; ACCESS2 covers 18–64')
  }
})

// #143: #23 full CSV — header/row alignment (bug fix: row() had dropped bphigh…stroke, shifting columns left by 15)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CSV_HEADERS, csvRow, toCsv } from '../src/utils/fullCsv.ts'
import type { Meta, TractProps } from '../src/types.ts'

const meta = { cityName: 'Miami FL', subtitle: 'Central Miami', censusVintage: '2023', generatedAt: '2026-11-09' } as unknown as Meta
const tract = {
  geoid: '12086002404', name: 'Census Tract 24.04', county: 'Miami-Dade', treeCount: 10, treesPerAcre: 0.1,
  pctAsthma: 9.1, pctAsthmaLo: 8.1, pctAsthmaHi: 10.2,
  pctChd: 14.8, pctChdLo: 12.9, pctChdHi: 16.8,
  pctBpHigh: 47.5, pctBpHighLo: 44.1, pctBpHighHi: 50.9,
  pctSmoking: 19.3, pctSmokingLo: 16, pctSmokingHi: 23.1,
  pctStroke: 7.7, pctStrokeLo: 6.6, pctStrokeHi: 8.9,
  pctDisability: 49, pctDisabilityLo: 43.5, pctDisabilityHi: 54.8,
  pctShortSleep: 39.8, pctShortSleepLo: 35.4, pctShortSleepHi: 44.5,
  pctUninsured: 45.3, pctUninsuredLo: 37.6, pctUninsuredHi: 53.3,
  pctLep: 41.2, sidewalkKm: 3.5,
} as unknown as TractProps

const cells = (line: string) => line.split(',') // fixture has no quoted cells
const at = (row: string[], h: string) => row[(CSV_HEADERS as readonly string[]).indexOf(h)]

test('#143 full CSV row cell count === CSV_HEADERS.length', () => {
  assert.equal(cells(csvRow(tract, meta)).length, CSV_HEADERS.length)
  assert.equal(CSV_HEADERS.length, 106)
  assert.equal(new Set(CSV_HEADERS).size, CSV_HEADERS.length)
})

test('#143 PLACES values land under their own headers (no column shift)', () => {
  const r = cells(csvRow(tract, meta))
  assert.equal(at(r, 'pct_chd_ci_hi'), '16.8')
  assert.equal(at(r, 'pct_bphigh'), '47.5')
  assert.equal(at(r, 'pct_smoking'), '19.3')
  assert.equal(at(r, 'pct_smoking_ci_hi'), '23.1')
  assert.equal(at(r, 'pct_stroke'), '7.7')
  assert.equal(at(r, 'pct_stroke_ci_lo'), '6.6')
  assert.equal(at(r, 'pct_disability'), '49')
  assert.equal(at(r, 'pct_disability_ci_hi'), '54.8')
  assert.equal(at(r, 'pct_short_sleep'), '39.8')
  assert.equal(at(r, 'pct_short_sleep_ci_lo'), '35.4')
  assert.equal(at(r, 'pct_short_sleep_ci_hi'), '44.5')
  assert.equal(at(r, 'pct_uninsured'), '45.3')
  assert.equal(at(r, 'pct_uninsured_ci_lo'), '37.6')
  assert.equal(at(r, 'pct_uninsured_ci_hi'), '53.3')
  assert.equal(at(r, 'pct_lep'), '41.2')
  assert.equal(at(r, 'sidewalk_km'), '3.5')
  assert.equal(at(r, 'pct_inactivity'), '')
})

test('#143 disability triple appended right after stroke; export order unchanged otherwise', () => {
  const h = CSV_HEADERS as readonly string[]
  assert.deepEqual(h.slice(h.indexOf('pct_chd'), h.indexOf('pct_lep')), [
    'pct_chd', 'pct_chd_ci_lo', 'pct_chd_ci_hi', 'pct_bphigh', 'pct_bphigh_ci_lo', 'pct_bphigh_ci_hi',
    'pct_inactivity', 'pct_inactivity_ci_lo', 'pct_inactivity_ci_hi', 'pct_copd', 'pct_copd_ci_lo', 'pct_copd_ci_hi',
    'pct_smoking', 'pct_smoking_ci_lo', 'pct_smoking_ci_hi', 'pct_stroke', 'pct_stroke_ci_lo', 'pct_stroke_ci_hi',
    'pct_disability', 'pct_disability_ci_lo', 'pct_disability_ci_hi',
    'pct_short_sleep', 'pct_short_sleep_ci_lo', 'pct_short_sleep_ci_hi',
    'pct_uninsured', 'pct_uninsured_ci_lo', 'pct_uninsured_ci_hi', 'pct_depression', 'pct_depression_ci_lo', 'pct_depression_ci_hi',
  ])
  const lines = toCsv([tract], meta).trimEnd().split('\r\n')
  assert.equal(lines[0], CSV_HEADERS.join(','))
  assert.equal(cells(lines[1]).length, cells(lines[0]).length)
})

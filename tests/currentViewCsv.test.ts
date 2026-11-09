// #139 current-view CSV: node --test tests/currentViewCsv.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cell, currentViewComments, metricHasCi, metricHasMoe, textCell, toCurrentViewCsv, viewScope } from '../src/utils/currentViewCsv.ts'
import type { Meta, TractProps } from '../src/types.ts'

const meta = (over: Partial<Meta> = {}): Meta => ({
  cityName: 'Portland, OR', subtitle: 'Central Portland', osmTimestamp: '2026-10-29T05:53:34Z',
  censusVintage: '2023 cartographic boundary (cb_2023_41_tract_500k)',
  acs: { table: 'B19013', vintage: '2020-2024', retrievedAt: '2026-11-03', sourceUrl: 'x' },
  cdcPlaces: { release: '2025', measure: 'CASTHMA', measures: ['CASTHMA', 'COPD'], valueType: 'crude', retrievedAt: '2026-11-09', sourceUrl: 'y', columns: {}, years: { CASTHMA: 2023, COPD: 2023 } },
  ...over,
} as unknown as Meta)

const tract = (geoid: string, over: Record<string, unknown> = {}): TractProps =>
  ({ geoid, name: `Tract ${geoid}`, treesPerAcre: 1.23456, treesPerKm2: 305.0712, ...over } as unknown as TractProps)

const v = (...ts: TractProps[]) => ts.map((props) => ({ cityId: 'portland-or', props }))
const lines = (csv: string) => csv.split('\r\n')
const body = (csv: string) => lines(csv).filter((l) => l && !l.startsWith('# '))

test('single scope: header order, CI cols for PLACES metric, all tracts sorted by geoid, CRLF + trailing CRLF', () => {
  const csv = toCurrentViewCsv({
    rows: v(tract('41051000200', { pctCopd: 6.04, pctCopdLo: 5.5, pctCopdHi: 6.6 }), tract('41051000100', { pctCopd: 7 })),
    metrics: ['copd'], unit: 'acre', comments: [],
  })
  assert.ok(csv.endsWith('\r\n'))
  assert.ok(!/[^\r]\n/.test(csv), 'no bare LF')
  assert.notEqual(csv.charCodeAt(0), 0xfeff, 'no BOM')
  const [h, r1, r2] = body(csv)
  assert.equal(h, 'geoid,tract_name,canopy,canopy_unit,metric_id,metric_label,metric_value,metric_unit,metric_ci_lo,metric_ci_hi')
  assert.equal(r1, '41051000100,Tract 41051000100,1.2346,trees_per_acre,copd,COPD,7.0,%,,')
  assert.equal(r2, '41051000200,Tract 41051000200,1.2346,trees_per_acre,copd,COPD,6.0,%,5.5,6.6')
})

test('single scope: no CI / MOE columns when metric has none; MOE only for ACS metrics', () => {
  assert.equal(metricHasCi('trees'), false)
  assert.equal(metricHasMoe('trees'), false)
  assert.equal(metricHasCi('copd'), true)
  assert.equal(metricHasMoe('poverty'), true)
  const t = body(toCurrentViewCsv({ rows: v(tract('1')), metrics: ['trees'], unit: 'km2', comments: [] }))
  assert.equal(t[0], 'geoid,tract_name,canopy,canopy_unit,metric_id,metric_label,metric_value,metric_unit')
  // trees: canopy and metric_value intentionally duplicate (km² 2 dp)
  assert.equal(t[1], '1,Tract 1,305.07,trees_per_km2,trees,Street trees,305.07,trees_per_km2')
  const p = body(toCurrentViewCsv({ rows: v(tract('1', { pctPoverty: 12.34, pctPovertyMoe: 3.21 })), metrics: ['poverty'], unit: 'acre', comments: [] }))
  assert.equal(p[0], 'geoid,tract_name,canopy,canopy_unit,metric_id,metric_label,metric_value,metric_unit,metric_moe')
  assert.match(p[1], /,poverty,[^,]+,12\.3,%,3\.2$/)
})

test('null / non-finite → empty cells; currency integer USD without $ or grouping; percent share → points', () => {
  const r = body(toCurrentViewCsv({ rows: v(tract('1', { treesPerAcre: Number.NaN, treesPerKm2: null, medianIncome: 123456.7, medianIncomeMoe: 9876.4 })), metrics: ['income'], unit: 'acre', comments: [] }))[1]
  assert.match(r, /^1,Tract 1,,trees_per_acre,income,[^,]+,123457,USD,9876$/)
  const f = body(toCurrentViewCsv({ rows: v(tract('1', { foodAccessLowShare: 0.4567 })), metrics: ['foodAccess'], unit: 'acre', comments: [] }))[1]
  assert.match(f, /,45\.7,%$/)
  const missing = body(toCurrentViewCsv({ rows: v(tract('1')), metrics: ['copd'], unit: 'acre', comments: [] }))[1]
  assert.ok(!/null|NaN|undefined/.test(missing))
  assert.match(missing, /,copd,COPD,,%,,$/)
})

test('dual scope: a = left, b = right; CI slots emitted for both sides when either side needs them', () => {
  const csv = toCurrentViewCsv({
    rows: v(tract('1', { pctCopd: 6.04, pctCopdLo: 5.5, pctCopdHi: 6.6 })),
    metrics: ['trees', 'copd'], unit: 'acre', comments: [],
  })
  const [h, r] = body(csv)
  assert.equal(h, 'geoid,tract_name,canopy,canopy_unit,metric_a_id,metric_a_label,metric_a_value,metric_a_unit,metric_a_ci_lo,metric_a_ci_hi,metric_b_id,metric_b_label,metric_b_value,metric_b_unit,metric_b_ci_lo,metric_b_ci_hi')
  assert.equal(r, '1,Tract 1,1.2346,trees_per_acre,trees,Street trees,1.2346,trees_per_acre,,,copd,COPD,6.0,%,5.5,6.6')
  assert.equal(viewScope(['trees', 'copd']), 'view-trees-copd')
})

test('compare scope: city_id + city_name lead; city A rows then city B (on-screen order, even when A sorts after B), geoid asc within each', () => {
  const csv = toCurrentViewCsv({
    rows: [
      { cityId: 'tampa-fl', cityName: 'Tampa, FL', props: tract('12057000200', { pctCopd: 8 }) },
      { cityId: 'tampa-fl', cityName: 'Tampa, FL', props: tract('12057000100', { pctCopd: 9 }) },
      { cityId: 'portland-or', cityName: 'Portland, OR', props: tract('41051000200', { pctCopd: 4 }) },
      { cityId: 'portland-or', cityName: 'Portland, OR', props: tract('41051000100', { pctCopd: 5 }) },
    ],
    metrics: ['copd'], unit: 'acre', comments: [], compare: true,
  })
  const b = body(csv)
  assert.equal(b[0], 'city_id,city_name,geoid,tract_name,canopy,canopy_unit,metric_id,metric_label,metric_value,metric_unit,metric_ci_lo,metric_ci_hi')
  assert.deepEqual(b.slice(1).map((l) => l.split(',')[0] + ':' + l.match(/,(\d{11}),/)![1]), ['tampa-fl:12057000100', 'tampa-fl:12057000200', 'portland-or:41051000100', 'portland-or:41051000200'])
  // "Tampa, FL" / "Portland, OR" contain a comma → RFC 4180 quoted
  assert.ok(b[1].startsWith('tampa-fl,"Tampa, FL",12057000100,'))
  assert.ok(b[3].startsWith('portland-or,"Portland, OR",41051000100,'))
  assert.equal(viewScope(['copd'], true), 'view-compare-copd')
})

test('RFC 4180 quoting: comma, quote, CR/LF quoted with doubled quotes; plain text unquoted', () => {
  assert.equal(cell('plain'), 'plain')
  assert.equal(cell('a,b'), '"a,b"')
  assert.equal(cell('say "hi"'), '"say ""hi"""')
  assert.equal(cell('line1\nline2'), '"line1\nline2"')
  assert.equal(cell('cr\rx'), '"cr\rx"')
  assert.equal(cell(null), '')
  const r = body(toCurrentViewCsv({ rows: v(tract('1', { name: 'Elm, "Oak" St' })), metrics: ['trees'], unit: 'acre', comments: [] }))[1]
  assert.ok(r.startsWith('1,"Elm, ""Oak"" St",'))
})

test('formula-injection guard: text cells only; numeric -0.4 stays an unquoted number', () => {
  for (const s of ['=SUM(A1)', '+1', '-cmd', '@x']) assert.equal(textCell(s), `'${s}`)
  assert.equal(textCell('Tract 1'), 'Tract 1')
  const r = body(toCurrentViewCsv({ rows: v(tract('1', { name: '=HYPERLINK("x")', nriRiskScore: -0.4 })), metrics: ['risk'], unit: 'acre', comments: [] }))[1].split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
  assert.equal(r[1], `"'=HYPERLINK(""x"")"`)
  assert.equal(r[6], '-0.4')
  assert.equal(r[7], 'score')
  const neg = body(toCurrentViewCsv({ rows: v(tract('1', { plantNeed: -3 })), metrics: ['plantNeed'], unit: 'acre', comments: [] }))[1]
  assert.match(neg, /,-3,index$/)
})

test('preamble: `# ` lines before header; sources + years from meta (never hardcoded)', () => {
  const m = meta()
  const comments = currentViewComments([{ id: 'portland-or', meta: m }], ['copd'], 'https://x.test/?city=portland-or&metric=copd', new Date(2026, 10, 9))
  const csv = toCurrentViewCsv({ rows: v(tract('1')), metrics: ['copd'], unit: 'acre', comments })
  const ls = lines(csv)
  const hi = ls.findIndex((l) => l.startsWith('geoid,'))
  assert.ok(hi > 0)
  assert.ok(ls.slice(0, hi).every((l) => l.startsWith('# ')))
  assert.equal(ls[0], '# Street Tree Equity — current-view CSV')
  assert.equal(ls[1], '# pack: portland-or · Portland, OR · Central Portland')
  assert.equal(ls[2], '# metric: copd · COPD')
  assert.equal(ls[3], '# generated: 2026-11-09')
  assert.equal(ls[4], '# sources: OSM trees/parks/roads as of 2026-10-29T05:53:34Z; Census 2023 cartographic boundary (cb_2023_41_tract_500k); ACS 2020-2024; CDC PLACES 2025 (BRFSS 2023)')
  assert.match(ls[5], /^# citation: Chronic obstructive pulmonary disease \(COPD\) among adults \(tract\) — CDC PLACES.*\(BRFSS 2023 model-based estimates\)/)
  assert.equal(ls[hi - 1], '# url: https://x.test/?city=portland-or&metric=copd')
  // years follow meta
  const m2 = meta({ cdcPlaces: { ...m.cdcPlaces!, release: '2031', years: { COPD: 2029 } }, acs: { ...m.acs!, vintage: '2025-2029' } })
  const s2 = currentViewComments([{ id: 'p', meta: m2 }], ['copd'], 'u').join('\n')
  assert.match(s2, /ACS 2025-2029; CDC PLACES 2031 \(BRFSS 2029\)/)
  assert.doesNotMatch(s2, /2020-2024|BRFSS 2023/)
  // missing years → no clause, never "undefined"
  const m3 = meta({ osmTimestamp: null, acs: undefined, cdcPlaces: { ...m.cdcPlaces!, years: undefined } })
  const s3 = currentViewComments([{ id: 'p', meta: m3 }], ['trees'], 'u').join('\n')
  assert.doesNotMatch(s3, /undefined|null|NaN|BRFSS/)
  // comment text can't inject rows
  const inj = toCurrentViewCsv({ rows: [], metrics: ['trees'], unit: 'acre', comments: ['a\r\nb,c'] })
  assert.equal(lines(inj)[0], '# a b,c')
})

test('preamble: dual metric line; compare lists both packs + per-pack sources', () => {
  const d = currentViewComments([{ id: 'portland-or', meta: meta() }], ['trees', 'copd'], 'u')
  assert.ok(d.includes('metric: trees · Street trees + copd · COPD'))
  const c = currentViewComments([
    { id: 'portland-or', meta: meta() },
    { id: 'tampa-fl', meta: meta({ cityName: 'Tampa, FL', subtitle: 'Central Tampa', osmTimestamp: '2026-11-09T00:00:00Z' }) },
  ], ['copd'], 'https://x.test/?compare=portland-or,tampa-fl')
  assert.deepEqual(c.filter((l) => l.startsWith('pack: ')), ['pack: portland-or · Portland, OR · Central Portland', 'pack: tampa-fl · Tampa, FL · Central Tampa'])
  assert.equal(c.filter((l) => l.startsWith('sources (portland-or): ')).length, 1)
  assert.match(c.find((l) => l.startsWith('sources (tampa-fl): '))!, /as of 2026-11-09T00:00:00Z/)
  assert.equal(c.at(-1), 'url: https://x.test/?compare=portland-or,tampa-fl')
})

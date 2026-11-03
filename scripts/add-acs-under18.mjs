#!/usr/bin/env node
/**
 * #115: join ACS 5-year B01001 Sex by Age (tract) → % residents under 18 into existing packs.
 *   node scripts/add-acs-under18.mjs public/data[/<city-id>] ...
 * Own B01001 fetch (the #114 age script is not on main; Dev2-owned). Source (keyless table-based summary file;
 * download into gitignored data-raw/acs/; NEVER commit):
 *   https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-b01001.dat
 *   Same vintage as #103 income / #107 poverty / #109 no-vehicle / #111 rent burden (shared via scripts/lib/acs.mjs).
 * under18 = Σ M 003E–006E + Σ F 027E–030E (Under 5 / 5–9 / 10–14 / 15–17; 18–19 _007/_031 excluded).
 * pctUnder18 = 100·under18/001E (1 dp); popUnder18 count; pctUnder5 = 100·(003E+027E)/001E (TractDetails/CSV only).
 * pctUnder18Moe: numerator MOE √Σ(8 M²), denom 001M (0 when controlled), #107 derived-proportion formula.
 * 001E ≤ 0 / missing / sentinel → absent (never 0); also absent when 001E < 50 (logged).
 * meta.metricBreaks.under18 = densityBreaks(values,5); meta.overall.pctUnder18 = 100·Σunder18/Σpop
 * (population-weighted, NOT mean of tract %); meta.overall.pctUnder18Median = median tract %.
 * Build-time only — no runtime Census calls.
 */
import fs from 'node:fs'
import { densityBreaks } from './lib/geo-utils.mjs'
import { ACS_VINTAGE, acsSourceUrl, acsDatPath, tractGeoid, loadPacks, writePack, readAcsTracts } from './lib/acs.mjs'

const TABLE = 'B01001'
const MIN_POP = 50
const SOURCE_URL = acsSourceUrl(TABLE)
const DAT = process.env.ACS_AGE_DAT || acsDatPath(TABLE)
const dirs = process.argv.slice(2)
if (!dirs.length) throw new Error('usage: add-acs-under18.mjs <packDir> [...]')
if (!fs.existsSync(DAT)) throw new Error(`missing ${DAT} — curl -o ${DAT} ${SOURCE_URL}`)

const KIDS = ['003', '004', '005', '006', '027', '028', '029', '030']
const N = ['001', ...KIDS]
const cols = N.flatMap((n) => [`${TABLE}_E${n}`, `${TABLE}_M${n}`])
const packs = loadPacks(dirs)
const want = new Set(packs.flatMap((p) => p.fc.features.map(tractGeoid)))
const rows = await readAcsTracts(DAT, cols, want)
const retrievedAt = process.env.ACS_RETRIEVED || fs.statSync(DAT).mtime.toISOString().slice(0, 10)
const r1 = (x) => Math.round(x * 10) / 10
const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : r1((s[n / 2 - 1] + s[n / 2]) / 2)) : null }
const E = (r, n) => r[`${TABLE}_E${n}`]
const M = (r, n) => r[`${TABLE}_M${n}`]

for (const p of packs) {
  const vals = []
  let sumPop = 0, sumKids = 0, missing = 0, tiny = 0
  for (const f of p.fc.features) {
    delete f.properties.pctUnder18; delete f.properties.pctUnder18Moe; delete f.properties.popUnder18; delete f.properties.pctUnder5
    const r = rows.get(tractGeoid(f))
    if (!r || N.some((n) => E(r, n) == null || E(r, n) < 0)) { missing++; continue }
    const pop = E(r, '001')
    if (!(pop > 0)) { missing++; continue }
    const kids = KIDS.reduce((s, n) => s + E(r, n), 0)
    sumPop += pop; sumKids += kids
    if (pop < MIN_POP) { tiny++; continue }
    const prop = kids / pop
    f.properties.pctUnder18 = r1(100 * prop)
    f.properties.popUnder18 = kids
    f.properties.pctUnder5 = r1((100 * (E(r, '003') + E(r, '027'))) / pop)
    const mNum = KIDS.map((n) => M(r, n))
    if (!mNum.some((x) => x == null || x < 0)) {
      const numMoe2 = mNum.reduce((s, x) => s + x * x, 0)
      const dm = M(r, '001')
      const denMoe2 = dm == null || dm < 0 ? 0 : dm * dm // controlled total → 0
      let rad = numMoe2 - prop ** 2 * denMoe2
      if (rad < 0) rad = numMoe2 + prop ** 2 * denMoe2
      f.properties.pctUnder18Moe = r1((100 * Math.sqrt(rad)) / pop)
    }
    vals.push(f.properties.pctUnder18)
  }
  const m = p.meta
  m.metricBreaks = { ...(m.metricBreaks ?? {}), under18: densityBreaks(vals, 5) }
  m.overall.pctUnder18 = sumPop > 0 ? r1((100 * sumKids) / sumPop) : null
  m.overall.pctUnder18Median = median(vals)
  m.acsUnder18 = { table: TABLE, vintage: ACS_VINTAGE, retrievedAt, sourceUrl: SOURCE_URL }
  m.attribution = { ...m.attribution, acsUnder18: `U.S. Census Bureau ACS 5-year ${TABLE} (${ACS_VINTAGE}), public domain` }
  for (const k of ['acs', 'acsPoverty', 'acsNoVehicle', 'acsRentBurden', 'acsAge']) if (m[k] && m[k].vintage !== ACS_VINTAGE) console.warn(`[acs-under18] WARN ${p.dir}: ${k} vintage ${m[k].vintage} ≠ ${ACS_VINTAGE}`)
  writePack(p)
  const pct = p.fc.features.length ? ((vals.length / p.fc.features.length) * 100).toFixed(1) : '0'
  console.log(`[acs-under18] ${p.dir}: ${vals.length}/${p.fc.features.length} joined (${pct}%), ${missing} missing/zero-pop, ${tiny} nulled pop<${MIN_POP}, breaks ${JSON.stringify(m.metricBreaks.under18)}, overall ${m.overall.pctUnder18}% (median ${m.overall.pctUnder18Median}%)`)
}

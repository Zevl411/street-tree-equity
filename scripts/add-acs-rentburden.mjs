#!/usr/bin/env node
/**
 * #111: join ACS 5-year B25070 gross rent as % of household income (tract) into existing packs.
 *   node scripts/add-acs-rentburden.mjs public/data[/<city-id>] ...
 * Source (keyless table-based summary file; download into gitignored data-raw/acs/; NEVER commit):
 *   https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-b25070.dat
 *   Same vintage as #103 income / #107 poverty / #109 no-vehicle (shared via scripts/lib/acs.mjs).
 * burdened = 007E+008E+009E+010E; denom = 001E − 011E (renters with computed burden; 011E "not computed" excluded).
 * pctRentBurden = 100·burdened/denom (1 dp); pctSevereRentBurden = 100·010E/denom (TractDetails/CSV only).
 * pctRentBurdenMoe: numerator MOE √Σ(007M²…010M²), denom MOE √(001M²+011M²), #107 derived-proportion formula.
 * denom ≤ 0 / missing / sentinel → absent (never 0); also absent when denom < 20 (tiny renter base, logged).
 * meta.metricBreaks.rentBurden = densityBreaks(values,5); meta.overall.pctRentBurden = 100·Σburdened/Σdenom
 * (renter-weighted, NOT mean of tract %); meta.overall.pctRentBurdenMedian = median tract %.
 * Run after add-acs-income / add-acs-poverty / add-acs-novehicle. Build-time only — no runtime Census calls.
 */
import fs from 'node:fs'
import { densityBreaks } from './lib/geo-utils.mjs'
import { ACS_VINTAGE, acsSourceUrl, acsDatPath, tractGeoid, loadPacks, writePack, readAcsTracts } from './lib/acs.mjs'

const TABLE = 'B25070'
const MIN_DENOM = 20
const SOURCE_URL = acsSourceUrl(TABLE)
const DAT = process.env.ACS_RENTBURDEN_DAT || acsDatPath(TABLE)
const dirs = process.argv.slice(2)
if (!dirs.length) throw new Error('usage: add-acs-rentburden.mjs <packDir> [...]')
if (!fs.existsSync(DAT)) throw new Error(`missing ${DAT} — curl -o ${DAT} ${SOURCE_URL}`)

const N = ['001', '007', '008', '009', '010', '011']
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
  let sumDen = 0, sumBur = 0, missing = 0, tiny = 0
  for (const f of p.fc.features) {
    delete f.properties.pctRentBurden; delete f.properties.pctRentBurdenMoe; delete f.properties.pctSevereRentBurden; delete f.properties.rentBurdenBase
    const r = rows.get(tractGeoid(f))
    if (!r || ['001', '007', '008', '009', '010', '011'].some((n) => E(r, n) == null)) { missing++; continue }
    const den = E(r, '001') - E(r, '011')
    if (!(den > 0)) { missing++; continue }
    const bur = E(r, '007') + E(r, '008') + E(r, '009') + E(r, '010')
    // citywide ratio counts every valid renter base, including tiny ones
    sumDen += den; sumBur += bur
    if (den < MIN_DENOM) { tiny++; continue }
    const prop = bur / den
    f.properties.pctRentBurden = r1(100 * prop)
    f.properties.pctSevereRentBurden = r1((100 * E(r, '010')) / den)
    f.properties.rentBurdenBase = den
    const mNum = ['007', '008', '009', '010'].map((n) => M(r, n))
    const mDen = [M(r, '001'), M(r, '011')]
    if (![...mNum, ...mDen].some((x) => x == null)) {
      const numMoe2 = mNum.reduce((s, x) => s + x * x, 0)
      const denMoe2 = mDen.reduce((s, x) => s + x * x, 0)
      let rad = numMoe2 - prop ** 2 * denMoe2
      if (rad < 0) rad = numMoe2 + prop ** 2 * denMoe2
      f.properties.pctRentBurdenMoe = r1((100 * Math.sqrt(rad)) / den)
    }
    vals.push(f.properties.pctRentBurden)
  }
  const m = p.meta
  m.metricBreaks = { ...(m.metricBreaks ?? {}), rentBurden: densityBreaks(vals, 5) }
  m.overall.pctRentBurden = sumDen > 0 ? r1((100 * sumBur) / sumDen) : null
  m.overall.pctRentBurdenMedian = median(vals)
  m.acsRentBurden = { table: TABLE, vintage: ACS_VINTAGE, retrievedAt, sourceUrl: SOURCE_URL }
  m.attribution = { ...m.attribution, acsRentBurden: `U.S. Census Bureau ACS 5-year ${TABLE} (${ACS_VINTAGE}), public domain` }
  for (const k of ['acs', 'acsPoverty', 'acsNoVehicle']) if (m[k] && m[k].vintage !== ACS_VINTAGE) console.warn(`[acs-rentburden] WARN ${p.dir}: ${k} vintage ${m[k].vintage} ≠ ${ACS_VINTAGE}`)
  writePack(p)
  const pct = p.fc.features.length ? ((vals.length / p.fc.features.length) * 100).toFixed(1) : '0'
  console.log(`[acs-rentburden] ${p.dir}: ${vals.length}/${p.fc.features.length} joined (${pct}%), ${missing} missing/zero-denom, ${tiny} nulled denom<${MIN_DENOM}, breaks ${JSON.stringify(m.metricBreaks.rentBurden)}, overall ${m.overall.pctRentBurden}% (median ${m.overall.pctRentBurdenMedian}%)`)
}

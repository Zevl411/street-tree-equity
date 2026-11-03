#!/usr/bin/env node
/**
 * #114: join ACS 5-year B01001 Sex by Age (tract) → % residents age 65+ into existing packs.
 *   node scripts/add-acs-age.mjs public/data[/<city-id>] ...
 * Source (keyless table-based summary file; download into gitignored data-raw/acs/; NEVER commit):
 *   https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-b01001.dat
 *   Same vintage as #103/#107/#109/#111/#115 (shared via scripts/lib/acs.mjs).
 * age65 = Σ M 020E–025E + Σ F 044E–049E (65–66, 67–69, 70–74, 75–79, 80–84, 85+).
 * pctAge65Plus = 100·age65/001E (1 dp); pop65Plus count; pctAge75Plus = 100·(023–025 + 047–049)/001E (TractDetails/CSV only).
 * pctAge65PlusMoe: numerator MOE √Σ(12 M²), denom 001M (0 when controlled), #107 derived-proportion formula.
 * 001E ≤ 0 / missing / sentinel → absent (never 0); also absent when 001E < 50 (logged).
 * meta.metricBreaks.age65 = densityBreaks(values,5); meta.overall.pctAge65Plus = 100·Σage65/Σpop
 * (population-weighted); meta.overall.pctAge65PlusMedian = median tract %.
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
if (!dirs.length) throw new Error('usage: add-acs-age.mjs <packDir> [...]')
if (!fs.existsSync(DAT)) throw new Error(`missing ${DAT} — curl -o ${DAT} ${SOURCE_URL}`)

const OLD = ['020', '021', '022', '023', '024', '025', '044', '045', '046', '047', '048', '049']
const OLD75 = ['023', '024', '025', '047', '048', '049']
const N = ['001', ...OLD]
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
  let sumPop = 0, sumOld = 0, missing = 0, tiny = 0
  for (const f of p.fc.features) {
    delete f.properties.pctAge65Plus; delete f.properties.pctAge65PlusMoe; delete f.properties.pop65Plus; delete f.properties.pctAge75Plus
    const r = rows.get(tractGeoid(f))
    if (!r || N.some((n) => E(r, n) == null || E(r, n) < 0)) { missing++; continue }
    const pop = E(r, '001')
    if (!(pop > 0)) { missing++; continue }
    const old = OLD.reduce((s, n) => s + E(r, n), 0)
    sumPop += pop; sumOld += old
    if (pop < MIN_POP) { tiny++; continue }
    const prop = old / pop
    f.properties.pctAge65Plus = r1(100 * prop)
    f.properties.pop65Plus = old
    f.properties.pctAge75Plus = r1((100 * OLD75.reduce((s, n) => s + E(r, n), 0)) / pop)
    const mNum = OLD.map((n) => M(r, n))
    if (!mNum.some((x) => x == null || x < 0)) {
      const numMoe2 = mNum.reduce((s, x) => s + x * x, 0)
      const dm = M(r, '001')
      const denMoe2 = dm == null || dm < 0 ? 0 : dm * dm // controlled total → 0
      let rad = numMoe2 - prop ** 2 * denMoe2
      if (rad < 0) rad = numMoe2 + prop ** 2 * denMoe2
      f.properties.pctAge65PlusMoe = r1((100 * Math.sqrt(rad)) / pop)
    }
    vals.push(f.properties.pctAge65Plus)
  }
  const m = p.meta
  m.metricBreaks = { ...(m.metricBreaks ?? {}), age65: densityBreaks(vals, 5) }
  m.overall.pctAge65Plus = sumPop > 0 ? r1((100 * sumOld) / sumPop) : null
  m.overall.pctAge65PlusMedian = median(vals)
  m.acsAge = { table: TABLE, vintage: ACS_VINTAGE, retrievedAt, sourceUrl: SOURCE_URL }
  m.attribution = { ...m.attribution, acsAge: `U.S. Census Bureau ACS 5-year ${TABLE} (${ACS_VINTAGE}), public domain` }
  for (const k of ['acs', 'acsPoverty', 'acsNoVehicle', 'acsRentBurden', 'acsUnder18']) if (m[k] && m[k].vintage !== ACS_VINTAGE) console.warn(`[acs-age65] WARN ${p.dir}: ${k} vintage ${m[k].vintage} ≠ ${ACS_VINTAGE}`)
  writePack(p)
  const pct = p.fc.features.length ? ((vals.length / p.fc.features.length) * 100).toFixed(1) : '0'
  console.log(`[acs-age65] ${p.dir}: ${vals.length}/${p.fc.features.length} joined (${pct}%), ${missing} missing/zero-pop, ${tiny} nulled pop<${MIN_POP}, breaks ${JSON.stringify(m.metricBreaks.age65)}, overall ${m.overall.pctAge65Plus}% (median ${m.overall.pctAge65PlusMedian}%)`)
}

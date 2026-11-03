#!/usr/bin/env node
/**
 * #120: join ACS 5-year B16004 (Age by Language Spoken at Home by Ability to Speak English, pop 5+) (tract)
 * → % residents 5+ who speak English less than "very well" (limited English proficiency) into existing packs.
 *   node scripts/add-acs-lep.mjs public/data[/<city-id>] ...
 * Source (keyless table-based summary file; download into gitignored data-raw/acs/; NEVER commit):
 *   https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-b16004.dat
 *   Same vintage as #103/#107/#109/#111/#115 (shared via scripts/lib/acs.mjs).
 * Person-level B16004 only (NOT C16002 households, S1601/DP02, B16001).
 * lep = Σ 36 "well"/"not well"/"not at all" cells (3 age bands × 4 language groups × 3 abilities).
 * pctLep = 100·lep/001E (1 dp); popLep count; pctLepMoe: num MOE √Σ(36 M²), denom 001M, #107 derived-proportion formula.
 * Sanity (log only): lep == 001 − (003+025+047) − Σ "very well".
 * 001E ≤ 0 / missing / sentinel → absent (never 0); also absent when 001E < 50 (logged).
 * meta.metricBreaks.lep = densityBreaks(values,5); meta.overall.pctLep = 100·Σlep/Σ001E (citywide ratio,
 * NOT mean of tract %); meta.overall.pctLepMedian = median tract %. Build-time only — no runtime Census calls.
 */
import fs from 'node:fs'
import { densityBreaks } from './lib/geo-utils.mjs'
import { ACS_VINTAGE, acsSourceUrl, acsDatPath, tractGeoid, loadPacks, writePack, readAcsTracts } from './lib/acs.mjs'

const TABLE = 'B16004'
const MIN_POP = 50
const SOURCE_URL = acsSourceUrl(TABLE)
const DAT = process.env.ACS_LEP_DAT || acsDatPath(TABLE)
const dirs = process.argv.slice(2)
if (!dirs.length) throw new Error('usage: add-acs-lep.mjs <packDir> [...]')
if (!fs.existsSync(DAT)) throw new Error(`missing ${DAT} — curl -o ${DAT} ${SOURCE_URL}`)

const pad = (n) => String(n).padStart(3, '0')
// Age-band "speak only English" cells and language-group header cells (each followed by very well/well/not well/not at all)
const ONLY_EN = ['003', '025', '047']
const LANG_HEADS = [4, 9, 14, 19, 26, 31, 36, 41, 48, 53, 58, 63]
const VERY_WELL = LANG_HEADS.map((h) => pad(h + 1))
const LEP = LANG_HEADS.flatMap((h) => [pad(h + 2), pad(h + 3), pad(h + 4)])
if (LEP.length !== 36) throw new Error('LEP var list must be 36')
const N = ['001', ...LEP]
const CHECK = [...ONLY_EN, ...VERY_WELL]
const cols = [...new Set([...N, ...CHECK])].flatMap((n) => [`${TABLE}_E${n}`, `${TABLE}_M${n}`])
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
  let sumPop = 0, sumLep = 0, missing = 0, tiny = 0, checked = 0, mismatch = 0
  for (const f of p.fc.features) {
    delete f.properties.pctLep; delete f.properties.pctLepMoe; delete f.properties.popLep
    const r = rows.get(tractGeoid(f))
    if (!r || N.some((n) => E(r, n) == null || E(r, n) < 0)) { missing++; continue }
    const pop = E(r, '001')
    if (!(pop > 0)) { missing++; continue }
    const lep = LEP.reduce((s, n) => s + E(r, n), 0)
    if (!CHECK.some((n) => E(r, n) == null || E(r, n) < 0)) {
      checked++
      const alt = pop - CHECK.reduce((s, n) => s + E(r, n), 0)
      if (Math.abs(alt - lep) > 1) { mismatch++; console.warn(`[acs-lep] sanity ${tractGeoid(f)}: Σ36=${lep} vs 001−only−veryWell=${alt}`) }
    }
    sumPop += pop; sumLep += lep
    if (pop < MIN_POP) { tiny++; continue }
    const prop = lep / pop
    f.properties.pctLep = r1(100 * prop)
    f.properties.popLep = lep
    const mNum = LEP.map((n) => M(r, n))
    if (!mNum.some((x) => x == null || x < 0)) {
      const numMoe2 = mNum.reduce((s, x) => s + x * x, 0)
      const dm = M(r, '001')
      const denMoe2 = dm == null || dm < 0 ? 0 : dm * dm
      let rad = numMoe2 - prop ** 2 * denMoe2
      if (rad < 0) rad = numMoe2 + prop ** 2 * denMoe2
      f.properties.pctLepMoe = r1((100 * Math.sqrt(rad)) / pop)
    }
    vals.push(f.properties.pctLep)
  }
  const m = p.meta
  m.metricBreaks = { ...(m.metricBreaks ?? {}), lep: densityBreaks(vals, 5) }
  m.overall.pctLep = sumPop > 0 ? r1((100 * sumLep) / sumPop) : null
  m.overall.pctLepMedian = median(vals)
  m.acsLep = { table: TABLE, vintage: ACS_VINTAGE, retrievedAt, sourceUrl: SOURCE_URL }
  m.attribution = { ...m.attribution, acsLep: `U.S. Census Bureau ACS 5-year ${TABLE} (${ACS_VINTAGE}), public domain` }
  for (const k of ['acs', 'acsPoverty', 'acsNoVehicle', 'acsRentBurden', 'acsAge', 'acsUnder18']) if (m[k] && m[k].vintage !== ACS_VINTAGE) console.warn(`[acs-lep] WARN ${p.dir}: ${k} vintage ${m[k].vintage} ≠ ${ACS_VINTAGE}`)
  writePack(p)
  const pct = p.fc.features.length ? ((vals.length / p.fc.features.length) * 100).toFixed(1) : '0'
  console.log(`[acs-lep] ${p.dir}: ${vals.length}/${p.fc.features.length} joined (${pct}%), ${missing} missing/zero-pop, ${tiny} nulled pop<${MIN_POP}, sanity ${checked - mismatch}/${checked} ok, breaks ${JSON.stringify(m.metricBreaks.lep)}, overall ${m.overall.pctLep}% (median ${m.overall.pctLepMedian}%)`)
}

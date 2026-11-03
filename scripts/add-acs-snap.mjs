#!/usr/bin/env node
/**
 * #123: join ACS 5-year B22001 (Receipt of Food Stamps/SNAP in the Past 12 Months by Presence of People
 * 60 Years and Over for Households) (tract) → % of HOUSEHOLDS that received SNAP into existing packs.
 *   node scripts/add-acs-snap.mjs public/data[/<city-id>] ...
 * Source (keyless table-based summary file; download into gitignored data-raw/acs/; NEVER commit):
 *   https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-b22001.dat
 *   Same vintage as #103/#107/#109/#111/#115/#120 (shared via scripts/lib/acs.mjs).
 * Household universe B22001 only (NOT S2201 subject table, NOT B19058 SNAP+cash assistance).
 * pctSnap = 100·002E/001E (1 dp); hhSnap = 002E; pctSnapMoe: 002M num / 001M den, #107 derived-proportion formula
 * (ratio fallback when radicand < 0). Sanity (log only): 002 + 005 == 001.
 * 001E ≤ 0 / missing / sentinel → absent (never 0); also absent when 001E < 20 households (logged).
 * meta.metricBreaks.snap = densityBreaks(values,5); meta.overall.pctSnap = 100·Σ002/Σ001 (citywide ratio,
 * NOT mean of tract %); meta.overall.pctSnapMedian = median tract %. Build-time only — no runtime Census calls.
 */
import fs from 'node:fs'
import { densityBreaks } from './lib/geo-utils.mjs'
import { ACS_VINTAGE, acsSourceUrl, acsDatPath, tractGeoid, loadPacks, writePack, readAcsTracts } from './lib/acs.mjs'

const TABLE = 'B22001'
const MIN_HH = 20
const SOURCE_URL = acsSourceUrl(TABLE)
const DAT = process.env.ACS_SNAP_DAT || acsDatPath(TABLE)
const dirs = process.argv.slice(2)
if (!dirs.length) throw new Error('usage: add-acs-snap.mjs <packDir> [...]')
if (!fs.existsSync(DAT)) throw new Error(`missing ${DAT} — curl -o ${DAT} ${SOURCE_URL}`)

const cols = ['001', '002', '005'].flatMap((n) => [`${TABLE}_E${n}`, `${TABLE}_M${n}`])
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
  let sumHh = 0, sumSnap = 0, missing = 0, tiny = 0, checked = 0, mismatch = 0
  for (const f of p.fc.features) {
    delete f.properties.pctSnap; delete f.properties.pctSnapMoe; delete f.properties.hhSnap
    const r = rows.get(tractGeoid(f))
    const hh = r ? E(r, '001') : null
    const snap = r ? E(r, '002') : null
    if (hh == null || snap == null || hh < 0 || snap < 0 || !(hh > 0)) { missing++; continue }
    const no = E(r, '005')
    if (no != null && no >= 0) {
      checked++
      if (Math.abs(snap + no - hh) > 1) { mismatch++; console.warn(`[acs-snap] sanity ${tractGeoid(f)}: 002+005=${snap + no} vs 001=${hh}`) }
    }
    sumHh += hh; sumSnap += snap
    if (hh < MIN_HH) { tiny++; continue }
    const prop = snap / hh
    f.properties.pctSnap = r1(100 * prop)
    f.properties.hhSnap = snap
    const nm = M(r, '002')
    if (nm != null && nm >= 0) {
      const dm = M(r, '001')
      const denMoe2 = dm == null || dm < 0 ? 0 : dm * dm
      let rad = nm * nm - prop ** 2 * denMoe2
      if (rad < 0) rad = nm * nm + prop ** 2 * denMoe2
      f.properties.pctSnapMoe = r1((100 * Math.sqrt(rad)) / hh)
    }
    vals.push(f.properties.pctSnap)
  }
  const m = p.meta
  m.metricBreaks = { ...(m.metricBreaks ?? {}), snap: densityBreaks(vals, 5) }
  m.overall.pctSnap = sumHh > 0 ? r1((100 * sumSnap) / sumHh) : null
  m.overall.pctSnapMedian = median(vals)
  m.acsSnap = { table: TABLE, vintage: ACS_VINTAGE, retrievedAt, sourceUrl: SOURCE_URL }
  m.attribution = { ...m.attribution, acsSnap: `U.S. Census Bureau ACS 5-year ${TABLE} (${ACS_VINTAGE}), public domain` }
  for (const k of ['acs', 'acsPoverty', 'acsNoVehicle', 'acsRentBurden', 'acsAge', 'acsUnder18', 'acsLep']) if (m[k] && m[k].vintage !== ACS_VINTAGE) console.warn(`[acs-snap] WARN ${p.dir}: ${k} vintage ${m[k].vintage} ≠ ${ACS_VINTAGE}`)
  writePack(p)
  const pct = p.fc.features.length ? ((vals.length / p.fc.features.length) * 100).toFixed(1) : '0'
  console.log(`[acs-snap] ${p.dir}: ${vals.length}/${p.fc.features.length} joined (${pct}%), ${missing} missing/zero-hh, ${tiny} nulled hh<${MIN_HH}, sanity ${checked - mismatch}/${checked} ok, breaks ${JSON.stringify(m.metricBreaks.snap)}, overall ${m.overall.pctSnap}% (median ${m.overall.pctSnapMedian}%)`)
}

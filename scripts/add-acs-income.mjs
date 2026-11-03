#!/usr/bin/env node
/**
 * #103: join ACS 5-year B19013 median household income (tract) into existing packs.
 *   node scripts/add-acs-income.mjs public/data[/<city-id>] ...
 * Source (keyless table-based summary file; download into gitignored data-raw/acs/; NEVER commit):
 *   https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-b19013.dat
 *   Vintage 2020-2024 ACS 5-year (newest complete 5-year at build). Pipe-delimited: GEO_ID|B19013_E001|B19013_M001.
 * Join GEO_ID (strip 1400000US) ↔ tract geoid (padStart 11). Writes medianIncome (B19013_001E, USD int),
 * medianIncomeMoe (B19013_001M); Census sentinels (negative / blank) → absent, never 0.
 * meta.metricBreaks.income = densityBreaks(values,5); meta.overall.medianIncome = MEDIAN (not mean);
 * meta.acs { table, vintage, retrievedAt, sourceUrl }. Trees/parks/groceries/risk untouched.
 * Run after build-city-pack / build-data. Build-time only — no runtime Census calls.
 */
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { densityBreaks } from './lib/geo-utils.mjs'

const YEAR = process.env.ACS_YEAR || '2024'
const VINTAGE = `${+YEAR - 4}-${YEAR}`
const SOURCE_URL = `https://www2.census.gov/programs-surveys/acs/summary_file/${YEAR}/table-based-SF/data/5YRData/acsdt5y${YEAR}-b19013.dat`
const DAT = process.env.ACS_DAT || `data-raw/acs/acsdt5y${YEAR}-b19013.dat`
const dirs = process.argv.slice(2)
if (!dirs.length) throw new Error('usage: add-acs-income.mjs <packDir> [...]')
if (!fs.existsSync(DAT)) throw new Error(`missing ${DAT} — curl -o ${DAT} ${SOURCE_URL}`)

const packs = dirs.map((dir) => ({
  dir,
  meta: JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')),
  fc: JSON.parse(fs.readFileSync(path.join(dir, 'tracts-equity.geojson'), 'utf8')),
}))
const gid = (f) => String(f.properties.geoid).padStart(11, '0')
const want = new Set(packs.flatMap((p) => p.fc.features.map(gid)))
const rows = new Map()
let hdr = null
for await (const line of readline.createInterface({ input: fs.createReadStream(DAT) })) {
  const c = line.split('|')
  if (!hdr) { hdr = Object.fromEntries(c.map((h, i) => [h.replace(/^\uFEFF/, ''), i])); continue }
  const g = c[hdr.GEO_ID] ?? ''
  if (!g.startsWith('1400000US')) continue
  const id = g.slice(9).padStart(11, '0')
  if (!want.has(id)) continue
  const num = (k) => { const s = c[hdr[k]]; const v = s === '' || s == null ? NaN : Number(s); return Number.isFinite(v) && v >= 0 ? Math.round(v) : null }
  rows.set(id, { medianIncome: num('B19013_E001'), medianIncomeMoe: num('B19013_M001') })
}
const retrievedAt = process.env.ACS_RETRIEVED || fs.statSync(DAT).mtime.toISOString().slice(0, 10)
const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : Math.round((s[n / 2 - 1] + s[n / 2]) / 2)) : null }
for (const p of packs) {
  const vals = []
  for (const f of p.fc.features) {
    delete f.properties.medianIncome; delete f.properties.medianIncomeMoe
    const r = rows.get(gid(f))
    if (!r || r.medianIncome == null) continue
    f.properties.medianIncome = r.medianIncome
    if (r.medianIncomeMoe != null) f.properties.medianIncomeMoe = r.medianIncomeMoe
    vals.push(r.medianIncome)
  }
  const m = p.meta
  m.metricBreaks = { ...(m.metricBreaks ?? {}), income: densityBreaks(vals, 5) }
  m.overall.medianIncome = median(vals)
  m.acs = { table: 'B19013', vintage: VINTAGE, retrievedAt, sourceUrl: SOURCE_URL }
  m.attribution = { ...m.attribution, acs: `U.S. Census Bureau ACS 5-year B19013 (${VINTAGE}), public domain` }
  fs.writeFileSync(path.join(p.dir, 'tracts-equity.geojson'), JSON.stringify(p.fc))
  fs.writeFileSync(path.join(p.dir, 'meta.json'), JSON.stringify(m))
  const pct = p.fc.features.length ? ((vals.length / p.fc.features.length) * 100).toFixed(1) : '0'
  console.log(`[acs] ${p.dir}: ${vals.length}/${p.fc.features.length} joined (${pct}%), breaks ${JSON.stringify(m.metricBreaks.income)}, median ${m.overall.medianIncome}`)
}

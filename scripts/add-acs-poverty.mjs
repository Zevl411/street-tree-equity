#!/usr/bin/env node
/**
 * #107: join ACS 5-year B17001 poverty status (tract) into existing packs.
 *   node scripts/add-acs-poverty.mjs public/data[/<city-id>] ...
 * Source (keyless table-based summary file; download into gitignored data-raw/acs/; NEVER commit):
 *   https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-b17001.dat
 *   Same vintage as #103 income (2020-2024 ACS 5-year; ACS_YEAR env shared via scripts/lib/acs.mjs).
 * pctPoverty = 100 * B17001_002E / B17001_001E (1 decimal); pctPovertyMoe = derived-proportion MOE
 *   (Census: sqrt(M002² − p²·M001²)/E001, falling back to + when radicand < 0) × 100.
 * 001E missing / 0 / sentinel → absent (never 0).
 * meta.metricBreaks.poverty = densityBreaks(values,5); meta.overall.pctPoverty = 100·Σ002E/Σ001E (pop-weighted,
 * NOT mean of tract %); meta.overall.pctPovertyMedian = median tract %. meta.acsPoverty { table, vintage, retrievedAt, sourceUrl }.
 * Other metrics untouched. Run after build-city-pack / add-acs-income. Build-time only — no runtime Census calls.
 */
import fs from 'node:fs'
import { densityBreaks } from './lib/geo-utils.mjs'
import { ACS_VINTAGE, acsSourceUrl, acsDatPath, tractGeoid, loadPacks, writePack, readAcsTracts } from './lib/acs.mjs'

const TABLE = 'B17001'
const SOURCE_URL = acsSourceUrl(TABLE)
const DAT = process.env.ACS_POVERTY_DAT || acsDatPath(TABLE)
const dirs = process.argv.slice(2)
if (!dirs.length) throw new Error('usage: add-acs-poverty.mjs <packDir> [...]')
if (!fs.existsSync(DAT)) throw new Error(`missing ${DAT} — curl -o ${DAT} ${SOURCE_URL}`)

const packs = loadPacks(dirs)
const want = new Set(packs.flatMap((p) => p.fc.features.map(tractGeoid)))
const rows = await readAcsTracts(DAT, ['B17001_E001', 'B17001_M001', 'B17001_E002', 'B17001_M002'], want)
const retrievedAt = process.env.ACS_RETRIEVED || fs.statSync(DAT).mtime.toISOString().slice(0, 10)
const r1 = (x) => Math.round(x * 10) / 10
const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : r1((s[n / 2 - 1] + s[n / 2]) / 2)) : null }

for (const p of packs) {
  const vals = []
  let sum1 = 0, sum2 = 0
  for (const f of p.fc.features) {
    delete f.properties.pctPoverty; delete f.properties.pctPovertyMoe
    const r = rows.get(tractGeoid(f))
    if (!r || !r.B17001_E001 || r.B17001_E002 == null) continue
    const tot = r.B17001_E001, below = r.B17001_E002
    const prop = below / tot
    f.properties.pctPoverty = r1(100 * prop)
    if (r.B17001_M001 != null && r.B17001_M002 != null) {
      let rad = r.B17001_M002 ** 2 - prop ** 2 * r.B17001_M001 ** 2
      if (rad < 0) rad = r.B17001_M002 ** 2 + prop ** 2 * r.B17001_M001 ** 2
      f.properties.pctPovertyMoe = r1((100 * Math.sqrt(rad)) / tot)
    }
    vals.push(f.properties.pctPoverty)
    sum1 += tot; sum2 += below
  }
  const m = p.meta
  m.metricBreaks = { ...(m.metricBreaks ?? {}), poverty: densityBreaks(vals, 5) }
  m.overall.pctPoverty = sum1 > 0 ? r1((100 * sum2) / sum1) : null
  m.overall.pctPovertyMedian = median(vals)
  m.acsPoverty = { table: TABLE, vintage: ACS_VINTAGE, retrievedAt, sourceUrl: SOURCE_URL }
  m.attribution = { ...m.attribution, acsPoverty: `U.S. Census Bureau ACS 5-year ${TABLE} (${ACS_VINTAGE}), public domain` }
  if (m.acs && m.acs.vintage !== ACS_VINTAGE) console.warn(`[acs-poverty] WARN ${p.dir}: income vintage ${m.acs.vintage} ≠ ${ACS_VINTAGE}`)
  writePack(p)
  const pct = p.fc.features.length ? ((vals.length / p.fc.features.length) * 100).toFixed(1) : '0'
  console.log(`[acs-poverty] ${p.dir}: ${vals.length}/${p.fc.features.length} joined (${pct}%), breaks ${JSON.stringify(m.metricBreaks.poverty)}, overall ${m.overall.pctPoverty}% (median ${m.overall.pctPovertyMedian}%)`)
}

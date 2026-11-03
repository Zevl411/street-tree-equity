#!/usr/bin/env node
/**
 * #106: join USDA ERS Food Access Research Atlas — 2025 SNAP-authorized Retailer Access Map (SRAM) — into packs.
 *   node scripts/add-usda-fara.mjs public/data[/<city-id>] ...
 * Source (download + unzip into gitignored data-raw/usda-fara/; NEVER commit):
 *   https://www.ers.usda.gov/data-products/food-access-research-atlas/download-the-data
 *   "2025 SNAP-authorized Retailer Access Map (SRAM) Data" ZIP (Last Updated 7/27/2026)
 *   → https://www.ers.usda.gov/media/29395/2025-snap-authorized-retailer-access-map-sram-data.zip
 * Files used (2020 census tracts; NOT 2019 LRAM):
 *   "SRAM Straight Line Distance Data.csv"        (Euclidean only; driving/network file ignored)
 *   "SRAM General Tract Characteristics Data.csv" (low-income flag)
 * Exact headers mapped (shares in source are 0–100 → /100 once here):
 *   join                  ← CensusTract20 (padStart 11)
 *   foodAccessLowShare    ← SD_SRAM_lapophalfshare   (choropleth; ½-mile population share)
 *   foodAccessLowShare1mi ← SD_SRAM_lapop1share
 *   foodAccessLila        ← SD_SRAM_LILATracts_halfAnd10 (0|1)
 *   foodAccessLowIncome   ← LowIncomeTracts (0|1)
 * Blank cells → prop absent (null ≠ 0). Writes meta.metricBreaks.foodAccess, meta.overall.foodAccessLowShare (mean), meta.fara.
 */
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { densityBreaks } from './lib/geo-utils.mjs'

const DIR = process.env.FARA_DIR || 'data-raw/usda-fara'
const SD = path.join(DIR, 'SRAM Straight Line Distance Data.csv')
const GEN = path.join(DIR, 'SRAM General Tract Characteristics Data.csv')
const SOURCE_URL = 'https://www.ers.usda.gov/data-products/food-access-research-atlas/download-the-data'
const COLUMNS = {
  join: 'CensusTract20',
  foodAccessLowShare: 'SD_SRAM_lapophalfshare',
  foodAccessLowShare1mi: 'SD_SRAM_lapop1share',
  foodAccessLila: 'SD_SRAM_LILATracts_halfAnd10',
  foodAccessLowIncome: 'LowIncomeTracts',
}
const dirs = process.argv.slice(2)
if (!dirs.length) throw new Error('usage: add-usda-fara.mjs <packDir> [...]')
for (const f of [SD, GEN]) if (!fs.existsSync(f)) throw new Error(`missing ${f} — download + unzip the 2025 SRAM ZIP into ${DIR}/`)

function splitCsv(line) {
  const out = []; let cur = ''; let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += c }
    else if (c === '"') q = true
    else if (c === ',') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur); return out
}
async function readRows(file, want, cols) {
  const rows = new Map(); let hdr = null
  for await (const line of readline.createInterface({ input: fs.createReadStream(file) })) {
    if (!hdr) {
      hdr = Object.fromEntries(splitCsv(line.replace(/^\uFEFF/, '')).map((h, i) => [h.trim(), i]))
      for (const c of [COLUMNS.join, ...cols]) if (!(c in hdr)) throw new Error(`STOP: column ${c} missing in ${file}`)
      continue
    }
    const c = splitCsv(line)
    const id = String(c[hdr[COLUMNS.join]] ?? '').trim().padStart(11, '0')
    if (want.has(id)) rows.set(id, Object.fromEntries(cols.map((k) => [k, c[hdr[k]]])))
  }
  return rows
}
const num = (s) => { if (s == null || String(s).trim() === '') return null; const v = Number(s); return Number.isFinite(v) ? v : null }

const packs = dirs.map((dir) => ({
  dir,
  meta: JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')),
  fc: JSON.parse(fs.readFileSync(path.join(dir, 'tracts-equity.geojson'), 'utf8')),
}))
const want = new Set(packs.flatMap((p) => p.fc.features.map((f) => String(f.properties.geoid).padStart(11, '0'))))
const sd = await readRows(SD, want, [COLUMNS.foodAccessLowShare, COLUMNS.foodAccessLowShare1mi, COLUMNS.foodAccessLila])
const gen = await readRows(GEN, want, [COLUMNS.foodAccessLowIncome])
const retrievedAt = process.env.FARA_RETRIEVED || fs.statSync(fs.existsSync(path.join(DIR, 'sram2025.zip')) ? path.join(DIR, 'sram2025.zip') : SD).mtime.toISOString().slice(0, 10)
const KEYS = ['foodAccessLowShare', 'foodAccessLowShare1mi', 'foodAccessLila', 'foodAccessLowIncome']
for (const p of packs) {
  const shares = []
  for (const f of p.fc.features) {
    const id = String(f.properties.geoid).padStart(11, '0')
    for (const k of KEYS) delete f.properties[k]
    const r = sd.get(id); const g = gen.get(id)
    const half = num(r?.[COLUMNS.foodAccessLowShare]); const one = num(r?.[COLUMNS.foodAccessLowShare1mi])
    const lila = num(r?.[COLUMNS.foodAccessLila]); const li = num(g?.[COLUMNS.foodAccessLowIncome])
    if (half != null) { f.properties.foodAccessLowShare = +(half / 100).toFixed(4); shares.push(f.properties.foodAccessLowShare) }
    if (one != null) f.properties.foodAccessLowShare1mi = +(one / 100).toFixed(4)
    if (lila != null) f.properties.foodAccessLila = lila ? 1 : 0
    if (li != null) f.properties.foodAccessLowIncome = li ? 1 : 0
  }
  const m = p.meta
  m.metricBreaks = { ...(m.metricBreaks ?? {}), foodAccess: densityBreaks(shares, 5) }
  m.overall.foodAccessLowShare = shares.length ? +(shares.reduce((a, b) => a + b, 0) / shares.length).toFixed(4) : null
  m.fara = { version: 'SRAM 2025', updated: '2026-07-27', retrievedAt, sourceUrl: SOURCE_URL, columns: COLUMNS }
  m.attribution = { ...m.attribution, usda: 'USDA ERS Food Access Research Atlas SRAM 2025 (not endorsed by USDA or ERS)' }
  fs.writeFileSync(path.join(p.dir, 'tracts-equity.geojson'), JSON.stringify(p.fc))
  fs.writeFileSync(path.join(p.dir, 'meta.json'), JSON.stringify(m))
  console.log(`[fara] ${p.dir}: ${shares.length}/${p.fc.features.length} joined, breaks ${JSON.stringify(m.metricBreaks.foodAccess)}, mean ${m.overall.foodAccessLowShare}`)
}

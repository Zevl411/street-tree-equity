#!/usr/bin/env node
/**
 * #100: join FEMA National Risk Index (tract) into existing packs.
 *   node scripts/add-fema-nri.mjs public/data[/<city-id>] ...
 * Source (download + unzip into gitignored data-raw/nri/; NEVER commit):
 *   https://www.fema.gov/about/reports-and-data/openfema/nri/v120/NRI_Table_CensusTracts.zip
 *   dataset page: https://www.fema.gov/about/openfema/data-sets/national-risk-index-data
 * Join NRI TRACTFIPS ↔ tract geoid. Writes nriRiskScore (RISK_SCORE), nriRiskRating (RISK_RATNG),
 * nriSoviScore (SOVI_SCORE), nriEalScore (EAL_SCORE); meta.metricBreaks.risk, meta.overall.nriRiskScore (mean),
 * meta.nri { version, retrievedAt, sourceUrl }. Trees/parks/groceries untouched.
 * Run after build-city-pack / build-data.
 */
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { densityBreaks } from './lib/geo-utils.mjs'

const CSV = process.env.NRI_CSV || 'data-raw/nri/NRI_Table_CensusTracts.csv'
const SOURCE_URL = 'https://www.fema.gov/about/openfema/data-sets/national-risk-index-data'
const dirs = process.argv.slice(2)
if (!dirs.length) throw new Error('usage: add-fema-nri.mjs <packDir> [...]')
if (!fs.existsSync(CSV)) throw new Error(`missing ${CSV} — download + unzip NRI_Table_CensusTracts.zip into data-raw/nri/`)

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

const packs = dirs.map((dir) => ({
  dir,
  meta: JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')),
  fc: JSON.parse(fs.readFileSync(path.join(dir, 'tracts-equity.geojson'), 'utf8')),
}))
const want = new Set(packs.flatMap((p) => p.fc.features.map((f) => String(f.properties.geoid).padStart(11, '0'))))
const rows = new Map()
let hdr = null; let version = null
const rl = readline.createInterface({ input: fs.createReadStream(CSV) })
for await (const line of rl) {
  if (!hdr) { hdr = Object.fromEntries(splitCsv(line.replace(/^\uFEFF/, '')).map((h, i) => [h, i])); continue }
  const c = splitCsv(line)
  const id = String(c[hdr.TRACTFIPS] ?? '').padStart(11, '0')
  if (!want.has(id)) continue
  version ??= c[hdr.NRI_VER]
  const num = (k) => { const v = parseFloat(c[hdr[k]]); return Number.isFinite(v) ? +v.toFixed(2) : null }
  rows.set(id, { nriRiskScore: num('RISK_SCORE'), nriRiskRating: c[hdr.RISK_RATNG] || null, nriSoviScore: num('SOVI_SCORE'), nriEalScore: num('EAL_SCORE') })
}
// retrieved = download time of the zip (falls back to csv mtime); version from the data dictionary.
const zip = path.join(path.dirname(CSV), 'NRI_Table_CensusTracts.zip')
const retrievedAt = process.env.NRI_RETRIEVED || fs.statSync(fs.existsSync(zip) ? zip : CSV).mtime.toISOString().slice(0, 10)
const dict = path.join(path.dirname(CSV), 'NRIDataDictionary.csv')
const dictVer = fs.existsSync(dict) ? fs.readFileSync(dict, 'utf8').split('\n')[1]?.split(',').slice(-2) : null
for (const p of packs) {
  const scores = []
  for (const f of p.fc.features) {
    const r = rows.get(String(f.properties.geoid).padStart(11, '0'))
    for (const k of ['nriRiskScore', 'nriRiskRating', 'nriSoviScore', 'nriEalScore']) delete f.properties[k]
    if (!r) continue
    for (const [k, v] of Object.entries(r)) if (v != null) f.properties[k] = v
    if (r.nriRiskScore != null) scores.push(r.nriRiskScore)
  }
  const m = p.meta
  m.metricBreaks = { ...(m.metricBreaks ?? {}), risk: densityBreaks(scores, 5) }
  m.overall.nriRiskScore = scores.length ? +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : null
  m.nri = { version: dictVer ? `v${dictVer[0]} (${dictVer[1].trim()})` : (version ?? 'v1.20'), retrievedAt, sourceUrl: SOURCE_URL }
  m.attribution = { ...m.attribution, fema: 'FEMA National Risk Index (not endorsed by FEMA)' }
  fs.writeFileSync(path.join(p.dir, 'tracts-equity.geojson'), JSON.stringify(p.fc))
  fs.writeFileSync(path.join(p.dir, 'meta.json'), JSON.stringify(m))
  console.log(`[nri] ${p.dir}: ${scores.length}/${p.fc.features.length} joined, breaks ${JSON.stringify(m.metricBreaks.risk)}, mean ${m.overall.nriRiskScore}`)
}

#!/usr/bin/env node
/**
 * #110: backfill OSM mapped sidewalks (lines) overlay into existing packs.
 *   node scripts/add-sidewalks-overlay.mjs <packDir>... [--refresh]
 * Writes sidewalks.geojson, tract sidewalkKm/sidewalkKmPerKm2, meta.counts.sidewalkKm. No metric / breaks changes.
 * Tag + length rules: scripts/lib/sidewalks.mjs.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import * as turf from '@turf/turf'
import { setRawOptions } from './lib/sources.mjs'
import { fetchSidewalks, applySidewalks } from './lib/sidewalks.mjs'

const dirs = process.argv.slice(2).filter((a) => !a.startsWith('--'))
if (!dirs.length) throw new Error('usage: add-sidewalks-overlay.mjs <packDir>...')
const config = JSON.parse(await fs.readFile('city.config.json', 'utf8'))
for (const dir of dirs) {
  const rawDir = path.join('data-raw', path.basename(dir))
  await fs.mkdir(rawDir, { recursive: true })
  setRawOptions({ rawDir, refresh: process.argv.includes('--refresh'), endpoints: config.overpassEndpoints })
  const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'))
  const tractsFc = JSON.parse(await fs.readFile(path.join(dir, 'tracts-equity.geojson'), 'utf8'))
  const d = meta.dataBbox
  const lines = await fetchSidewalks(`${d[1]},${d[0]},${d[3]},${d[2]}`)
  const r = applySidewalks(tractsFc.features, lines)
  meta.counts = { ...meta.counts, sidewalkKm: r.sidewalkKm }
  await fs.writeFile(path.join(dir, 'sidewalks.geojson'), JSON.stringify(turf.featureCollection(lines)))
  await fs.writeFile(path.join(dir, 'tracts-equity.geojson'), JSON.stringify(tractsFc))
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta))
  console.log(`[sidewalks] ${dir}: ${lines.length} ways (${r.sidewalkKm} km)`)
}

#!/usr/bin/env node
/**
 * #134: backfill OSM amenity=bench NODES into an existing pack.
 *   node scripts/add-benches.mjs public/data/<city-id> [--refresh]
 * Writes compact benches.geojson (5-dp coords, kind + soft backrest; ways skipped) +
 * tract benchesInside, meta.counts.benches. Logs size; soft warn >1 MB; hard fail >3 MB
 * via shared size-guard (#135). No metricBreaks / MetricId. No silent thinning.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import * as turf from '@turf/turf'
import { setRawOptions } from './lib/sources.mjs'
import { fetchBenches, applyBenches } from './lib/benches.mjs'
import { checkFile } from './lib/size-guard.mjs'

const dir = process.argv[2]
if (!dir) throw new Error('usage: add-benches.mjs <packDir>')
const config = JSON.parse(await fs.readFile('city.config.json', 'utf8'))
const rawDir = path.join('data-raw', path.basename(dir))
await fs.mkdir(rawDir, { recursive: true })
setRawOptions({ rawDir, refresh: process.argv.includes('--refresh'), endpoints: config.overpassEndpoints })

const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'))
const tractsFc = JSON.parse(await fs.readFile(path.join(dir, 'tracts-equity.geojson'), 'utf8'))
const d = meta.dataBbox
const pts = await fetchBenches(`${d[1]},${d[0]},${d[3]},${d[2]}`)
const r = applyBenches(tractsFc.features, pts)
meta.counts = { ...meta.counts, benches: r.benches }

const outPath = path.join(dir, 'benches.geojson')
const text = JSON.stringify(turf.featureCollection(pts))
const bytes = Buffer.byteLength(text)
await fs.writeFile(outPath, text)
await fs.writeFile(path.join(dir, 'tracts-equity.geojson'), JSON.stringify(tractsFc))
await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta))

const mb = (bytes / 1048576).toFixed(3)
const inside = tractsFc.features.reduce((a, f) => a + (f.properties.benchesInside || 0), 0)
console.log(`[benches] ${dir}: ${r.benches} points, inside ${inside}, benches.geojson ${mb} MB (${bytes} bytes)`)
try {
  checkFile(outPath, bytes)
} catch (e) {
  process.exit(1)
}

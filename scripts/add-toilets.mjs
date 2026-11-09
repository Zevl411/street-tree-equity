#!/usr/bin/env node
/**
 * #132: backfill OSM amenity=toilets points into an existing pack.
 *   node scripts/add-toilets.mjs public/data/<city-id> [--refresh]
 * Writes toilets.geojson + tract toiletsInside/nearestToiletKm,
 * meta.counts.toilets. No metricBreaks / MetricId.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import * as turf from '@turf/turf'
import { setRawOptions } from './lib/sources.mjs'
import { fetchToilets, applyToilets } from './lib/toilets.mjs'

const dir = process.argv[2]
if (!dir) throw new Error('usage: add-toilets.mjs <packDir>')
const config = JSON.parse(await fs.readFile('city.config.json', 'utf8'))
const rawDir = path.join('data-raw', path.basename(dir))
await fs.mkdir(rawDir, { recursive: true })
setRawOptions({ rawDir, refresh: process.argv.includes('--refresh'), endpoints: config.overpassEndpoints })

const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'))
const tractsFc = JSON.parse(await fs.readFile(path.join(dir, 'tracts-equity.geojson'), 'utf8'))
const d = meta.dataBbox
const pts = await fetchToilets(`${d[1]},${d[0]},${d[3]},${d[2]}`)
const r = applyToilets(tractsFc.features, pts)
meta.counts = { ...meta.counts, toilets: r.toilets }
await fs.writeFile(path.join(dir, 'toilets.geojson'), JSON.stringify(turf.featureCollection(pts)))
await fs.writeFile(path.join(dir, 'tracts-equity.geojson'), JSON.stringify(tractsFc))
await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta))
console.log(`[toilets] ${dir}: ${r.toilets} points, inside ${tractsFc.features.reduce((a, f) => a + f.properties.toiletsInside, 0)}`)

#!/usr/bin/env node
/**
 * #126: backfill OSM amenity=drinking_water (+ man_made=drinking_fountain) points into an existing pack.
 *   node scripts/add-fountains.mjs public/data/<city-id> [--refresh]
 * Writes fountains.geojson + tract fountainsInside/nearestFountainKm,
 * meta.counts.fountains. No metricBreaks / MetricId.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import * as turf from '@turf/turf'
import { setRawOptions } from './lib/sources.mjs'
import { fetchFountains, applyFountains } from './lib/fountains.mjs'

const dir = process.argv[2]
if (!dir) throw new Error('usage: add-fountains.mjs <packDir>')
const config = JSON.parse(await fs.readFile('city.config.json', 'utf8'))
const rawDir = path.join('data-raw', path.basename(dir))
await fs.mkdir(rawDir, { recursive: true })
setRawOptions({ rawDir, refresh: process.argv.includes('--refresh'), endpoints: config.overpassEndpoints })

const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'))
const tractsFc = JSON.parse(await fs.readFile(path.join(dir, 'tracts-equity.geojson'), 'utf8'))
const d = meta.dataBbox
const pts = await fetchFountains(`${d[1]},${d[0]},${d[3]},${d[2]}`)
const r = applyFountains(tractsFc.features, pts)
meta.counts = { ...meta.counts, fountains: r.fountains }
await fs.writeFile(path.join(dir, 'fountains.geojson'), JSON.stringify(turf.featureCollection(pts)))
await fs.writeFile(path.join(dir, 'tracts-equity.geojson'), JSON.stringify(tractsFc))
await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta))
console.log(`[fountains] ${dir}: ${r.fountains} points, inside ${tractsFc.features.reduce((a, f) => a + f.properties.fountainsInside, 0)}`)

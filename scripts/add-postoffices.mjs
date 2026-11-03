#!/usr/bin/env node
/**
 * #128: backfill OSM amenity=post_office points into an existing pack.
 *   node scripts/add-postoffices.mjs public/data/<city-id> [--refresh]
 * Writes postoffices.geojson + tract postOfficesInside/nearestPostOfficeKm,
 * meta.counts.postOffices. No metricBreaks / MetricId.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import * as turf from '@turf/turf'
import { setRawOptions } from './lib/sources.mjs'
import { fetchPostOffices, applyPostOffices } from './lib/postoffices.mjs'

const dir = process.argv[2]
if (!dir) throw new Error('usage: add-postoffices.mjs <packDir>')
const config = JSON.parse(await fs.readFile('city.config.json', 'utf8'))
const rawDir = path.join('data-raw', path.basename(dir))
await fs.mkdir(rawDir, { recursive: true })
setRawOptions({ rawDir, refresh: process.argv.includes('--refresh'), endpoints: config.overpassEndpoints })

const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'))
const tractsFc = JSON.parse(await fs.readFile(path.join(dir, 'tracts-equity.geojson'), 'utf8'))
const d = meta.dataBbox
const pts = await fetchPostOffices(`${d[1]},${d[0]},${d[3]},${d[2]}`)
const r = applyPostOffices(tractsFc.features, pts)
meta.counts = { ...meta.counts, postOffices: r.postOffices }
await fs.writeFile(path.join(dir, 'postoffices.geojson'), JSON.stringify(turf.featureCollection(pts)))
await fs.writeFile(path.join(dir, 'tracts-equity.geojson'), JSON.stringify(tractsFc))
await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta))
console.log(`[postoffices] ${dir}: ${r.postOffices} points, inside ${tractsFc.features.reduce((a, f) => a + f.properties.postOfficesInside, 0)}`)

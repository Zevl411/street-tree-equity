#!/usr/bin/env node
/**
 * #130: backfill OSM leisure=playground points into an existing pack.
 *   node scripts/add-playgrounds.mjs public/data/<city-id> [--refresh]
 * Writes playgrounds.geojson + tract playgroundsInside/nearestPlaygroundKm,
 * meta.counts.playgrounds. No metricBreaks / MetricId.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import * as turf from '@turf/turf'
import { setRawOptions } from './lib/sources.mjs'
import { fetchPlaygrounds, applyPlaygrounds } from './lib/playgrounds.mjs'

const dir = process.argv[2]
if (!dir) throw new Error('usage: add-playgrounds.mjs <packDir>')
const config = JSON.parse(await fs.readFile('city.config.json', 'utf8'))
const rawDir = path.join('data-raw', path.basename(dir))
await fs.mkdir(rawDir, { recursive: true })
setRawOptions({ rawDir, refresh: process.argv.includes('--refresh'), endpoints: config.overpassEndpoints })

const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'))
const tractsFc = JSON.parse(await fs.readFile(path.join(dir, 'tracts-equity.geojson'), 'utf8'))
const d = meta.dataBbox
const pts = await fetchPlaygrounds(`${d[1]},${d[0]},${d[3]},${d[2]}`)
const r = applyPlaygrounds(tractsFc.features, pts)
meta.counts = { ...meta.counts, playgrounds: r.playgrounds }
await fs.writeFile(path.join(dir, 'playgrounds.geojson'), JSON.stringify(turf.featureCollection(pts)))
await fs.writeFile(path.join(dir, 'tracts-equity.geojson'), JSON.stringify(tractsFc))
await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta))
console.log(`[playgrounds] ${dir}: ${r.playgrounds} points, inside ${tractsFc.features.reduce((a, f) => a + f.properties.playgroundsInside, 0)}`)

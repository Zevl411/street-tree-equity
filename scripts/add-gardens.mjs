#!/usr/bin/env node
/**
 * #122: backfill OSM leisure=garden|allotments (+ landuse=allotments) points into an existing pack.
 *   node scripts/add-gardens.mjs public/data/<city-id> [--refresh]
 * Writes gardens.geojson + tract gardensInside/allotmentsInside/greenGrowInside/nearestGardenKm,
 * meta.counts.gardens/allotments. No metricBreaks / MetricId.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import * as turf from '@turf/turf'
import { setRawOptions } from './lib/sources.mjs'
import { fetchGardens, applyGardens } from './lib/gardens.mjs'

const dir = process.argv[2]
if (!dir) throw new Error('usage: add-gardens.mjs <packDir>')
const config = JSON.parse(await fs.readFile('city.config.json', 'utf8'))
const rawDir = path.join('data-raw', path.basename(dir))
await fs.mkdir(rawDir, { recursive: true })
setRawOptions({ rawDir, refresh: process.argv.includes('--refresh'), endpoints: config.overpassEndpoints })

const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'))
const tractsFc = JSON.parse(await fs.readFile(path.join(dir, 'tracts-equity.geojson'), 'utf8'))
const d = meta.dataBbox
const pts = await fetchGardens(`${d[1]},${d[0]},${d[3]},${d[2]}`)
const r = applyGardens(tractsFc.features, pts)
meta.counts = { ...meta.counts, gardens: r.gardens, allotments: r.allotments }
await fs.writeFile(path.join(dir, 'gardens.geojson'), JSON.stringify(turf.featureCollection(pts)))
await fs.writeFile(path.join(dir, 'tracts-equity.geojson'), JSON.stringify(tractsFc))
await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta))
console.log(`[gardens] ${dir}: ${r.gardens} gardens, ${r.allotments} allotments, inside ${tractsFc.features.reduce((a, f) => a + f.properties.greenGrowInside, 0)}`)

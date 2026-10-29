#!/usr/bin/env node
/**
 * #99: backfill the groceries metric (OSM shop=supermarket|greengrocer) into an existing pack.
 *   node scripts/add-groceries-metric.mjs public/data/<city-id> [--refresh]
 * Writes groceries.geojson (Points) + tract groceriesInside/PerAcre/PerKm2/nearestGroceryKm,
 * meta.metricBreaks.groceries, meta.overall.groceriesPerAcre, meta.counts.groceries. Trees/parks untouched.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import * as turf from '@turf/turf'
import { setRawOptions } from './lib/sources.mjs'
import { fetchGroceries, applyGroceries } from './lib/groceries.mjs'

const dir = process.argv[2]
if (!dir) throw new Error('usage: add-groceries-metric.mjs <packDir>')
const config = JSON.parse(await fs.readFile('city.config.json', 'utf8'))
const rawDir = path.join('data-raw', path.basename(dir))
await fs.mkdir(rawDir, { recursive: true })
setRawOptions({ rawDir, refresh: process.argv.includes('--refresh'), endpoints: config.overpassEndpoints })

const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'))
const tractsFc = JSON.parse(await fs.readFile(path.join(dir, 'tracts-equity.geojson'), 'utf8'))
const d = meta.dataBbox
const groceries = await fetchGroceries(`${d[1]},${d[0]},${d[3]},${d[2]}`)
const r = applyGroceries(tractsFc.features, groceries)
meta.counts.groceries = r.count
meta.overall.groceriesPerAcre = r.overall
meta.metricBreaks = { ...(meta.metricBreaks ?? {}), groceries: r.breaks }
await fs.writeFile(path.join(dir, 'groceries.geojson'), JSON.stringify(turf.featureCollection(groceries)))
await fs.writeFile(path.join(dir, 'tracts-equity.geojson'), JSON.stringify(tractsFc))
await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta))
console.log(`[groceries] ${dir}: ${groceries.length} supermarket|greengrocer, breaks ${JSON.stringify(r.breaks)}`)

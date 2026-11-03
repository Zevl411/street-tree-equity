#!/usr/bin/env node
/**
 * #104: backfill bike lanes (lines) + transit stops (points) overlays from OSM into an existing pack.
 *   node scripts/add-mobility-overlays.mjs public/data/<city-id> [--refresh]
 * Writes bike.geojson + transit.geojson, tract bikeKm/bikeKmPerKm2/transitStopsInside/nearestTransitKm,
 * meta.counts.bikeKm/transitStops. No metric / breaks changes. Tag rules: scripts/lib/mobility.mjs.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import * as turf from '@turf/turf'
import { setRawOptions } from './lib/sources.mjs'
import { fetchBike, fetchTransit, applyMobility } from './lib/mobility.mjs'

const dir = process.argv[2]
if (!dir) throw new Error('usage: add-mobility-overlays.mjs <packDir>')
const config = JSON.parse(await fs.readFile('city.config.json', 'utf8'))
const rawDir = path.join('data-raw', path.basename(dir))
await fs.mkdir(rawDir, { recursive: true })
setRawOptions({ rawDir, refresh: process.argv.includes('--refresh'), endpoints: config.overpassEndpoints })

const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'))
const tractsFc = JSON.parse(await fs.readFile(path.join(dir, 'tracts-equity.geojson'), 'utf8'))
const d = meta.dataBbox
const ob = `${d[1]},${d[0]},${d[3]},${d[2]}`
const bike = await fetchBike(ob)
const transit = await fetchTransit(ob)
const r = applyMobility(tractsFc.features, bike, transit)
meta.counts = { ...meta.counts, bikeKm: r.bikeKm, transitStops: r.transitStops }
await fs.writeFile(path.join(dir, 'bike.geojson'), JSON.stringify(turf.featureCollection(bike)))
await fs.writeFile(path.join(dir, 'transit.geojson'), JSON.stringify(turf.featureCollection(transit)))
await fs.writeFile(path.join(dir, 'tracts-equity.geojson'), JSON.stringify(tractsFc))
await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta))
console.log(`[mobility] ${dir}: ${bike.length} bike ways (${r.bikeKm} km), ${transit.length} transit stops`)

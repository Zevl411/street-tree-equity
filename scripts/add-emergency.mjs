#!/usr/bin/env node
/**
 * #116: backfill OSM amenity=hospital|fire_station points into an existing pack.
 *   node scripts/add-emergency.mjs public/data/<city-id> [--refresh]
 * Writes emergency.geojson + tract hospitalsInside/fireStationsInside/emergencyInside/nearestHospitalKm,
 * meta.counts.hospitals/fireStations. No metricBreaks / MetricId.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import * as turf from '@turf/turf'
import { setRawOptions } from './lib/sources.mjs'
import { fetchEmergency, applyEmergency } from './lib/emergency.mjs'

const dir = process.argv[2]
if (!dir) throw new Error('usage: add-emergency.mjs <packDir>')
const config = JSON.parse(await fs.readFile('city.config.json', 'utf8'))
const rawDir = path.join('data-raw', path.basename(dir))
await fs.mkdir(rawDir, { recursive: true })
setRawOptions({ rawDir, refresh: process.argv.includes('--refresh'), endpoints: config.overpassEndpoints })

const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'))
const tractsFc = JSON.parse(await fs.readFile(path.join(dir, 'tracts-equity.geojson'), 'utf8'))
const d = meta.dataBbox
const pts = await fetchEmergency(`${d[1]},${d[0]},${d[3]},${d[2]}`)
const r = applyEmergency(tractsFc.features, pts)
meta.counts = { ...meta.counts, hospitals: r.hospitals, fireStations: r.fireStations }
await fs.writeFile(path.join(dir, 'emergency.geojson'), JSON.stringify(turf.featureCollection(pts)))
await fs.writeFile(path.join(dir, 'tracts-equity.geojson'), JSON.stringify(tractsFc))
await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta))
console.log(`[emergency] ${dir}: ${r.hospitals} hospitals, ${r.fireStations} fire stations, inside ${tractsFc.features.reduce((a, f) => a + f.properties.emergencyInside, 0)}`)

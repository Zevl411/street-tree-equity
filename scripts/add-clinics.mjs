#!/usr/bin/env node
/**
 * #112: backfill OSM amenity=pharmacy|clinic|doctors points into an existing pack.
 *   node scripts/add-clinics.mjs public/data/<city-id> [--refresh]
 * Writes clinics.geojson + tract pharmaciesInside/clinicsInside/healthInside/nearestPharmacyKm,
 * meta.counts.pharmacies/clinics. No metricBreaks / MetricId.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import * as turf from '@turf/turf'
import { setRawOptions } from './lib/sources.mjs'
import { fetchClinics, applyClinics } from './lib/clinics.mjs'

const dir = process.argv[2]
if (!dir) throw new Error('usage: add-clinics.mjs <packDir>')
const config = JSON.parse(await fs.readFile('city.config.json', 'utf8'))
const rawDir = path.join('data-raw', path.basename(dir))
await fs.mkdir(rawDir, { recursive: true })
setRawOptions({ rawDir, refresh: process.argv.includes('--refresh'), endpoints: config.overpassEndpoints })

const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'))
const tractsFc = JSON.parse(await fs.readFile(path.join(dir, 'tracts-equity.geojson'), 'utf8'))
const d = meta.dataBbox
const pts = await fetchClinics(`${d[1]},${d[0]},${d[3]},${d[2]}`)
const r = applyClinics(tractsFc.features, pts)
meta.counts = { ...meta.counts, pharmacies: r.pharmacies, clinics: r.clinics }
await fs.writeFile(path.join(dir, 'clinics.geojson'), JSON.stringify(turf.featureCollection(pts)))
await fs.writeFile(path.join(dir, 'tracts-equity.geojson'), JSON.stringify(tractsFc))
await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta))
console.log(`[clinics] ${dir}: ${r.pharmacies} pharmacies, ${r.clinics} clinics+doctors, inside ${tractsFc.features.reduce((a, f) => a + f.properties.healthInside, 0)}`)

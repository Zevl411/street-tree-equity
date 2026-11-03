#!/usr/bin/env node
/**
 * #102: backfill OSM amenity=school points into an existing pack.
 *   node scripts/add-schools-metric.mjs public/data/<city-id> [--refresh]
 * Writes schools.geojson (Points) + tract schoolsInside/PerAcre/PerKm2/nearestSchoolKm,
 * meta.overall.schoolsPerAcre, meta.counts.schools. No metricBreaks / MetricId. Other metrics untouched.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import * as turf from '@turf/turf'
import { setRawOptions } from './lib/sources.mjs'
import { fetchSchools, applySchools } from './lib/schools.mjs'

const dir = process.argv[2]
if (!dir) throw new Error('usage: add-schools-metric.mjs <packDir>')
const config = JSON.parse(await fs.readFile('city.config.json', 'utf8'))
const rawDir = path.join('data-raw', path.basename(dir))
await fs.mkdir(rawDir, { recursive: true })
setRawOptions({ rawDir, refresh: process.argv.includes('--refresh'), endpoints: config.overpassEndpoints })

const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'))
const tractsFc = JSON.parse(await fs.readFile(path.join(dir, 'tracts-equity.geojson'), 'utf8'))
const d = meta.dataBbox
const schools = await fetchSchools(`${d[1]},${d[0]},${d[3]},${d[2]}`)
const r = applySchools(tractsFc.features, schools)
meta.counts.schools = r.count
meta.overall.schoolsPerAcre = r.overall
await fs.writeFile(path.join(dir, 'schools.geojson'), JSON.stringify(turf.featureCollection(schools)))
await fs.writeFile(path.join(dir, 'tracts-equity.geojson'), JSON.stringify(tractsFc))
await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta))
console.log(`[schools] ${dir}: ${schools.length} amenity=school, inside ${tractsFc.features.reduce((a, f) => a + f.properties.schoolsInside, 0)}`)

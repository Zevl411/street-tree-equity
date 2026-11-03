#!/usr/bin/env node
/**
 * #108: backfill OSM amenity=library + community_centre points into an existing pack.
 *   node scripts/add-libraries.mjs public/data/<city-id> [--refresh]
 * Writes libraries.geojson + tract librariesInside/communityCentresInside/civicInside/nearestLibraryKm,
 * meta.counts.libraries/communityCentres. No metricBreaks / MetricId.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import * as turf from '@turf/turf'
import { setRawOptions } from './lib/sources.mjs'
import { fetchLibraries, applyLibraries } from './lib/libraries.mjs'

const dir = process.argv[2]
if (!dir) throw new Error('usage: add-libraries.mjs <packDir>')
const config = JSON.parse(await fs.readFile('city.config.json', 'utf8'))
const rawDir = path.join('data-raw', path.basename(dir))
await fs.mkdir(rawDir, { recursive: true })
setRawOptions({ rawDir, refresh: process.argv.includes('--refresh'), endpoints: config.overpassEndpoints })

const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'))
const tractsFc = JSON.parse(await fs.readFile(path.join(dir, 'tracts-equity.geojson'), 'utf8'))
const d = meta.dataBbox
const pts = await fetchLibraries(`${d[1]},${d[0]},${d[3]},${d[2]}`)
const r = applyLibraries(tractsFc.features, pts)
meta.counts = { ...meta.counts, libraries: r.libraries, communityCentres: r.communityCentres }
await fs.writeFile(path.join(dir, 'libraries.geojson'), JSON.stringify(turf.featureCollection(pts)))
await fs.writeFile(path.join(dir, 'tracts-equity.geojson'), JSON.stringify(tractsFc))
await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta))
console.log(`[libraries] ${dir}: ${r.libraries} libraries, ${r.communityCentres} community centres, inside ${tractsFc.features.reduce((a, f) => a + f.properties.civicInside, 0)}`)

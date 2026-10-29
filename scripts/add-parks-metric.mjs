#!/usr/bin/env node
/**
 * #98: backfill the parks metric into an existing city pack without re-fetching trees/roads.
 *   node scripts/add-parks-metric.mjs public/data/<city-id> [--refresh]
 * Fetches OSM leisure=park|playground (Overpass, cached in data-raw/<city-id>/) over meta.dataBbox,
 * rewrites parks.geojson and adds parksPerAcre / parksPerKm2 / parkAreaAcres / parksInside to tracts,
 * plus meta.metricBreaks.parks + meta.overall.parksPerAcre. Trees fields/breaks untouched.
 * New packs built via build-city-pack.mjs already include these fields.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import osmtogeojson from 'osmtogeojson'
import * as turf from '@turf/turf'
import { overpass, setRawOptions } from './lib/sources.mjs'
import { roundFeature, pointInBbox, densityBreaks } from './lib/geo-utils.mjs'

const SQM_PER_ACRE = 4046.8564224
const dir = process.argv[2]
if (!dir) throw new Error('usage: add-parks-metric.mjs <packDir>')
const config = JSON.parse(await fs.readFile('city.config.json', 'utf8'))
const rawDir = path.join('data-raw', path.basename(dir))
await fs.mkdir(rawDir, { recursive: true })
setRawOptions({ rawDir, refresh: process.argv.includes('--refresh'), endpoints: config.overpassEndpoints })

const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'))
const tractsFc = JSON.parse(await fs.readFile(path.join(dir, 'tracts-equity.geojson'), 'utf8'))
const d = meta.dataBbox
const ob = `${d[1]},${d[0]},${d[3]},${d[2]}`
const raw = await overpass('parks-playgrounds', `[out:json][timeout:180];(way["leisure"~"^(park|playground)$"](${ob});relation["leisure"~"^(park|playground)$"](${ob}););out body;>;out skel qt;`)

const parks = []
for (const f of osmtogeojson(raw).features) {
  if (!f.geometry || !/Polygon/.test(f.geometry.type)) continue
  const tags = f.properties?.tags ?? f.properties ?? {}
  if (tags.leisure !== 'park' && tags.leisure !== 'playground') continue
  const areaM2 = turf.area(f)
  if (areaM2 < 50) continue
  const center = turf.pointOnFeature(f).geometry.coordinates
  let geometry = f.geometry
  try { geometry = turf.simplify(f, { tolerance: 0.00005 }).geometry } catch { /* keep */ }
  parks.push(roundFeature({
    type: 'Feature', id: parks.length, geometry,
    properties: {
      id: parks.length, osmId: String(f.id ?? ''),
      name: tags.name || (tags.leisure === 'playground' ? 'Unnamed playground' : 'Unnamed park'),
      leisure: tags.leisure,
      areaAcres: +(areaM2 / SQM_PER_ACRE).toFixed(2),
      lon: +center[0].toFixed(5), lat: +center[1].toFixed(5),
    },
  }))
}

let total = 0, totalAcres = 0
for (const t of tractsFc.features) {
  const b = turf.bbox(t)
  const inside = parks.filter((pk) => {
    const pt = [pk.properties.lon, pk.properties.lat]
    return pointInBbox(pt, b) && turf.booleanPointInPolygon(pt, t)
  })
  const p = t.properties
  const ids = new Set(inside.map((pk) => pk.properties.id))
  p.parksInside = inside.length
  p.parksPerAcre = +(inside.length / p.areaAcres).toFixed(5)
  p.parksPerKm2 = +(inside.length / p.areaKm2).toFixed(3)
  p.parkAreaAcres = +inside.reduce((s, pk) => s + pk.properties.areaAcres, 0).toFixed(2)
  const c = p.centroid
  p.nearestParks = parks
    .map((pk) => ({ id: pk.properties.id, name: pk.properties.name, areaAcres: pk.properties.areaAcres,
      distanceKm: +turf.distance(c, [pk.properties.lon, pk.properties.lat]).toFixed(2), inside: ids.has(pk.properties.id) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .filter((x, i) => x.inside || i < 6)
  total += inside.length; totalAcres += p.areaAcres
}
meta.counts.parks = parks.length
meta.overall.parksPerAcre = +(total / totalAcres).toFixed(5)
meta.metricBreaks = { ...(meta.metricBreaks ?? {}), parks: densityBreaks(tractsFc.features.map((f) => f.properties.parksPerAcre), 5) }
await fs.writeFile(path.join(dir, 'parks.geojson'), JSON.stringify(turf.featureCollection(parks)))
await fs.writeFile(path.join(dir, 'tracts-equity.geojson'), JSON.stringify(tractsFc))
await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta))
console.log(`[parks] ${dir}: ${parks.length} park|playground, breaks ${JSON.stringify(meta.metricBreaks.parks)}`)

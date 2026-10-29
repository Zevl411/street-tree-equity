#!/usr/bin/env node
/**
 * Street Tree Equity — data pipeline (Node only, free sources only).
 *
 *   npm run data            # build public/data/* using cached raw downloads when present
 *   npm run data:refresh    # force re-download from Overpass + Census
 *
 * Sources (no API keys, no paid services):
 *   - US Census Bureau cartographic boundary tracts (public domain)
 *       https://www2.census.gov/geo/tiger/GENZ{year}/shp/cb_{year}_{state}_tract_500k.zip
 *   - OpenStreetMap via the public Overpass API (ODbL)
 *       natural=tree nodes, leisure=park polygons, highway=* ways
 *
 * Output (static files, committed to git, served by GitHub/GitLab Pages):
 *   public/data/tracts-equity.geojson
 *   public/data/parks.geojson
 *   public/data/trees.geojson
 *   public/data/roads-lowtree.geojson   (stretch feature; optional)
 *   public/data/meta.json
 */
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
import * as shapefile from 'shapefile'
import osmtogeojson from 'osmtogeojson'
import * as turf from '@turf/turf'
import { cachedDownload, overpass, setRawOptions } from './lib/sources.mjs'
import { roundCoords, roundFeature, pointInBbox, quantileBreaks, densityBreaks } from './lib/geo-utils.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const RAW_DIR = path.join(ROOT, 'data-raw')
const OUT_DIR = path.join(ROOT, 'public', 'data')
const REFRESH = process.argv.includes('--refresh')
const SQM_PER_ACRE = 4046.8564224

const config = JSON.parse(await fs.readFile(path.join(ROOT, 'city.config.json'), 'utf8'))
await fs.mkdir(RAW_DIR, { recursive: true })
await fs.mkdir(OUT_DIR, { recursive: true })
setRawOptions({ rawDir: RAW_DIR, refresh: REFRESH, endpoints: config.overpassEndpoints })

const log = (...a) => console.log('[data]', ...a)

async function writeJson(name, obj) {
  const text = JSON.stringify(obj)
  await fs.writeFile(path.join(OUT_DIR, name), text)
  log(`wrote public/data/${name} (${(text.length / 1024).toFixed(0)} KB)`)
  return text.length
}

// ---------------------------------------------------------------------------
// 1. Census tracts (cartographic boundary file, clipped to shoreline)
// ---------------------------------------------------------------------------
const { stateFips, censusYear: year, bbox } = config
const countyFips = config.countyFips ?? []
const zipName = `cb_${year}_${stateFips}_tract_500k`
const zipBuf = await cachedDownload(
  `https://www2.census.gov/geo/tiger/GENZ${year}/shp/${zipName}.zip`,
  `${zipName}.zip`,
)
const zip = new AdmZip(zipBuf)
const shp = zip.getEntry(`${zipName}.shp`).getData()
const dbf = zip.getEntry(`${zipName}.dbf`).getData()
const allTracts = await shapefile.read(new Uint8Array(shp), new Uint8Array(dbf), { encoding: 'utf-8' })
log(`census: ${allTracts.features.length} tracts in state ${stateFips}`)

const tracts = allTracts.features.filter((f) => {
  const p = f.properties
  if (countyFips.length && !countyFips.includes(p.COUNTYFP)) return false
  if (!p.ALAND || p.ALAND <= 0) return false
  return pointInBbox(turf.centroid(f).geometry.coordinates, bbox)
})
if (!tracts.length) throw new Error('No tracts matched bbox/county filter — check city.config.json')
log(`census: ${tracts.length} tracts with centroid inside bbox`)

// Query OSM over the full extent of the selected tracts so edge tracts are counted completely.
const dataBbox = turf.bbox(turf.featureCollection(tracts)).map((n) => +n.toFixed(5))
const ob = `${dataBbox[1]},${dataBbox[0]},${dataBbox[3]},${dataBbox[2]}` // S,W,N,E
log(`OSM query bbox (S,W,N,E): ${ob}`)
for (const t of tracts) t.bbox = turf.bbox(t)

function tractFor(pt) {
  for (const t of tracts) {
    if (pointInBbox(pt, t.bbox) && turf.booleanPointInPolygon(pt, t)) return t
  }
  return null
}

// ---------------------------------------------------------------------------
// 2. Trees (OSM natural=tree nodes) -> spatial join to tracts
// ---------------------------------------------------------------------------
const treesRaw = await overpass('trees', `[out:json][timeout:180];node["natural"="tree"](${ob});out qt;`)
const osmTimestamp = treesRaw.osm3s?.timestamp_osm_base ?? null
const treeCounts = new Map()
const treeFeatures = []
const treeGrid = new Map() // ~100 m grid for fast proximity checks
const CELL = 0.001
const cellKey = (x, y) => `${Math.floor(x / CELL)}:${Math.floor(y / CELL)}`
for (const el of treesRaw.elements) {
  if (el.type !== 'node') continue
  const pt = [el.lon, el.lat]
  const t = tractFor(pt)
  if (!t) continue
  treeCounts.set(t.properties.GEOID, (treeCounts.get(t.properties.GEOID) ?? 0) + 1)
  const props = {}
  const sp = el.tags?.['species:en'] || el.tags?.species || el.tags?.genus
  if (sp) props.s = sp
  treeFeatures.push(roundFeature(turf.point(pt, props)))
  const k = cellKey(...pt)
  if (!treeGrid.has(k)) treeGrid.set(k, [])
  treeGrid.get(k).push(pt)
}
log(`trees: ${treeFeatures.length} inside selected tracts`)

// ---------------------------------------------------------------------------
// 3. Parks (OSM leisure=park ways + multipolygon relations)
// ---------------------------------------------------------------------------
const parksRaw = await overpass(
  'parks',
  `[out:json][timeout:180];(way["leisure"="park"](${ob});relation["leisure"="park"](${ob}););out body;>;out skel qt;`,
)
const parks = []
for (const f of osmtogeojson(parksRaw).features) {
  if (!f.geometry || !/Polygon/.test(f.geometry.type)) continue
  const tags = f.properties?.tags ?? f.properties ?? {}
  if (tags.leisure !== 'park') continue
  const areaM2 = turf.area(f)
  if (areaM2 < 50) continue
  const center = turf.pointOnFeature(f).geometry.coordinates
  let geometry = f.geometry
  try {
    geometry = turf.simplify(f, { tolerance: 0.00005 }).geometry
  } catch { /* keep original geometry */ }
  parks.push(
    roundFeature({
      type: 'Feature',
      id: parks.length,
      geometry,
      properties: {
        id: parks.length,
        osmId: String(f.id ?? ''),
        name: tags.name || 'Unnamed park',
        areaAcres: +(areaM2 / SQM_PER_ACRE).toFixed(2),
        lon: +center[0].toFixed(5),
        lat: +center[1].toFixed(5),
      },
    }),
  )
}
log(`parks: ${parks.length} polygons`)

// ---------------------------------------------------------------------------
// 4. Roads with no mapped tree nearby (stretch: "plant here" candidates)
// ---------------------------------------------------------------------------
const roadsCfg = config.roadsLowTree ?? { enabled: false }
const roadStats = new Map() // geoid -> { totalM, lowM }
const lowRoads = []

function hasTreeNear(line, meters) {
  const bufDeg = meters / 111320
  const [minX, minY, maxX, maxY] = turf.bbox(line)
  for (let gx = Math.floor((minX - bufDeg * 1.5) / CELL); gx <= Math.floor((maxX + bufDeg * 1.5) / CELL); gx++) {
    for (let gy = Math.floor((minY - bufDeg) / CELL); gy <= Math.floor((maxY + bufDeg) / CELL); gy++) {
      const pts = treeGrid.get(`${gx}:${gy}`)
      if (!pts) continue
      for (const p of pts) {
        if (turf.pointToLineDistance(p, line, { units: 'meters' }) <= meters) return true
      }
    }
  }
  return false
}

if (roadsCfg.enabled) {
  try {
    const hw = roadsCfg.highwayTypes.join('|')
    const roadsRaw = await overpass('roads', `[out:json][timeout:180];way["highway"~"^(${hw})$"](${ob});out tags geom qt;`)
    for (const el of roadsRaw.elements) {
      if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue
      const line = turf.lineString(el.geometry.map((g) => [g.lon, g.lat]))
      const lengthM = turf.length(line, { units: 'meters' })
      const mid = turf.along(line, lengthM / 2, { units: 'meters' }).geometry.coordinates
      const t = tractFor(mid)
      if (!t) continue
      const geoid = t.properties.GEOID
      const st = roadStats.get(geoid) ?? { totalM: 0, lowM: 0 }
      st.totalM += lengthM
      if (!hasTreeNear(line, roadsCfg.bufferMeters)) {
        st.lowM += lengthM
        if (lengthM >= roadsCfg.minLengthMeters) {
          lowRoads.push(roundFeature({
            type: 'Feature',
            geometry: turf.simplify(line, { tolerance: 0.00003 }).geometry,
            properties: { name: el.tags?.name || '', highway: el.tags?.highway || '', lengthM: Math.round(lengthM), geoid },
          }))
        }
      }
      roadStats.set(geoid, st)
    }
    log(`roads: ${lowRoads.length} low-tree segments >= ${roadsCfg.minLengthMeters} m`)
  } catch (err) {
    log(`roads step skipped (optional): ${err.message}`)
  }
}

// ---------------------------------------------------------------------------
// 5. Tract metrics + nearest parks
// ---------------------------------------------------------------------------
function parkInTract(pk, t) {
  const pt = [pk.properties.lon, pk.properties.lat]
  return pointInBbox(pt, t.bbox) && turf.booleanPointInPolygon(pt, t)
}
/** Nearest n parks plus every park inside the tract, each flagged `inside`. */
function nearestParksTo(c, t, n = 6) {
  return parks
    .map((pk) => ({
      id: pk.properties.id,
      name: pk.properties.name,
      areaAcres: pk.properties.areaAcres,
      distanceKm: +turf.distance(c, [pk.properties.lon, pk.properties.lat]).toFixed(2),
      inside: parkInTract(pk, t),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .filter((p, i) => p.inside || i < n)
}
function countParksInside(t) {
  return parks.filter((pk) => {
    const pt = [pk.properties.lon, pk.properties.lat]
    return pointInBbox(pt, t.bbox) && turf.booleanPointInPolygon(pt, t)
  }).length
}

const tractOut = tracts.map((t) => {
  const p = t.properties
  const areaAcres = p.ALAND / SQM_PER_ACRE
  const treeCount = treeCounts.get(p.GEOID) ?? 0
  const c = turf.centroid(t).geometry.coordinates
  const rs = roadStats.get(p.GEOID)
  let geometry = t.geometry
  try {
    geometry = turf.simplify(t, { tolerance: 0.0001 }).geometry
  } catch { /* keep original geometry */ }
  return roundFeature({
    type: 'Feature',
    geometry,
    properties: {
      geoid: p.GEOID,
      name: p.NAMELSAD || `Census Tract ${p.NAME}`,
      county: p.NAMELSADCO || p.COUNTYFP,
      treeCount,
      areaAcres: +areaAcres.toFixed(1),
      areaKm2: +(p.ALAND / 1e6).toFixed(3),
      treesPerAcre: +(treeCount / areaAcres).toFixed(3),
      treesPerKm2: +(treeCount / (p.ALAND / 1e6)).toFixed(1),
      parksInside: countParksInside(t),
      nearestParks: nearestParksTo(c, t),
      roadKm: rs ? +(rs.totalM / 1000).toFixed(2) : null,
      lowTreeRoadKm: rs ? +(rs.lowM / 1000).toFixed(2) : null,
      lowTreeRoadPct: rs && rs.totalM > 0 ? Math.round((rs.lowM / rs.totalM) * 100) : null,
      centroid: roundCoords(c),
    },
  })
})

// rank / percentile (rank 1 = most trees per acre)
const sorted = [...tractOut].sort((a, b) => b.properties.treesPerAcre - a.properties.treesPerAcre)
sorted.forEach((f, i) => {
  f.properties.rank = i + 1
  f.properties.percentile = Math.round((1 - i / Math.max(1, sorted.length - 1)) * 100)
})
const densities = tractOut.map((f) => f.properties.treesPerAcre)
const breaks = densityBreaks(densities, 5)
const q1 = quantileBreaks(densities, 4)[0] ?? 0
for (const f of tractOut) f.properties.bottomQuartile = f.properties.treesPerAcre <= q1

// ---------------------------------------------------------------------------
// 6. Write outputs
// ---------------------------------------------------------------------------
const sizes = {}
sizes.tracts = await writeJson('tracts-equity.geojson', turf.featureCollection(tractOut))
sizes.parks = await writeJson('parks.geojson', turf.featureCollection(parks))
sizes.trees = await writeJson('trees.geojson', turf.featureCollection(treeFeatures))
sizes.roads = await writeJson('roads-lowtree.geojson', turf.featureCollection(lowRoads))
const totalTrees = treeFeatures.length
const totalAcres = tractOut.reduce((s, f) => s + f.properties.areaAcres, 0)

const meta = {
  cityName: config.cityName,
  subtitle: config.subtitle ?? '',
  bbox,
  dataBbox,
  generatedAt: new Date().toISOString(),
  osmTimestamp,
  censusVintage: `${year} cartographic boundary (cb_${year}_${stateFips}_tract_500k)`,
  counts: { tracts: tractOut.length, trees: totalTrees, parks: parks.length, lowTreeRoadSegments: lowRoads.length },
  overall: { treesPerAcre: +(totalTrees / totalAcres).toFixed(3), bottomQuartileMax: q1 },
  breaks,
  colors: ['#f7fcb9', '#d9f0a3', '#addd8e', '#78c679', '#31a354', '#006837'].slice(-(breaks.length + 1)),
  roadsBufferMeters: roadsCfg.enabled ? roadsCfg.bufferMeters : null,
  sizesBytes: sizes,
  attribution: {
    osm: '© OpenStreetMap contributors (ODbL)',
    census: 'U.S. Census Bureau cartographic boundary files (public domain)',
  },
}
await writeJson('meta.json', meta)
log(`done: ${tractOut.length} tracts, ${totalTrees} trees, ${parks.length} parks; overall ${meta.overall.treesPerAcre} trees/acre`)

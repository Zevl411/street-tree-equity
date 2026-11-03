// #126: OSM amenity=drinking_water (+ soft man_made=drinking_fountain) points → tract counts (overlay; not a MetricId).
// Decorative amenity=fountain is NOT included. Free OSM via Overpass (build time only).
import osmtogeojson from 'osmtogeojson'
import * as turf from '@turf/turf'
import { overpass } from './sources.mjs'
import { roundFeature, pointInBbox } from './geo-utils.mjs'

function kindOf(tags) {
  if (tags.amenity === 'drinking_water') return 'drinking_water'
  if (tags.man_made === 'drinking_fountain') return 'fountain'
  return null
}
function excluded(tags) {
  if (tags.drinking_water === 'no' || tags.access === 'private') return true
  return Object.keys(tags).some((k) => k === 'disused' || k.startsWith('disused:'))
}

/** `ob` = "S,W,N,E". Ways → pointOnFeature / centroid. Dedupe per #126 sheet. */
export async function fetchFountains(ob) {
  const sel = (k, v) => `node["${k}"="${v}"](${ob});way["${k}"="${v}"](${ob});`
  const q = `[out:json][timeout:180];(${sel('amenity', 'drinking_water')}${sel('man_made', 'drinking_fountain')});out body;>;out skel qt;`
  const raw = await overpass('fountains', q)
  const seen = new Set()
  const pts = []
  for (const f of osmtogeojson(raw).features) {
    if (!f.geometry) continue
    const id = String(f.id ?? '')
    if (seen.has(id)) continue // feature with both tags emitted once (kindOf prefers drinking_water)
    const tags = f.properties?.tags ?? f.properties ?? {}
    const kind = kindOf(tags)
    if (!kind || excluded(tags)) continue
    seen.add(id)
    const pt = f.geometry.type === 'Point' ? f.geometry.coordinates : turf.pointOnFeature(f).geometry.coordinates
    pts.push({ id, tags, kind, pt })
  }
  // Soft: drop same-kind points < 5 m apart.
  const kept = []
  for (const p of pts) if (!kept.some((k) => k.kind === p.kind && turf.distance(k.pt, p.pt) * 1000 < 5)) kept.push(p)
  return kept.map((k, i) => {
    const seasonal = k.tags.seasonal && k.tags.seasonal !== 'no'
    return roundFeature({
      type: 'Feature', id: i, geometry: { type: 'Point', coordinates: k.pt },
      properties: { id: i, osmId: k.id, kind: k.kind, ...(k.tags.name ? { name: k.tags.name } : {}), ...(k.tags.bottle === 'yes' ? { bottle: true } : {}), ...(seasonal ? { seasonal: true } : {}) },
    })
  })
}

/** Mutates tract features (needs centroid); returns meta count. No metricBreaks (#126 lock). */
export function applyFountains(tractFeatures, points) {
  for (const t of tractFeatures) {
    const b = turf.bbox(t)
    const p = t.properties
    p.fountainsInside = points.filter((s) => pointInBbox(s.geometry.coordinates, b) && turf.booleanPointInPolygon(s.geometry.coordinates, t)).length
    let best = Infinity
    for (const s of points) best = Math.min(best, turf.distance(p.centroid, s.geometry.coordinates))
    if (Number.isFinite(best)) p.nearestFountainKm = +best.toFixed(2)
    else delete p.nearestFountainKm
  }
  return { fountains: points.length }
}

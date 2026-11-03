// #128: OSM amenity=post_office points → tract counts (overlay; not a MetricId).
// post_box / post_depot NOT included. Free OSM via Overpass (build time only).
import osmtogeojson from 'osmtogeojson'
import * as turf from '@turf/turf'
import { overpass } from './sources.mjs'
import { roundFeature, pointInBbox } from './geo-utils.mjs'

function excluded(tags) {
  if (tags.access === 'private') return true
  return Object.keys(tags).some((k) => k === 'disused' || k.startsWith('disused:'))
}

/** `ob` = "S,W,N,E". Ways → pointOnFeature. Node + building way for same office emitted once (<5 m / same name within 60 m). */
export async function fetchPostOffices(ob) {
  const q = `[out:json][timeout:180];(node["amenity"="post_office"](${ob});way["amenity"="post_office"](${ob}););out body;>;out skel qt;`
  const raw = await overpass('postoffices', q)
  const seen = new Set()
  const pts = []
  for (const f of osmtogeojson(raw).features) {
    if (!f.geometry) continue
    const id = String(f.id ?? '')
    if (seen.has(id)) continue
    const tags = f.properties?.tags ?? f.properties ?? {}
    if (tags.amenity !== 'post_office' || excluded(tags)) continue
    seen.add(id)
    const pt = f.geometry.type === 'Point' ? f.geometry.coordinates : turf.pointOnFeature(f).geometry.coordinates
    pts.push({ id, tags, pt, isNode: id.startsWith('node') })
  }
  // Prefer nodes, then drop duplicates: <5 m apart, or node inside/near a same-named building way.
  pts.sort((a, b) => Number(b.isNode) - Number(a.isNode))
  const kept = []
  for (const p of pts) {
    const dup = kept.some((k) => {
      const m = turf.distance(k.pt, p.pt) * 1000
      return m < 5 || (m < 60 && k.isNode !== p.isNode && (!k.tags.name || !p.tags.name || k.tags.name === p.tags.name))
    })
    if (!dup) kept.push(p)
  }
  return kept.map((k, i) => roundFeature({
    type: 'Feature', id: i, geometry: { type: 'Point', coordinates: k.pt },
    properties: { id: i, osmId: k.id, kind: 'post_office', ...(k.tags.name ? { name: k.tags.name } : {}), ...(k.tags.operator ? { operator: k.tags.operator } : {}) },
  }))
}

/** Mutates tract features (needs centroid); returns meta count. No metricBreaks (#128 lock). */
export function applyPostOffices(tractFeatures, points) {
  for (const t of tractFeatures) {
    const b = turf.bbox(t)
    const p = t.properties
    p.postOfficesInside = points.filter((s) => pointInBbox(s.geometry.coordinates, b) && turf.booleanPointInPolygon(s.geometry.coordinates, t)).length
    let best = Infinity
    for (const s of points) best = Math.min(best, turf.distance(p.centroid, s.geometry.coordinates))
    if (Number.isFinite(best)) p.nearestPostOfficeKm = +best.toFixed(2)
    else delete p.nearestPostOfficeKm
  }
  return { postOffices: points.length }
}

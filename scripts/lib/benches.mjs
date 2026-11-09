// #134: OSM amenity=bench NODES only → tract counts (overlay; not a MetricId).
// Ways skipped (rare) — documented here per invent lock. Free OSM via Overpass (build time only).
import osmtogeojson from 'osmtogeojson'
import * as turf from '@turf/turf'
import { overpass } from './sources.mjs'
import { roundFeature, pointInBbox } from './geo-utils.mjs'

function excluded(tags) {
  if (tags.access === 'private' || tags.access === 'no') return true
  return Object.keys(tags).some((k) => k === 'disused' || k.startsWith('disused:') || k === 'abandoned' || k.startsWith('abandoned:'))
}

/** `ob` = "S,W,N,E". Nodes only. Soft drop points <2 m apart. Coords rounded to 5 dp. */
export async function fetchBenches(ob) {
  const q = `[out:json][timeout:180];node["amenity"="bench"](${ob});out body;`
  const raw = await overpass('benches', q)
  const seen = new Set()
  const pts = []
  for (const f of osmtogeojson(raw).features) {
    if (!f.geometry || f.geometry.type !== 'Point') continue
    const id = String(f.id ?? '')
    if (seen.has(id)) continue
    const tags = f.properties?.tags ?? f.properties ?? {}
    if (tags.amenity !== 'bench' || excluded(tags)) continue
    seen.add(id)
    pts.push({ pt: f.geometry.coordinates, tags })
  }
  const kept = []
  for (const p of pts) {
    if (kept.some((k) => turf.distance(k.pt, p.pt) * 1000 < 2)) continue
    kept.push(p)
  }
  // Compact: no feature id; properties = kind (+ soft backrest only).
  return kept.map((k) => {
    const f = roundFeature({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: k.pt },
      properties: { kind: 'bench', ...(k.tags.backrest === 'yes' ? { backrest: true } : {}) },
    })
    delete f.id
    return f
  })
}

/** Mutates tract features; returns meta count. No metricBreaks / MetricId (#134 lock). */
export function applyBenches(tractFeatures, points) {
  for (const t of tractFeatures) {
    const b = turf.bbox(t)
    t.properties.benchesInside = points.filter((s) => pointInBbox(s.geometry.coordinates, b) && turf.booleanPointInPolygon(s.geometry.coordinates, t)).length
  }
  return { benches: points.length }
}

// #130: OSM leisure=playground points → tract counts (overlay; not a MetricId).
// Equipment (playground=*) nodes are not emitted separately. Free OSM via Overpass (build time only).
import osmtogeojson from 'osmtogeojson'
import * as turf from '@turf/turf'
import { overpass } from './sources.mjs'
import { roundFeature, pointInBbox } from './geo-utils.mjs'

function excluded(tags) {
  if (tags.access === 'private') return true
  return Object.keys(tags).some((k) => k === 'disused' || k.startsWith('disused:') || k === 'abandoned' || k.startsWith('abandoned:'))
}

/** `ob` = "S,W,N,E". Ways → pointOnFeature. Node inside a playground area way emitted once; soft drop <5 m. */
export async function fetchPlaygrounds(ob) {
  const q = `[out:json][timeout:180];(node["leisure"="playground"](${ob});way["leisure"="playground"](${ob}););out body;>;out skel qt;`
  const raw = await overpass('playgrounds', q)
  const seen = new Set()
  const ways = []
  const nodes = []
  for (const f of osmtogeojson(raw).features) {
    if (!f.geometry) continue
    const id = String(f.id ?? '')
    if (seen.has(id)) continue
    const tags = f.properties?.tags ?? f.properties ?? {}
    if (tags.leisure !== 'playground' || excluded(tags)) continue
    seen.add(id)
    if (f.geometry.type === 'Point') nodes.push({ id, tags, pt: f.geometry.coordinates, isNode: true })
    else {
      const area = /Polygon/.test(f.geometry.type) ? f : null
      ways.push({ id, tags, pt: turf.pointOnFeature(f).geometry.coordinates, isNode: false, area })
    }
  }
  // Ways (areas) first; drop nodes inside a playground area (same playground / equipment), then <5 m dupes.
  const kept = []
  for (const p of [...ways, ...nodes]) {
    if (p.isNode && ways.some((w) => w.area && turf.booleanPointInPolygon(p.pt, w.area))) continue
    if (kept.some((k) => turf.distance(k.pt, p.pt) * 1000 < 5)) continue
    kept.push(p)
  }
  return kept.map((k, i) => roundFeature({
    type: 'Feature', id: i, geometry: { type: 'Point', coordinates: k.pt },
    properties: { id: i, osmId: k.id, kind: 'playground', ...(k.tags.name ? { name: k.tags.name } : {}) },
  }))
}

/** Mutates tract features (needs centroid); returns meta count. No metricBreaks (#130 lock). */
export function applyPlaygrounds(tractFeatures, points) {
  for (const t of tractFeatures) {
    const b = turf.bbox(t)
    const p = t.properties
    p.playgroundsInside = points.filter((s) => pointInBbox(s.geometry.coordinates, b) && turf.booleanPointInPolygon(s.geometry.coordinates, t)).length
    let best = Infinity
    for (const s of points) best = Math.min(best, turf.distance(p.centroid, s.geometry.coordinates))
    if (Number.isFinite(best)) p.nearestPlaygroundKm = +best.toFixed(2)
    else delete p.nearestPlaygroundKm
  }
  return { playgrounds: points.length }
}

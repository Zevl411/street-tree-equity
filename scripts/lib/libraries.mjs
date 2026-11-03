// #108: OSM amenity=library + amenity=community_centre points → tract civic counts (overlay; not a MetricId). Free OSM via Overpass.
import osmtogeojson from 'osmtogeojson'
import * as turf from '@turf/turf'
import { overpass } from './sources.mjs'
import { roundFeature, pointInBbox } from './geo-utils.mjs'

const NORM = { library: 'library', community_centre: 'community_centre', community_center: 'community_centre' }

/** `ob` = "S,W,N,E". library + community_centre (+ rare US mistag community_center → normalized). Footprints → pointOnFeature. */
export async function fetchLibraries(ob) {
  const sel = (k) => `node["amenity"="${k}"](${ob});way["amenity"="${k}"](${ob});relation["amenity"="${k}"](${ob});`
  const q = `[out:json][timeout:180];(${Object.keys(NORM).map(sel).join('')});out body;>;out skel qt;`
  const raw = await overpass('libraries', q)
  const polys = []
  const nodes = []
  for (const f of osmtogeojson(raw).features) {
    if (!f.geometry) continue
    const tags = f.properties?.tags ?? f.properties ?? {}
    const amenity = NORM[tags.amenity]
    if (!amenity) continue
    if (f.geometry.type === 'Point') nodes.push({ f, tags, amenity, pt: f.geometry.coordinates })
    else if (/Polygon/.test(f.geometry.type)) polys.push({ f, tags, amenity, pt: turf.pointOnFeature(f).geometry.coordinates })
  }
  // Soft dedupe: drop a node inside a same-amenity polygon already emitted.
  const kept = [...polys, ...nodes.filter((n) => !polys.some((p) => p.amenity === n.amenity && turf.booleanPointInPolygon(n.pt, p.f)))]
  return kept.map((k, i) => roundFeature({
    type: 'Feature', id: i, geometry: { type: 'Point', coordinates: k.pt },
    properties: { id: i, osmId: String(k.f.id ?? ''), name: k.tags.name || (k.amenity === 'library' ? 'Unnamed library' : 'Unnamed community centre'), amenity: k.amenity },
  }))
}

/** Mutates tract features (needs centroid); returns meta count additions. No metricBreaks (#108 lock). */
export function applyLibraries(tractFeatures, points) {
  const libs = points.filter((p) => p.properties.amenity === 'library')
  for (const t of tractFeatures) {
    const b = turf.bbox(t)
    const inside = points.filter((s) => pointInBbox(s.geometry.coordinates, b) && turf.booleanPointInPolygon(s.geometry.coordinates, t))
    const p = t.properties
    p.librariesInside = inside.filter((s) => s.properties.amenity === 'library').length
    p.communityCentresInside = inside.length - p.librariesInside
    p.civicInside = inside.length
    let best = Infinity
    for (const s of libs) best = Math.min(best, turf.distance(p.centroid, s.geometry.coordinates))
    if (Number.isFinite(best)) p.nearestLibraryKm = +best.toFixed(2)
    else delete p.nearestLibraryKm
  }
  return { libraries: libs.length, communityCentres: points.length - libs.length }
}

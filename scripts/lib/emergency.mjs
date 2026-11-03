// #116: OSM amenity=hospital|fire_station points → tract emergency counts (overlay; not a MetricId). Free OSM via Overpass (build-time only).
import osmtogeojson from 'osmtogeojson'
import * as turf from '@turf/turf'
import { overpass } from './sources.mjs'
import { roundFeature, pointInBbox } from './geo-utils.mjs'

const AMENITY = { hospital: 'hospital', fire_station: 'fire_station' }
/** Soft: healthcare=hospital when no amenity tag → hospital. */
const HEALTHCARE = { hospital: 'hospital' }
const UNNAMED = { hospital: 'Unnamed hospital', fire_station: 'Unnamed fire station' }

function normalize(tags) {
  if (tags.amenity) return AMENITY[tags.amenity] ?? null
  return HEALTHCARE[tags.healthcare] ?? null
}

/** `ob` = "S,W,N,E". Footprints → pointOnFeature; soft dedupe node-inside-same-amenity polygon. */
export async function fetchEmergency(ob) {
  const sel = (k, v) => `node["${k}"="${v}"](${ob});way["${k}"="${v}"](${ob});relation["${k}"="${v}"](${ob});`
  const parts = [...Object.keys(AMENITY).map((v) => sel('amenity', v)), ...Object.keys(HEALTHCARE).map((v) => sel('healthcare', v))]
  const q = `[out:json][timeout:180];(${parts.join('')});out body;>;out skel qt;`
  const raw = await overpass('emergency', q)
  const polys = []
  const nodes = []
  for (const f of osmtogeojson(raw).features) {
    if (!f.geometry) continue
    const tags = f.properties?.tags ?? f.properties ?? {}
    const amenity = normalize(tags)
    if (!amenity) continue
    if (f.geometry.type === 'Point') nodes.push({ f, tags, amenity, pt: f.geometry.coordinates })
    else if (/Polygon/.test(f.geometry.type)) polys.push({ f, tags, amenity, pt: turf.pointOnFeature(f).geometry.coordinates })
  }
  const kept = [...polys, ...nodes.filter((n) => !polys.some((p) => p.amenity === n.amenity && turf.booleanPointInPolygon(n.pt, p.f)))]
  return kept.map((k, i) => roundFeature({
    type: 'Feature', id: i, geometry: { type: 'Point', coordinates: k.pt },
    properties: { id: i, osmId: String(k.f.id ?? ''), name: k.tags.name || UNNAMED[k.amenity], amenity: k.amenity },
  }))
}

/** Mutates tract features (needs centroid); returns meta count additions. No metricBreaks (#116 lock). */
export function applyEmergency(tractFeatures, points) {
  const hosp = points.filter((p) => p.properties.amenity === 'hospital')
  for (const t of tractFeatures) {
    const b = turf.bbox(t)
    const inside = points.filter((s) => pointInBbox(s.geometry.coordinates, b) && turf.booleanPointInPolygon(s.geometry.coordinates, t))
    const p = t.properties
    p.hospitalsInside = inside.filter((s) => s.properties.amenity === 'hospital').length
    p.fireStationsInside = inside.length - p.hospitalsInside
    p.emergencyInside = inside.length
    let best = Infinity
    for (const s of hosp) best = Math.min(best, turf.distance(p.centroid, s.geometry.coordinates))
    if (Number.isFinite(best)) p.nearestHospitalKm = +best.toFixed(2)
    else delete p.nearestHospitalKm
  }
  return { hospitals: hosp.length, fireStations: points.length - hosp.length }
}

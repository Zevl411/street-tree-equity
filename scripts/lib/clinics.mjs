// #112: OSM amenity=pharmacy|clinic|doctors points → tract health counts (overlay; not a MetricId). Free OSM via Overpass.
import osmtogeojson from 'osmtogeojson'
import * as turf from '@turf/turf'
import { overpass } from './sources.mjs'
import { roundFeature, pointInBbox } from './geo-utils.mjs'

const AMENITY = { pharmacy: 'pharmacy', clinic: 'clinic', doctors: 'doctors' }
/** Soft: healthcare=* when no amenity tag, normalized to amenity values. */
const HEALTHCARE = { pharmacy: 'pharmacy', clinic: 'clinic', doctor: 'doctors' }
const UNNAMED = { pharmacy: 'Unnamed pharmacy', clinic: 'Unnamed clinic', doctors: 'Unnamed doctors' }

function normalize(tags) {
  if (tags.amenity) return AMENITY[tags.amenity] ?? null
  return HEALTHCARE[tags.healthcare] ?? null
}

/** `ob` = "S,W,N,E". Footprints → pointOnFeature; soft dedupe node-inside-same-amenity polygon. */
export async function fetchClinics(ob) {
  const sel = (k, v) => `node["${k}"="${v}"](${ob});way["${k}"="${v}"](${ob});relation["${k}"="${v}"](${ob});`
  const parts = [...Object.keys(AMENITY).map((v) => sel('amenity', v)), ...Object.keys(HEALTHCARE).map((v) => sel('healthcare', v))]
  const q = `[out:json][timeout:180];(${parts.join('')});out body;>;out skel qt;`
  const raw = await overpass('clinics', q)
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

/** Mutates tract features (needs centroid); returns meta count additions. No metricBreaks (#112 lock). */
export function applyClinics(tractFeatures, points) {
  const pharm = points.filter((p) => p.properties.amenity === 'pharmacy')
  for (const t of tractFeatures) {
    const b = turf.bbox(t)
    const inside = points.filter((s) => pointInBbox(s.geometry.coordinates, b) && turf.booleanPointInPolygon(s.geometry.coordinates, t))
    const p = t.properties
    p.pharmaciesInside = inside.filter((s) => s.properties.amenity === 'pharmacy').length
    p.clinicsInside = inside.length - p.pharmaciesInside
    p.healthInside = inside.length
    let best = Infinity
    for (const s of pharm) best = Math.min(best, turf.distance(p.centroid, s.geometry.coordinates))
    if (Number.isFinite(best)) p.nearestPharmacyKm = +best.toFixed(2)
    else delete p.nearestPharmacyKm
  }
  return { pharmacies: pharm.length, clinics: points.length - pharm.length }
}

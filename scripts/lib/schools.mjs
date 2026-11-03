// #102: OSM amenity=school points → tract schools fields (overlay + Hotspots count; not a MetricId). Free OSM via Overpass.
import osmtogeojson from 'osmtogeojson'
import * as turf from '@turf/turf'
import { overpass } from './sources.mjs'
import { roundFeature, pointInBbox } from './geo-utils.mjs'

/** `ob` = "S,W,N,E". amenity=school only (no university/college/kindergarten/childcare). Nodes kept; footprints → pointOnFeature (skip < 50 m²). */
export async function fetchSchools(ob) {
  const q = `[out:json][timeout:180];(node["amenity"="school"](${ob});way["amenity"="school"](${ob});relation["amenity"="school"](${ob}););out body;>;out skel qt;`
  const raw = await overpass('schools', q)
  const out = []
  for (const f of osmtogeojson(raw).features) {
    if (!f.geometry) continue
    const tags = f.properties?.tags ?? f.properties ?? {}
    if (tags.amenity !== 'school') continue
    let pt
    if (f.geometry.type === 'Point') pt = f.geometry.coordinates
    else if (/Polygon/.test(f.geometry.type)) {
      if (turf.area(f) < 50) continue
      pt = turf.pointOnFeature(f).geometry.coordinates
    } else continue
    out.push(roundFeature({
      type: 'Feature', id: out.length, geometry: { type: 'Point', coordinates: pt },
      properties: { id: out.length, osmId: String(f.id ?? ''), name: tags.name || 'Unnamed school', amenity: 'school' },
    }))
  }
  return out
}

/** Mutates tract features (needs areaAcres, areaKm2, centroid); returns meta additions. No metricBreaks (#102 lock). */
export function applySchools(tractFeatures, schools) {
  let total = 0, totalAcres = 0
  for (const t of tractFeatures) {
    const b = turf.bbox(t)
    const n = schools.filter((s) => pointInBbox(s.geometry.coordinates, b) && turf.booleanPointInPolygon(s.geometry.coordinates, t)).length
    const p = t.properties
    p.schoolsInside = n
    p.schoolsPerAcre = +(n / p.areaAcres).toFixed(5)
    p.schoolsPerKm2 = +(n / p.areaKm2).toFixed(3)
    let best = Infinity
    for (const s of schools) best = Math.min(best, turf.distance(p.centroid, s.geometry.coordinates))
    if (Number.isFinite(best)) p.nearestSchoolKm = +best.toFixed(2)
    total += n; totalAcres += p.areaAcres
  }
  return { count: schools.length, overall: +(total / totalAcres).toFixed(5) }
}

// #99: OSM supermarket|greengrocer points → tract groceries metric (count density). Free OSM via Overpass.
import osmtogeojson from 'osmtogeojson'
import * as turf from '@turf/turf'
import { overpass } from './sources.mjs'
import { roundFeature, pointInBbox, densityBreaks } from './geo-utils.mjs'

/** `ob` = "S,W,N,E". Nodes keep their coordinate; way/relation footprints → pointOnFeature (skip < 50 m²). */
export async function fetchGroceries(ob) {
  const q = `[out:json][timeout:180];(node["shop"~"^(supermarket|greengrocer)$"](${ob});way["shop"~"^(supermarket|greengrocer)$"](${ob});relation["shop"~"^(supermarket|greengrocer)$"](${ob}););out body;>;out skel qt;`
  const raw = await overpass('groceries', q)
  const out = []
  for (const f of osmtogeojson(raw).features) {
    if (!f.geometry) continue
    const tags = f.properties?.tags ?? f.properties ?? {}
    if (tags.shop !== 'supermarket' && tags.shop !== 'greengrocer') continue
    let pt
    if (f.geometry.type === 'Point') pt = f.geometry.coordinates
    else if (/Polygon/.test(f.geometry.type)) {
      if (turf.area(f) < 50) continue
      pt = turf.pointOnFeature(f).geometry.coordinates
    } else continue
    out.push(roundFeature({
      type: 'Feature', id: out.length, geometry: { type: 'Point', coordinates: pt },
      properties: { id: out.length, osmId: String(f.id ?? ''), name: tags.name || 'Unnamed grocery', shop: tags.shop },
    }))
  }
  return out
}

/** Mutates tract features (needs areaAcres, areaKm2, centroid); returns meta additions. */
export function applyGroceries(tractFeatures, groceries) {
  let total = 0, totalAcres = 0
  for (const t of tractFeatures) {
    const b = turf.bbox(t)
    const n = groceries.filter((g) => pointInBbox(g.geometry.coordinates, b) && turf.booleanPointInPolygon(g.geometry.coordinates, t)).length
    const p = t.properties
    p.groceriesInside = n
    p.groceriesPerAcre = +(n / p.areaAcres).toFixed(5)
    p.groceriesPerKm2 = +(n / p.areaKm2).toFixed(3)
    let best = Infinity
    for (const g of groceries) best = Math.min(best, turf.distance(p.centroid, g.geometry.coordinates))
    if (Number.isFinite(best)) p.nearestGroceryKm = +best.toFixed(2)
    total += n; totalAcres += p.areaAcres
  }
  return {
    count: groceries.length,
    overall: +(total / totalAcres).toFixed(5),
    breaks: densityBreaks(tractFeatures.map((f) => f.properties.groceriesPerAcre), 5),
  }
}

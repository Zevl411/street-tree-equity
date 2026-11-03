// #104: OSM bike network lines + transit stop points (overlays only, no metric). Free OSM via Overpass.
// Bike tags (locked): way[highway=cycleway] | way[cycleway] (≠ "no") | way[bicycle=designated];
//   drop access=no / bicycle=no and ways < 15 m.
// Transit tags (locked): highway=bus_stop | public_transport=platform | railway=station|halt | amenity=bus_station;
//   platform ways → centroid; unnamed stops within 15 m of a kept stop are deduped.
import osmtogeojson from 'osmtogeojson'
import * as turf from '@turf/turf'
import { overpass } from './sources.mjs'
import { roundFeature, pointInBbox } from './geo-utils.mjs'

export async function fetchBike(ob) {
  const q = `[out:json][timeout:180];(way["highway"="cycleway"](${ob});way["cycleway"]["cycleway"!="no"](${ob});way["bicycle"="designated"](${ob}););out body;>;out skel qt;`
  const raw = await overpass('bike', q)
  const out = []
  for (const f of osmtogeojson(raw).features) {
    const g = f.geometry
    if (!g || g.type !== 'LineString') continue
    const t = f.properties?.tags ?? f.properties ?? {}
    const ok = t.highway === 'cycleway' || (t.cycleway && t.cycleway !== 'no') || t.bicycle === 'designated'
    if (!ok || t.access === 'no' || t.bicycle === 'no') continue
    const km = turf.length(f)
    if (km < 0.015) continue
    const tag = t.highway === 'cycleway' ? 'highway=cycleway' : t.cycleway && t.cycleway !== 'no' ? `cycleway=${t.cycleway}` : 'bicycle=designated'
    out.push(roundFeature({ type: 'Feature', id: out.length, geometry: g,
      properties: { id: out.length, osmId: String(f.id ?? ''), name: t.name || '', tag } }))
  }
  return out
}

export async function fetchTransit(ob) {
  const sel = ['["highway"="bus_stop"]', '["public_transport"="platform"]', '["railway"="station"]', '["railway"="halt"]', '["amenity"="bus_station"]']
  const q = `[out:json][timeout:180];(${sel.map((s) => `node${s}(${ob});`).join('')}way["public_transport"="platform"](${ob}););out body;>;out skel qt;`
  const raw = await overpass('transit', q)
  const cand = []
  for (const f of osmtogeojson(raw).features) {
    if (!f.geometry) continue
    const t = f.properties?.tags ?? f.properties ?? {}
    const kind = t.highway === 'bus_stop' ? 'bus_stop' : t.railway === 'station' || t.railway === 'halt' ? t.railway
      : t.amenity === 'bus_station' ? 'bus_station' : t.public_transport === 'platform' ? 'platform' : null
    if (!kind) continue
    const pt = f.geometry.type === 'Point' ? f.geometry.coordinates : turf.centroid(f).geometry.coordinates
    cand.push({ pt, name: t.name || '', kind, osmId: String(f.id ?? ''), node: f.geometry.type === 'Point' })
  }
  cand.sort((a, b) => (b.node - a.node) || (!!b.name - !!a.name))
  const out = []
  for (const c of cand) {
    if (!c.name && out.some((k) => Math.abs(k.geometry.coordinates[1] - c.pt[1]) < 0.0003 && turf.distance(k.geometry.coordinates, c.pt) < 0.015)) continue
    out.push(roundFeature({ type: 'Feature', id: out.length, geometry: { type: 'Point', coordinates: c.pt },
      properties: { id: out.length, osmId: c.osmId, name: c.name || 'Transit stop', kind: c.kind } }))
  }
  return out
}

/** Mutates tracts: bikeKm, bikeKmPerKm2, transitStopsInside, nearestTransitKm. */
export function applyMobility(tracts, bike, transit) {
  const bikeBb = bike.map((l) => turf.bbox(l))
  let bikeTotal = 0
  for (const t of tracts) {
    const b = turf.bbox(t), p = t.properties
    let km = 0
    bike.forEach((l, i) => {
      const lb = bikeBb[i]
      if (lb[0] > b[2] || lb[2] < b[0] || lb[1] > b[3] || lb[3] < b[1]) return
      // Clip approximation: sum segment lengths whose midpoint is inside the tract.
      const c = l.geometry.coordinates
      for (let j = 1; j < c.length; j++) {
        const mid = [(c[j - 1][0] + c[j][0]) / 2, (c[j - 1][1] + c[j][1]) / 2]
        if (pointInBbox(mid, b) && turf.booleanPointInPolygon(mid, t)) km += turf.distance(c[j - 1], c[j])
      }
    })
    p.bikeKm = +km.toFixed(2)
    p.bikeKmPerKm2 = +(km / p.areaKm2).toFixed(3)
    p.transitStopsInside = transit.filter((s) => pointInBbox(s.geometry.coordinates, b) && turf.booleanPointInPolygon(s.geometry.coordinates, t)).length
    let best = Infinity
    for (const s of transit) best = Math.min(best, turf.distance(p.centroid, s.geometry.coordinates))
    if (Number.isFinite(best)) p.nearestTransitKm = +best.toFixed(2)
    bikeTotal += km
  }
  return { bikeKm: +bike.reduce((s, l) => s + turf.length(l), 0).toFixed(1), transitStops: transit.length, tractBikeKm: bikeTotal }
}

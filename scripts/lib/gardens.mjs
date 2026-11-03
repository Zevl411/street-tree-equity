// #122: OSM leisure=garden|allotments (+ soft landuse=allotments) points → tract counts (overlay; not a MetricId). Free OSM via Overpass.
import osmtogeojson from 'osmtogeojson'
import * as turf from '@turf/turf'
import { overpass } from './sources.mjs'
import { roundFeature, pointInBbox } from './geo-utils.mjs'

function kindOf(tags) {
  if (tags.leisure === 'garden') return 'garden'
  if (tags.leisure === 'allotments') return 'allotments'
  if (tags.landuse === 'allotments') return 'allotments'
  return null
}

/** `ob` = "S,W,N,E". Footprints → pointOnFeature. Soft dedupe per #122 sheet. */
export async function fetchGardens(ob) {
  const sel = (k, v) => `node["${k}"="${v}"](${ob});way["${k}"="${v}"](${ob});relation["${k}"="${v}"](${ob});`
  const q = `[out:json][timeout:180];(${sel('leisure', 'garden')}${sel('leisure', 'allotments')}${sel('landuse', 'allotments')});out body;>;out skel qt;`
  const raw = await overpass('gardens', q)
  const polys = []
  const nodes = []
  for (const f of osmtogeojson(raw).features) {
    if (!f.geometry) continue
    const tags = f.properties?.tags ?? f.properties ?? {}
    const kind = kindOf(tags)
    if (!kind) continue
    const landuseOnly = tags.leisure !== 'allotments' && tags.landuse === 'allotments'
    if (f.geometry.type === 'Point') nodes.push({ f, tags, kind, landuseOnly, pt: f.geometry.coordinates })
    else if (/Polygon/.test(f.geometry.type)) polys.push({ f, tags, kind, landuseOnly, pt: turf.pointOnFeature(f).geometry.coordinates })
  }
  // Soft dedupe: drop landuse=allotments polygon whose point sits in a leisure=allotments polygon (or vice versa overlap).
  const leisureAllot = polys.filter((p) => p.kind === 'allotments' && !p.landuseOnly)
  const keptPolys = polys.filter((p) => !(p.landuseOnly && leisureAllot.some((l) => l !== p && turf.booleanPointInPolygon(p.pt, l.f))))
  // Drop a node inside a same-kind polygon already emitted.
  const keptNodes = nodes.filter((n) => !keptPolys.some((p) => p.kind === n.kind && turf.booleanPointInPolygon(n.pt, p.f)))
  return [...keptPolys, ...keptNodes].map((k, i) => {
    const community = k.tags['garden:type'] === 'community' || k.tags.community_garden === 'yes'
    return roundFeature({
      type: 'Feature', id: i, geometry: { type: 'Point', coordinates: k.pt },
      properties: { id: i, osmId: String(k.f.id ?? ''), name: k.tags.name || (k.kind === 'garden' ? 'Unnamed garden' : 'Unnamed allotments'), kind: k.kind, ...(community ? { community: true } : {}) },
    })
  })
}

/** Mutates tract features (needs centroid); returns meta count additions. No metricBreaks (#122 lock). */
export function applyGardens(tractFeatures, points) {
  const gardens = points.filter((p) => p.properties.kind === 'garden').length
  for (const t of tractFeatures) {
    const b = turf.bbox(t)
    const inside = points.filter((s) => pointInBbox(s.geometry.coordinates, b) && turf.booleanPointInPolygon(s.geometry.coordinates, t))
    const p = t.properties
    p.gardensInside = inside.filter((s) => s.properties.kind === 'garden').length
    p.allotmentsInside = inside.length - p.gardensInside
    p.greenGrowInside = inside.length
    let best = Infinity
    for (const s of points) best = Math.min(best, turf.distance(p.centroid, s.geometry.coordinates))
    if (Number.isFinite(best)) p.nearestGardenKm = +best.toFixed(2)
    else delete p.nearestGardenKm
  }
  return { gardens, allotments: points.length - gardens }
}

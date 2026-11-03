// #110: OSM mapped sidewalks / footpaths (line overlay only, no metric). Free OSM via Overpass (ODbL).
// Primary (locked): way[highway=footway|path|pedestrian] → src footway|path|pedestrian (isSidewalk when footway=sidewalk).
// Secondary (soft): road ways tagged sidewalk=both|left|right|yes, sidewalk:both=yes, sidewalk:left/right=yes → src road.
// Dedupe: roads tagged sidewalk=separate / sidewalk:*=separate are skipped (the separate footway already counts).
// Exclude: sidewalk=no|none, access=no|private, foot=no, footway=crossing, road-tagged motorway|trunk,
//   highway=path with bicycle=designated and no foot/segregated (bike-only, in #104). Pedestrian areas → outline line.
//   Pieces < 5 m dropped.
// Output trimmed for size: props src (+isSidewalk/side), ~2 m simplify, 5-dp coords.
// Length rule: footway/path/pedestrian lines count once; road-tagged both ×2, left/right/yes ×1.
import osmtogeojson from 'osmtogeojson'
import * as turf from '@turf/turf'
import { overpass } from './sources.mjs'
import { roundFeature, pointInBbox } from './geo-utils.mjs'

const PRIMARY = new Set(['footway', 'path', 'pedestrian'])

function roadSide(t) {
  const vals = [t.sidewalk, t['sidewalk:both'], t['sidewalk:left'], t['sidewalk:right']]
  if (vals.includes('separate')) return null
  if (t.sidewalk === 'both' || t['sidewalk:both'] === 'yes' || (t['sidewalk:left'] === 'yes' && t['sidewalk:right'] === 'yes')) return 'both'
  if (t.sidewalk === 'left' || t['sidewalk:left'] === 'yes') return 'left'
  if (t.sidewalk === 'right' || t['sidewalk:right'] === 'yes') return 'right'
  if (t.sidewalk === 'yes') return 'yes'
  return null
}

export async function fetchSidewalks(ob) {
  const q = `[out:json][timeout:180];(way["highway"="footway"](${ob});way["highway"="path"](${ob});way["highway"="pedestrian"](${ob});` +
    `way["highway"]["sidewalk"~"^(both|left|right|yes)$"](${ob});way["highway"]["sidewalk:both"~"^(yes|separate)$"](${ob});` +
    `way["highway"]["sidewalk:left"="yes"](${ob});way["highway"]["sidewalk:right"="yes"](${ob}););out body;>;out skel qt;`
  const raw = await overpass('sidewalks', q)
  const out = []
  for (const f of osmtogeojson(raw).features) {
    let g = f.geometry
    if (!g) continue
    if (g.type === 'Polygon') g = { type: 'LineString', coordinates: g.coordinates[0] }
    if (g.type !== 'LineString') continue
    const t = f.properties?.tags ?? f.properties ?? {}
    if (t.access === 'no' || t.access === 'private' || t.foot === 'no' || t.sidewalk === 'no' || t.sidewalk === 'none') continue
    if (t.footway === 'crossing') continue
    let src, side
    if (PRIMARY.has(t.highway)) {
      if (t.highway === 'path' && t.bicycle === 'designated' && !t.foot && !t.segregated) continue
      src = t.highway
    } else {
      if (t.highway === 'motorway' || t.highway === 'trunk' || t.highway === 'motorway_link' || t.highway === 'trunk_link') continue
      side = roadSide(t)
      if (!side) continue
      src = 'road'
    }
    const feat = { type: 'Feature', geometry: g, properties: {} }
    if (turf.length(feat) < 0.005) continue
    const props = { src }
    if (t.footway === 'sidewalk') props.isSidewalk = true
    if (side) props.side = side
    // Size: ~2 m simplify (length computed on simplified line) keeps packs small.
    const simp = turf.simplify({ type: 'Feature', geometry: g, properties: {} }, { tolerance: 0.00002, highQuality: false }).geometry
    out.push(roundFeature({ type: 'Feature', geometry: simp, properties: props }, 5))
  }
  return out
}

const mult = (l) => (l.properties.src === 'road' && l.properties.side === 'both' ? 2 : 1)

/** Mutates tracts: sidewalkKm, sidewalkKmPerKm2 (ALAND km²; absent when 0). */
export function applySidewalks(tracts, lines) {
  const bbs = lines.map((l) => turf.bbox(l))
  for (const t of tracts) {
    const b = turf.bbox(t), p = t.properties
    let km = 0
    lines.forEach((l, i) => {
      const lb = bbs[i]
      if (lb[0] > b[2] || lb[2] < b[0] || lb[1] > b[3] || lb[3] < b[1]) return
      const c = l.geometry.coordinates, m = mult(l)
      for (let j = 1; j < c.length; j++) {
        const mid = [(c[j - 1][0] + c[j][0]) / 2, (c[j - 1][1] + c[j][1]) / 2]
        if (pointInBbox(mid, b) && turf.booleanPointInPolygon(mid, t)) km += m * turf.distance(c[j - 1], c[j])
      }
    })
    p.sidewalkKm = +km.toFixed(2)
    if (p.areaKm2 > 0) p.sidewalkKmPerKm2 = +(km / p.areaKm2).toFixed(2)
    else delete p.sidewalkKmPerKm2
  }
  return { sidewalkKm: +lines.reduce((s, l) => s + mult(l) * turf.length(l), 0).toFixed(1) }
}

// #137: shared line slimming for overlay geojson (sidewalks, Portland bike).
// Rounds coords to `dp` decimals, drops consecutive duplicate vertices, then Douglas-Peucker at ~`toleranceM`
// metres (equirectangular at the feature's latitude). First/last vertex of every line is always kept; a line that
// collapses to <2 distinct vertices keeps its two endpoints. Never drops a feature, a property, or a feature id.
// Apply AFTER tract metrics are computed so derived tract props stay byte-identical.

const M_PER_DEG_LAT = 110540
const M_PER_DEG_LON_EQ = 111320

const round = (n, dp) => +n.toFixed(dp)

/** Perpendicular distance (m) from p to segment a-b, in a local metric frame. */
function segDistM(p, a, b, kx) {
  const ax = a[0] * kx, ay = a[1] * M_PER_DEG_LAT
  const bx = b[0] * kx, by = b[1] * M_PER_DEG_LAT
  const px = p[0] * kx, py = p[1] * M_PER_DEG_LAT
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  const qx = ax + t * dx - px, qy = ay + t * dy - py
  return Math.sqrt(qx * qx + qy * qy)
}

/** Iterative Douglas-Peucker; returns kept vertices (endpoints always kept). */
export function douglasPeucker(pts, toleranceM, kx) {
  if (pts.length <= 2) return pts.slice()
  const keep = new Uint8Array(pts.length)
  keep[0] = 1
  keep[pts.length - 1] = 1
  const stack = [[0, pts.length - 1]]
  while (stack.length) {
    const [i, j] = stack.pop()
    let maxD = -1, idx = -1
    for (let k = i + 1; k < j; k++) {
      const d = segDistM(pts[k], pts[i], pts[j], kx)
      if (d > maxD) { maxD = d; idx = k }
    }
    if (idx > 0 && maxD > toleranceM) {
      keep[idx] = 1
      stack.push([i, idx], [idx, j])
    }
  }
  return pts.filter((_, k) => keep[k])
}

/** Slim one LineString coordinate array. */
export function slimLine(coords, { dp = 5, toleranceM = 1 } = {}) {
  if (!Array.isArray(coords) || coords.length === 0) return coords
  const r = coords.map((c) => [round(c[0], dp), round(c[1], dp), ...c.slice(2)])
  const first = r[0], last = r[r.length - 1]
  const dedup = [first]
  for (let k = 1; k < r.length; k++) {
    const p = dedup[dedup.length - 1]
    if (r[k][0] !== p[0] || r[k][1] !== p[1]) dedup.push(r[k])
  }
  if (dedup.length < 2) return coords.length >= 2 ? [first, last] : [first]
  const lat = dedup.reduce((s, c) => s + c[1], 0) / dedup.length
  const kx = M_PER_DEG_LON_EQ * Math.cos((lat * Math.PI) / 180)
  const out = douglasPeucker(dedup, toleranceM, kx)
  // Endpoint guarantee (dedup keeps first; last may equal its predecessor and be merged → restore it).
  out[0] = first
  if (out[out.length - 1] !== last) out[out.length - 1] = last
  return out
}

function slimGeometry(g, opts) {
  if (!g) return g
  if (g.type === 'LineString') return { ...g, coordinates: slimLine(g.coordinates, opts) }
  if (g.type === 'MultiLineString') return { ...g, coordinates: g.coordinates.map((l) => slimLine(l, opts)) }
  return g
}

/** Returns a new FeatureCollection with slimmed line geometries (non-line features passed through). */
export function slimLines(fc, { dp = 5, toleranceM = 1 } = {}) {
  const opts = { dp, toleranceM }
  return { ...fc, features: fc.features.map((f) => ({ ...f, geometry: slimGeometry(f.geometry, opts) })) }
}

const keySig = (f) => Object.keys(f.properties ?? {}).sort().join(',') + '|' + (f.id ?? '')

/** Throws unless feature count, per-feature property keys/values and ids are unchanged. */
export function assertSlimInvariant(before, after, label = 'fc') {
  if (before.features.length !== after.features.length) {
    throw new Error(`[slim] ${label}: feature count changed ${before.features.length} → ${after.features.length}`)
  }
  for (let i = 0; i < before.features.length; i++) {
    const a = before.features[i], b = after.features[i]
    if (keySig(a) !== keySig(b) || JSON.stringify(a.properties) !== JSON.stringify(b.properties)) {
      throw new Error(`[slim] ${label}: properties/id changed at feature ${i}`)
    }
    if (b.geometry?.type === 'LineString' && b.geometry.coordinates.length < 2 && a.geometry.coordinates.length >= 2) {
      throw new Error(`[slim] ${label}: line ${i} lost endpoints`)
    }
  }
  return { features: after.features.length }
}

// ---------------------------------------------------------------------------
// #137 (amended, option 1): merge line features into one MultiLineString per identical property set.
// Sidewalks only (bike stays per-feature). Apply AFTER tract metrics. Feature-level `id` is not carried
// (sidewalk features have none). Group order = first appearance; properties object = first seen in group.

/** Canonical (key-sorted) JSON of a properties object, used as the merge key. */
export function propsKey(p) {
  const o = p ?? {}
  return JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]))
}

/** Line parts in a geometry: LineString → 1, MultiLineString → its part count, else 0. */
export function lineParts(g) {
  if (!g) return []
  if (g.type === 'LineString') return [g.coordinates]
  if (g.type === 'MultiLineString') return g.coordinates
  return []
}

export const countParts = (fc) => fc.features.reduce((s, f) => s + lineParts(f.geometry).length, 0)
export const distinctProps = (fc) => new Set(fc.features.map((f) => propsKey(f.properties)))

/** One MultiLineString feature per distinct property set; non-line features pass through unchanged. */
export function mergeByProps(fc) {
  const groups = new Map()
  const other = []
  for (const f of fc.features) {
    const parts = lineParts(f.geometry)
    if (!parts.length && !(f.geometry && /LineString$/.test(f.geometry.type))) { other.push(f); continue }
    const k = propsKey(f.properties)
    let g = groups.get(k)
    if (!g) { g = { properties: { ...(f.properties ?? {}) }, parts: [] }; groups.set(k, g) }
    for (const p of parts) g.parts.push(p)
  }
  const merged = [...groups.values()].map((g) => ({
    type: 'Feature', geometry: { type: 'MultiLineString', coordinates: g.parts }, properties: g.properties,
  }))
  return { ...fc, features: [...merged, ...other] }
}

/** Asserts for a merged sidewalks FC: (a) part count == pre-merge part count (== feature count when all
 * inputs are LineStrings); (b) distinct property sets unchanged; every part keeps ≥2 vertices if it had them. */
export function assertMergeInvariant(before, after, label = 'fc') {
  const pb = countParts(before), pa = countParts(after)
  if (pb !== pa) throw new Error(`[merge] ${label}: line part count changed ${pb} → ${pa}`)
  const db = distinctProps(before), da = distinctProps(after)
  if (db.size !== da.size || [...db].some((k) => !da.has(k))) throw new Error(`[merge] ${label}: distinct property sets changed`)
  for (const f of after.features) for (const p of lineParts(f.geometry)) {
    if (p.length < 2) throw new Error(`[merge] ${label}: a part has <2 vertices`)
  }
  return { preFeatures: before.features.length, parts: pa, features: after.features.length, propSets: da.size }
}

/** Sidewalks pipeline: 5 dp + DP (~1 m) per part, then merge by props, with asserts. */
export function slimAndMergeSidewalks(fc, label = 'sidewalks.geojson') {
  const slim = slimLines(fc)
  // slim keeps count/props per feature; check it before merging.
  assertSlimInvariant(fc, slim, label)
  const merged = mergeByProps(slim)
  const r = assertMergeInvariant(fc, merged, label)
  return { fc: merged, ...r }
}

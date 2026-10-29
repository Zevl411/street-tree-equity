// Small geometry helpers shared by the data pipeline.

/** Round nested coordinate arrays to `p` decimals (5 ≈ 1 m) to keep files small. */
export function roundCoords(coords, p = 5) {
  if (typeof coords[0] === 'number') return coords.map((n) => +n.toFixed(p))
  return coords.map((c) => roundCoords(c, p))
}

export function roundFeature(f, p = 5) {
  if (f.geometry) f.geometry.coordinates = roundCoords(f.geometry.coordinates, p)
  return f
}

export function pointInBbox([x, y], b) {
  return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]
}

/** Quantile class breaks, strictly ascending (MapLibre `step` needs ascending stops). */
export function quantileBreaks(values, classes) {
  const v = [...values].sort((a, b) => a - b)
  const out = []
  for (let i = 1; i < classes; i++) {
    const idx = Math.min(v.length - 1, Math.floor((i / classes) * v.length))
    out.push(+v[idx].toFixed(3))
  }
  const uniq = []
  for (const b of out) if (!uniq.length || b > uniq[uniq.length - 1]) uniq.push(b)
  return uniq
}

/**
 * Choropleth breaks for density values that may be zero-heavy (#35).
 * Quantiles over positive values only; zeros fall in the first class (< breaks[0]).
 * Always strictly positive + strictly ascending. Falls back to equal-interval
 * between min positive and max when quantiles collapse.
 */
export function densityBreaks(values, classes = 5) {
  const pos = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b)
  if (!pos.length) return []
  const want = classes - 1
  const round = (x) => +x.toPrecision(3)
  const clean = (arr) => {
    const u = []
    for (const b of arr.map(round)) if (b > 0 && (!u.length || b > u[u.length - 1])) u.push(b)
    return u
  }
  const q = []
  for (let i = 0; i < want; i++) {
    // i=0 -> smallest positive-ish cut so zeros (and only the lowest positives) sit in class 1
    const idx = Math.min(pos.length - 1, Math.floor((i / want) * pos.length))
    q.push(i === 0 ? pos[0] : pos[idx])
  }
  let out = clean(q)
  // Nudge first break above min positive so class 1 = zeros (+ near-min)
  if (out.length >= want) return out
  const lo = pos[0], hi = pos[pos.length - 1]
  if (hi <= lo) return clean([lo])
  const eq = []
  for (let i = 0; i < want; i++) eq.push(lo + ((hi - lo) * i) / want)
  out = clean(eq)
  return out.length >= 2 ? out : clean([lo, hi])
}

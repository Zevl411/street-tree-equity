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

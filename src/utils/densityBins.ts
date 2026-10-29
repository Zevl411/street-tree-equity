import type { TractCollection } from '@/types'
import { metricValue, type MetricValueKey } from '@/utils/metrics'

const TREES: MetricValueKey = 'treesPerAcre'

/** #59/#63: median of finite treesPerAcre; null when < 2 values. */
export function cityMedian(tracts: TractCollection | null | undefined, key: MetricValueKey = TREES): number | null {
  const v = (tracts?.features ?? []).map((f) => metricValue(f.properties, key)).filter((x): x is number => Number.isFinite(x)).sort((a, b) => a - b)
  if (v.length < 2) return null
  const mid = v.length >> 1
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

/** #72: sorted finite treesPerAcre ascending. */
export function sortedDensities(tracts: TractCollection | null | undefined, key: MetricValueKey = TREES): number[] {
  return (tracts?.features ?? []).map((f) => metricValue(f.properties, key)).filter((x): x is number => Number.isFinite(x)).sort((a, b) => a - b)
}

/** #72: nearest-rank percentile on ascending array — index round((n - 1) * p); null when < 2 values. */
export function densityPercentile(sorted: number[], p: number): number | null {
  if (sorted.length < 2) return null
  return sorted[Math.round((sorted.length - 1) * p)]
}

/** #63: format a density value (already unit-scaled) like MapLegend. */
export function fmtDensity(n: number, isKm2: boolean) {
  if (n === 0) return '0'
  if (isKm2) return n.toLocaleString(undefined, { maximumFractionDigits: n < 10 ? 1 : 0 })
  if (n < 0.1) return n.toFixed(3)
  return n < 1 ? n.toFixed(2) : n.toFixed(1)
}

/** #63: legend bin rows. breaks are trees/acre; k scales display only. lo/hi stay trees/acre. */
export function binRows(breaks: number[], colors: string[], isKm2: boolean, k: number) {
  return colors.map((color, i) => {
    const loA = i === 0 ? 0 : breaks[i - 1]
    const hiA: number | undefined = breaks[i]
    const lo = loA * k
    const hi = hiA === undefined ? undefined : hiA * k
    const f = (n: number) => fmtDensity(n, isKm2)
    const label = hi === undefined ? `≥ ${f(lo)}` : lo === hi ? `≈ ${f(lo)}` : `${f(lo)} – ${f(hi)}`
    return { color, label, lo: i === 0 ? -Infinity : loA, hi: hiA }
  })
}

/** Mirrors MapView fill `step`: v < breaks[0] → 0; v >= breaks[i] → i + 1. */
export function binIndex(v: number, breaks: number[]) {
  let i = 0
  while (i < breaks.length && v >= breaks[i]) i++
  return i
}

/** #93: full-pack tract counts per bin (finite treesPerAcre, binIndex clamped to last bin). */
export function binCounts(tracts: TractCollection | null | undefined, breaks: number[], key: MetricValueKey = TREES): number[] {
  const counts = new Array<number>(breaks.length + 1).fill(0)
  for (const f of tracts?.features ?? []) {
    const v = metricValue(f.properties, key)
    if (!Number.isFinite(v)) continue
    counts[Math.min(binIndex(v, breaks), counts.length - 1)]++
  }
  return counts
}

/** #77: #59 below-median set (finite treesPerAcre ≤ median), ordered rank asc then geoid asc. */
export function belowMedianOrder(tracts: TractCollection | null | undefined, key: MetricValueKey = TREES): { geoid: string; name: string }[] {
  const med = cityMedian(tracts, key)
  if (med == null) return []
  return (tracts?.features ?? [])
    .map((f) => f.properties)
    .filter((p) => Number.isFinite(metricValue(p, key)) && metricValue(p, key) <= med)
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || (a.geoid < b.geoid ? -1 : a.geoid > b.geoid ? 1 : 0))
    .map((p) => ({ geoid: p.geoid, name: p.name }))
}

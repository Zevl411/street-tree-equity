/** #149: pure scenarios; fetched canopy, geometry, Planting need and snapshot inputs never change. */
import type { Meta, TractCollection, TractProps } from '@/types'

export type GapTargetMode = 'p75' | '30'
export const SQM_PER_ACRE = 4046.8564224
export const GAP_METHODS = "Canopy gap estimates the additional tree-canopy area needed to reach a comparison target. By default the target is the 75th percentile of valid tract canopy estimates in the loaded city pack — your city's leafier neighborhoods. Each tract counts once, and the percentile uses linear interpolation (type 7). A switch chooses a fixed 30% target instead. We subtract the tract's estimated canopy percentage from the target, stop at zero, and multiply the percentage-point gap by its canopy sampling land area divided by 100. Land area follows the canopy calculation's valid non-water 30 m samples, with fractional overlap for fewer than 10 sample centers; it is not the Census land-area field. Larger tracts can have larger acreage gaps. This is a comparison, not an official city goal, a tree count or a survey of plantable space. The pack may cover only part of the city. Changing the target does not change measured canopy or Planting need."
export const GAP_CAUTION = 'This estimates additional canopy area, not how many trees to plant or how much plantable space is available.'

type CanopyInput = Pick<TractProps, 'canopyPct' | 'canopyStatus'>
type GapInput = CanopyInput & Pick<TractProps, 'landAcres'>
const validTarget = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100
const nonnegative = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null

export function parseGapTarget(value: unknown): GapTargetMode {
  return typeof value === 'string' && value.trim().toLowerCase() === '30' ? '30' : 'p75'
}

export function validGapCanopy(t: CanopyInput): boolean {
  return validTarget(t.canopyPct) && (t.canopyStatus === undefined || t.canopyStatus === 'ok')
}

/** Type 7 is unweighted, includes zero, and never rounds its inputs or result. */
export function type7(values: readonly number[], p = 0.75): number | null {
  const x = [...values].sort((a, b) => a - b)
  if (!x.length) return null
  const h = (x.length - 1) * p, j = Math.floor(h), g = h - j
  return x[j] + g * (x[Math.min(j + 1, x.length - 1)] - x[j])
}

export function packP75(fc: TractCollection): number | null {
  return type7(fc.features.filter(f => validGapCanopy(f.properties)).map(f => f.properties.canopyPct!))
}

export function gapValues(t: GapInput, target: number | null) {
  const canopyGapPct = validGapCanopy(t) && validTarget(target) ? Math.max(0, target - t.canopyPct!) : null
  const canopyGapAcres = canopyGapPct !== null && typeof t.landAcres === 'number' && Number.isFinite(t.landAcres) && t.landAcres > 0
    ? canopyGapPct / 100 * t.landAcres : null
  return { canopyGapPct, canopyGapAcres }
}

/** Exact runtime counterpart of scripts/lib/geo-utils.mjs densityBreaks; equivalence pinned in tests. */
export function gapBreaks(values: number[], classes = 5): number[] {
  const pos = values.filter(x => Number.isFinite(x) && x > 0).sort((a, b) => a - b)
  if (!pos.length) return []
  const want = classes - 1
  const clean = (arr: number[]) => {
    const out: number[] = []
    for (const b of arr.map(x => +x.toPrecision(3))) {
      if (b > 0 && (!out.length || b > out[out.length - 1])) out.push(b)
    }
    return out
  }
  const q = Array.from({ length: want }, (_, i) => i === 0 ? pos[0] : pos[Math.min(pos.length - 1, Math.floor(i / want * pos.length))])
  let out = clean(q)
  if (out.length >= want) return out
  const lo = pos[0], hi = pos[pos.length - 1]
  if (hi <= lo) return clean([lo])
  out = clean(Array.from({ length: want }, (_, i) => lo + (hi - lo) * i / want))
  return out.length >= 2 ? out : clean([lo, hi])
}

interface GapView {
  collection: TractCollection
  meta: Meta
  target: number | null
  nValid: number
  mode: GapTargetMode
}
interface CacheEntry {
  sourceMeta: Meta
  p75: number | null
  nValid: number
  byMode: Partial<Record<GapTargetMode, GapView>>
}
const views = new WeakMap<TractCollection, CacheEntry>()

export function canopyGapView(fc: TractCollection, meta: Meta, mode: GapTargetMode = 'p75'): GapView {
  let entry = views.get(fc)
  if (!entry) {
    entry = { sourceMeta: meta, p75: packP75(fc), nValid: fc.features.filter(f => validGapCanopy(f.properties)).length, byMode: {} }
    views.set(fc, entry)
  } else if (entry.sourceMeta !== meta) {
    // A metadata wrapper may change; the raw collection's percentile is still computed only once.
    entry.sourceMeta = meta
    entry.byMode = {}
  }
  if (entry.byMode[mode]) return entry.byMode[mode]!
  const target = mode === '30' ? 30 : entry.p75
  const features = fc.features.map(f => Object.freeze({
    ...f,
    properties: Object.freeze({ ...f.properties, canopyTargetMode: mode, canopyTargetPct: target, ...gapValues(f.properties, target) }),
  }))
  const values = features.map(f => f.properties.canopyGapAcres).filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
  const collection = Object.freeze({ ...fc, features: Object.freeze(features) }) as unknown as TractCollection
  const metadata = Object.freeze({
    ...meta,
    metricBreaks: Object.freeze({ ...meta.metricBreaks, canopyGap: Object.freeze(gapBreaks(values)) as unknown as number[] }),
    overall: Object.freeze({ ...meta.overall, canopyGapAcres: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null }),
    canopyGapTarget: Object.freeze({ mode, target, nValid: entry.nValid }),
  })
  const view = Object.freeze({ collection, meta: metadata, target, nValid: entry.nValid, mode })
  entry.byMode[mode] = view
  return view
}

export function gapNumber(n: number): string {
  return n > 0 && n < 0.05 ? '<0.1' : n.toLocaleString('en-US', { maximumFractionDigits: 1 })
}

export function gapTargetLine(mode: GapTargetMode, target: number | null, legend = false): string {
  if (!validTarget(target)) return 'City target unavailable. Use a fixed 30% target to choose a comparison.'
  return legend
    ? `Target: ${gapNumber(target)}% canopy · ${mode === '30' ? 'fixed comparison' : "city's leafier neighborhoods"}`
    : `Target: ${gapNumber(target)}% canopy — ${mode === '30' ? 'fixed comparison' : "your city's leafier neighborhoods"}`
}

/** One null-reason precedence for details and any existing value surface. */
export function gapReason(t: GapInput, target: number | null): [string, string] | null {
  if (t.canopyStatus === 'mostly-water') return ['Mostly water — no canopy-gap estimate', 'At least 99% of this tract is open water; no canopy-gap estimate is shown.']
  if (!validGapCanopy(t)) return ['Canopy gap unavailable — canopy estimate missing', 'Missing canopy is not zero canopy.']
  if (!validTarget(target)) return ['Canopy gap unavailable — city target missing', 'There are no valid canopy estimates in this pack to set the city target. You can choose a fixed 30% target.']
  if (typeof t.landAcres !== 'number' || !Number.isFinite(t.landAcres) || t.landAcres <= 0) return ['Canopy gap unavailable — land area missing', 'A matching non-water canopy-sampling area is needed to estimate acres. Census land area is not substituted.']
  return null
}

export function gapSnapshotSentence(acres: number | null | undefined, mode: GapTargetMode): string | null {
  if (typeof acres !== 'number' || !Number.isFinite(acres) || acres <= 0) return null
  const target = mode === '30' ? 'the 30% canopy target' : "the city's leafier neighborhoods"
  if (acres < 0.5) return `Less than 1 acre of canopy short of ${target}`
  const n = Math.round(acres)
  return `About ${n.toLocaleString('en-US')} ${n === 1 ? 'acre' : 'acres'} of canopy short of ${target}`
}

export const GAP_COLUMNS = ['land_acres', 'canopy_target_mode', 'canopy_target_pct', 'canopy_gap_pct', 'canopy_gap_acres']
export function gapCells(t: TractProps) {
  return [nonnegative(t.landAcres), t.canopyTargetMode ?? 'p75', nonnegative(t.canopyTargetPct), nonnegative(t.canopyGapPct), nonnegative(t.canopyGapAcres)]
}

/** Serializers receive pack metadata and a mode explicitly, never a store or Census-area fallback. */
export function scenarioProps(t: TractProps, meta: Meta, mode: GapTargetMode = 'p75'): TractProps {
  const value = mode === '30' ? 30 : meta.canopyGap?.p75
  const target = validTarget(value) ? value : null
  return { ...t, canopyTargetMode: mode, canopyTargetPct: target, ...gapValues(t, target) }
}

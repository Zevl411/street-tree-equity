/** #147: pure, pack-local point-estimate comparisons. No Vue, store, fetch or pack mutation.
 * Collections are immutable cache keys; replace a collection (or explicitly reset) after changes.
 */
import type { Meta, TractCollection, TractProps } from '@/types'
import { METRICS, METRIC_SWITCH_ORDER, fmtMetric, metricAvailable, metricValue, type MetricId, type MetricUnit } from './metrics.ts'
import { PLACES_MEASURES } from './placesMeasures.ts'

export const SNAPSHOT_MIN_VALID_TRACTS = 10
export const SNAPSHOT_WORST_LIMIT = 3
/** Registry id, not a field name. #148 can replace the context metric in this one place. */
export const SNAPSHOT_CANOPY_METRIC: MetricId = 'trees'
export const SNAPSHOT_EXCLUDED_METRICS: readonly MetricId[] = Object.freeze(['trees', 'plantNeed', 'risk', 'age65', 'under18'])
const allowlist: readonly MetricId[] = ['parks', 'groceries', 'income', 'foodAccess', 'poverty', 'noVehicle', 'rentBurden', 'asthma', 'diabetes', 'lep', 'snap', 'obesity', 'mentalHealth', 'physicalHealth', 'bphigh', 'chd', 'stroke', 'inactivity', 'copd', 'smoking', 'disability', 'shortSleep', 'uninsured']
/** Future registry entries are not automatically eligible. */
export const SNAPSHOT_CANDIDATE_METRICS: readonly MetricId[] = Object.freeze(METRIC_SWITCH_ORDER.filter(id => allowlist.includes(id)))
const order = new Map(METRIC_SWITCH_ORDER.map((id, i) => [id, i]))
const ACRES_PER_KM2 = 1 / 0.0040468564224

export interface SnapshotMetric {
  readonly metricId: MetricId
  readonly value: number
  readonly validCount: number
  readonly lower: number
  readonly higher: number
  /** Other equal-valued tracts, excluding the selected tract itself. */
  readonly tied: number
  readonly better: number
  /** Ascending density mid-rank C; raw, never presentation-rounded. */
  readonly percentile: number
  /** X = 100 * (better + tied/2) / (validCount-1). Engineering direction, not a judgment of people. */
  readonly badness: number
  readonly numerator: number
  readonly denominator: number
  readonly modelEstimate: boolean
}
export interface TractSnapshot {
  readonly geoid: string
  readonly canopy: SnapshotMetric | null
  readonly canopyUnavailable: 'missing' | 'insufficient' | null
  readonly worst: readonly SnapshotMetric[]
  readonly eligibleCount: number
  readonly aboveFloorCount: number
}
export interface TractSnapshotIndex {
  readonly collection: TractCollection
  readonly meta: Meta
  readonly distributions: ReadonlyMap<MetricId, readonly number[]>
  readonly select: (geoid: string | null | undefined) => TractSnapshot | null
}
interface PackIndex {
  readonly distributions: ReadonlyMap<MetricId, readonly number[]>
  readonly byGeoid: ReadonlyMap<string, TractProps>
  readonly byMeta: WeakMap<Meta, TractSnapshotIndex>
}
let packCache = new WeakMap<TractCollection, PackIndex>()

function bound(a: readonly number[], x: number, upper: boolean): number {
  let lo = 0, hi = a.length
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2)
    if (a[mid] < x || (upper && a[mid] === x)) lo = mid + 1
    else hi = mid
  }
  return lo
}
/** Binary counts in canonical units; no selected-tract rescan, coercion or epsilon ties. */
export function snapshotMetric(id: MetricId, value: number, sorted: readonly number[]): SnapshotMetric | null {
  if (!Number.isFinite(value) || sorted.length < SNAPSHOT_MIN_VALID_TRACTS) return null
  const lower = bound(sorted, value, false), end = bound(sorted, value, true)
  if (end === lower) return null // selected value must belong to this collection's distribution
  const higher = sorted.length - end, tied = end - lower - 1
  const better = METRICS[id].higherIsBetter ? higher : lower
  const numerator = 2 * better + tied, denominator = 2 * (sorted.length - 1)
  return Object.freeze({ metricId: id, value, validCount: sorted.length, lower, higher, tied, better,
    numerator, denominator, badness: 100 * numerator / denominator,
    percentile: 100 * (2 * lower + tied) / denominator,
    modelEstimate: Object.prototype.hasOwnProperty.call(PLACES_MEASURES, id) })
}
/** Exact fraction ordering even across differing denominators; then registry switch order. */
function compare(a: SnapshotMetric, b: SnapshotMetric): number {
  const left = BigInt(a.numerator) * BigInt(b.denominator)
  const right = BigInt(b.numerator) * BigInt(a.denominator)
  return left === right ? order.get(a.metricId)! - order.get(b.metricId)! : left > right ? -1 : 1
}
/** O(M*N log N) arrays once per raw collection identity, reused across metadata wrappers.
 * A load-ready metadata wrapper applies metricAvailable exactly once, not on each selection.
 * Each selected lookup uses O(M log N) binary bounds and sorts at most 23 small results.
 */
export function getTractSnapshotIndex(collection: TractCollection, meta: Meta): TractSnapshotIndex {
  let base = packCache.get(collection)
  if (!base) {
    const distributions = new Map<MetricId, readonly number[]>()
    for (const id of new Set([...SNAPSHOT_CANDIDATE_METRICS, SNAPSHOT_CANOPY_METRIC])) {
      const values = collection.features.map(f => metricValue(f.properties, METRICS[id].valueKey))
        .filter(Number.isFinite).sort((a, b) => a - b)
      distributions.set(id, Object.freeze(values))
    }
    base = { distributions, byGeoid: new Map(collection.features.map(f => [f.properties.geoid, f.properties])), byMeta: new WeakMap() }
    packCache.set(collection, base)
  }
  const cached = base.byMeta.get(meta)
  if (cached) return cached
  const prepared = base
  const available = SNAPSHOT_CANDIDATE_METRICS.filter(id => !SNAPSHOT_EXCLUDED_METRICS.includes(id) && id !== SNAPSHOT_CANOPY_METRIC && metricAvailable(id, meta, collection))
  const canopyAvailable = metricAvailable(SNAPSHOT_CANOPY_METRIC, meta, collection)
  const selected = new Map<string, TractSnapshot>()
  const index: TractSnapshotIndex = Object.freeze({ collection, meta, distributions: prepared.distributions,
    select(geoid: string | null | undefined): TractSnapshot | null {
      if (geoid == null) return null
      const props = prepared.byGeoid.get(geoid)
      if (!props) return null
      if (selected.has(geoid)) return selected.get(geoid)!
      const eligible = available.flatMap(id => {
        const score = snapshotMetric(id, metricValue(props, METRICS[id].valueKey), prepared.distributions.get(id)!)
        return score ? [score] : []
      })
      // Exact raw X > 50; not a condition on rounded presentation or floating subtraction.
      const qualified = eligible.filter(item => item.numerator > item.denominator / 2).sort(compare)
      const canopyValue = metricValue(props, METRICS[SNAPSHOT_CANOPY_METRIC].valueKey)
      const canopyValues = prepared.distributions.get(SNAPSHOT_CANOPY_METRIC)!
      const canopy = canopyAvailable
        ? snapshotMetric(SNAPSHOT_CANOPY_METRIC, canopyValue, canopyValues) : null
      const result: TractSnapshot = Object.freeze({ geoid, canopy,
        canopyUnavailable: canopy ? null : !Number.isFinite(canopyValue) ? 'missing' : 'insufficient',
        worst: Object.freeze(qualified.slice(0, SNAPSHOT_WORST_LIMIT)), eligibleCount: eligible.length, aboveFloorCount: qualified.length })
      selected.set(geoid, result)
      return result
    },
  })
  base.byMeta.set(meta, index)
  return index
}
export function tractSnapshot(pack: TractCollection | null | undefined, geoid: string | null | undefined, meta: Meta | null | undefined): TractSnapshot | null {
  return pack && meta ? getTractSnapshotIndex(pack, meta).select(geoid) : null
}
export function resetTractSnapshotCache(pack?: TractCollection): void {
  if (pack) packCache.delete(pack)
  else packCache = new WeakMap()
}

export const SNAPSHOT_MAPPING_NOTE = 'Street trees come from OpenStreetMap; some areas are under-mapped, so low counts may reflect mapping gaps.'
export const SNAPSHOT_INSUFFICIENT = "There isn't enough data to compare this tract. Each measure needs data for at least 10 tracts."
export const SNAPSHOT_DUAL_NOTE = 'Turn off dual view to switch the map from here.'
export function snapshotCityName(metaName?: string, fallbackName?: string): string {
  return (metaName || fallbackName || '').trim().replace(/,\s*[A-Z]{2}$/, '').trim() || 'this city'
}
export function snapshotLabel(id: MetricId): string {
  return id === 'uninsured' ? 'No health insurance (ages 18–64)' : METRICS[id].shortLabel
}
export function snapshotPercent(x: number): number { return Math.max(1, Math.min(99, Math.floor(x))) }
export function snapshotComparison(item: SnapshotMetric, city: string): string {
  const n = item.validCount - 1
  const adverse = METRICS[item.metricId].higherIsBetter ? 'Lower' : 'Higher'
  const reverse = adverse === 'Higher' ? 'Lower' : 'Higher'
  if (item.tied === 0 && item.better === n) return `${adverse} than all ${n} other tracts in ${city}`
  if (item.tied === 0 && item.better === 0) return `${reverse} than all ${n} other tracts in ${city}`
  return `${adverse} than ${snapshotPercent(item.badness)}% of other tracts in ${city}`
}
export function snapshotCanopyComparison(item: SnapshotMetric, city: string, unit: MetricUnit): string {
  // Rev 3: zero is honest mapped-data context, never a "more trees" percentile claim.
  if (item.value === 0) return item.tied ? `Tied with ${item.tied} other tracts in ${city} that have no street trees mapped.` : ''
  const area = unit === 'km2' ? 'km²' : 'acre'
  const n = item.validCount - 1
  if (item.tied === 0 && item.higher === 0) return `More street trees per ${area} than all ${n} other tracts in ${city}`
  if (item.tied === 0 && item.lower === 0) return `Fewer street trees per ${area} than all ${n} other tracts in ${city}`
  return `More street trees per ${area} than ${Math.max(1, Math.min(99, Math.round(item.percentile)))}% of other tracts in ${city}`
}
function zeroSentence(id: MetricId): string | null {
  return id === SNAPSHOT_CANOPY_METRIC ? 'No street trees mapped' : id === 'groceries' ? 'No grocery stores mapped' : id === 'parks' ? 'No parks mapped' : null
}
export function snapshotValue(item: SnapshotMetric, unit: MetricUnit): string {
  const def = METRICS[item.metricId]
  if (!def.usesDensityUnit) return fmtMetric(def, item.value, unit === 'km2', ACRES_PER_KM2)
  if (item.value === 0 && zeroSentence(item.metricId)) return zeroSentence(item.metricId)!
  const v = item.value * (unit === 'km2' ? ACRES_PER_KM2 : 1)
  const compact = () => v.toLocaleString('en-US', { maximumSignificantDigits: 2, useGrouping: false })
  const density = item.metricId === SNAPSHOT_CANOPY_METRIC
    ? (unit === 'km2' ? (Math.round(v * 10) === 0 && v > 0 ? compact() : v.toLocaleString(undefined, { maximumFractionDigits: 1 }))
      : (Number(v.toFixed(2)) === 0 && v > 0 ? compact() : v.toFixed(2)))
    : compact()
  return `${density} ${def.spreadUnit(unit)}`
}
export function snapshotMessage(result: TractSnapshot, city: string): string | null {
  const n = result.worst.length
  if (n === 3) return null
  if (n > 0) return `Only ${n} ${n === 1 ? 'measure here is' : 'measures here are'} higher-need than most other tracts in ${city}.`
  return result.eligibleCount ? `No measures here stand out as higher-need than most other tracts in ${city}.` : SNAPSHOT_INSUFFICIENT
}
export interface SnapshotRow {
  readonly metricId: MetricId
  readonly label: string
  readonly value: string
  readonly line1: string
  readonly line2: string
  readonly ariaLabel: string
}
export function snapshotRow(item: SnapshotMetric, city: string, unit: MetricUnit): SnapshotRow {
  const label = snapshotLabel(item.metricId), value = snapshotValue(item, unit)
  const line2 = item.metricId === SNAPSHOT_CANOPY_METRIC ? snapshotCanopyComparison(item, city, unit) : snapshotComparison(item, city)
  const line1 = item.value === 0 && zeroSentence(item.metricId) ? value : `${label} · ${value}${item.modelEstimate ? ' · model estimate' : ''}`
  return Object.freeze({ metricId: item.metricId, label, value, line1, line2,
    ariaLabel: [`Switch map to ${label}`, line2 ? line2[0].toLowerCase() + line2.slice(1) : '', value].filter(Boolean).join(', ') + (item.modelEstimate ? ', model estimate' : '') })
}
export function snapshotCanopyUnavailable(result: TractSnapshot): string {
  return result.canopyUnavailable === 'missing' ? 'Street-tree comparison unavailable for this tract.' : 'Not enough street-tree data to compare this tract (10 tracts needed).'
}

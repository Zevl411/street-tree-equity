/** #147 pure tract-snapshot preparation. No store, Vue, formatting, or UI copy.
 * Pack collections are immutable cache keys: replace the collection or explicitly reset its cache
 * after an in-place data change. Nothing is attached to, sorted in, or otherwise written to the pack.
 * Later UI wiring (after Designer lock): read ui.dualView only. While dual is on, snapshot items
 * are plain text, not buttons. Otherwise use ui.setActiveMetric(id) and keep focus on the item.
 * No dual-component imports or dual-state writes belong here or in that click path.
 */
import type { TractCollection, TractProps } from '@/types'
import { METRICS, METRIC_IDS, METRIC_SWITCH_ORDER, metricValue, type MetricId } from './metrics.ts'

export const SNAPSHOT_MIN_VALID_TRACTS = 10
export const SNAPSHOT_WORST_LIMIT = 3

/** Registry audit (#147 TL decision): exclude composite/derived indices to avoid double-counting.
 * risk = FEMA National Risk Index risk score (derived index).
 * plantNeed = canopy + poverty + optional asthma (locally constructed composite).
 * Other registry entries are individual densities, shares/prevalences or a median, not indices.
 * Canopy remains separately available; it is excluded from worst by the dedicated trees branch.
 */
export const SNAPSHOT_EXCLUDED_METRICS: readonly MetricId[] = Object.freeze(['risk', 'plantNeed'] as const)
const excludedMetrics = new Set(SNAPSHOT_EXCLUDED_METRICS)

export interface SnapshotMetric {
  readonly metricId: MetricId
  readonly value: number
  readonly validCount: number
  /** Ascending-value percentile: average zero-based tied rank / (validCount - 1) × 100.
   * Unique extremes are 0 and 100; an all-equal distribution is 50. Never presentation-rounded.
   * TL-confirmed normalization compares with the other n−1 tracts, splitting tied ranks evenly.
   * Direction is applied separately in badness, interpreted as "worse than X% of other tracts".
   */
  readonly percentile: number
  /** Direction-adjusted mid-rank: "worse than X% of other tracts" (X = badness).
   * Higher means worse: 100 - percentile when higherIsBetter, percentile otherwise; ties averaged.
   */
  readonly badness: number
}

export interface TractSnapshot {
  readonly geoid: string
  /** Same finite-value / minimum-n rules as other metrics; never included in worst. */
  readonly canopy: SnapshotMetric | null
  /** Up to three metrics, descending badness; exact ties use METRIC_SWITCH_ORDER. */
  readonly worst: readonly SnapshotMetric[]
}

interface Rank {
  readonly percentile: number
  readonly badness: number
}
interface WorkingTract {
  readonly props: TractProps
  canopy: SnapshotMetric | null
  readonly metrics: SnapshotMetric[]
}

let packCache = new WeakMap<TractCollection, ReadonlyMap<string, TractSnapshot>>()
const switchIndex = new Map(METRIC_SWITCH_ORDER.map((id, i) => [id, i]))
// Registry-order fallback is only for a future registered id omitted from switch order.
const orderIndex = (id: MetricId) => switchIndex.get(id) ?? METRIC_SWITCH_ORDER.length + METRIC_IDS.indexOf(id)

function metricRanks(sorted: readonly number[], higherIsBetter: boolean): ReadonlyMap<number, Rank> {
  const ranks = new Map<number, Rank>()
  const last = sorted.length - 1
  for (let start = 0; start < sorted.length;) {
    let end = start + 1
    while (end < sorted.length && sorted[end] === sorted[start]) end++
    const midRank = (start + end - 1) / 2
    ranks.set(sorted[start], {
      percentile: (midRank / last) * 100,
      // Orient the exact mid-rank before division, rather than subtracting rounded percentages.
      // Equal fractions with opposite polarities then tie without a floating-point subtraction bias.
      badness: ((higherIsBetter ? last - midRank : midRank) / last) * 100,
    })
    start = end
  }
  return ranks
}

function preparePack(pack: TractCollection): ReadonlyMap<string, TractSnapshot> {
  const rows: WorkingTract[] = pack.features.map(({ properties }) => ({ props: properties, canopy: null, metrics: [] }))
  for (const id of METRIC_IDS) {
    if (excludedMetrics.has(id)) continue
    const def = METRICS[id]
    if (typeof def.higherIsBetter !== 'boolean') continue
    const sorted = rows.map(({ props }) => metricValue(props, def.valueKey)).filter(Number.isFinite).sort((a, b) => a - b)
    if (sorted.length < SNAPSHOT_MIN_VALID_TRACTS) continue
    const ranks = metricRanks(sorted, def.higherIsBetter)
    for (const row of rows) {
      const value = metricValue(row.props, def.valueKey)
      const rank = ranks.get(value)
      if (!rank) continue // own null, absent, NaN, infinity, or non-number is skipped (never a fake zero)
      const item: SnapshotMetric = Object.freeze({ metricId: id, value, validCount: sorted.length, ...rank })
      if (id === 'trees') row.canopy = item
      else row.metrics.push(item)
    }
  }
  const snapshots = new Map<string, TractSnapshot>()
  for (const row of rows) {
    row.metrics.sort((a, b) => b.badness - a.badness || orderIndex(a.metricId) - orderIndex(b.metricId))
    snapshots.set(row.props.geoid, Object.freeze({
      geoid: row.props.geoid,
      canopy: row.canopy,
      worst: Object.freeze(row.metrics.slice(0, SNAPSHOT_WORST_LIMIT)),
    }))
  }
  return snapshots
}

/** Build every tract's result once per collection, then select by geoid in O(1).
 * Preparation is O(M × N log N + N × M log M), not O(N²) per selection.
 * Eligible metrics come from the registry (defined boolean higherIsBetter), minus the explicit
 * SNAPSHOT_EXCLUDED_METRICS audit list, not layer/filter state
 * or metricBreaks. Missing pack/selection/tract returns null; a known tract may have no valid metrics.
 */
export function tractSnapshot(pack: TractCollection | null | undefined, geoid: string | null | undefined): TractSnapshot | null {
  if (!pack || geoid == null) return null
  let snapshots = packCache.get(pack)
  if (!snapshots) {
    snapshots = preparePack(pack)
    packCache.set(pack, snapshots)
  }
  return snapshots.get(geoid) ?? null
}

/** Evict one immutable-pack identity, or all packs when omitted (including test reset). */
export function resetTractSnapshotCache(pack?: TractCollection): void {
  if (pack) packCache.delete(pack)
  else packCache = new WeakMap()
}

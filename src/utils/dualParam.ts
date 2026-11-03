// #118: `?dual=left,right` share-URL pair. Pure helpers (no Vue / store) so they're unit-testable.
import type { MetricId } from './metrics'

export interface DualPair { left: MetricId; right: MetricId }

/**
 * Parse `dual=` (case-insensitive): split on the first comma, trim, resolve aliases via the
 * same resolver as `?metric=`. Returns null when missing, single value, unknown, identical, or >2 ids.
 */
export function parseDualParam(raw: string | null | undefined, resolve: (v: string) => MetricId | null): DualPair | null {
  if (raw == null) return null
  const i = raw.indexOf(',')
  if (i < 0) return null
  const a = raw.slice(0, i).trim()
  const b = raw.slice(i + 1).trim()
  if (!a || !b || b.includes(',')) return null
  const left = resolve(a)
  const right = resolve(b)
  if (!left || !right || left === right) return null
  return { left, right }
}

/** Valid for the loaded pack iff ≥2 metrics and both sides available. */
export function dualPairAvailable(p: DualPair | null, avail: readonly MetricId[]): p is DualPair {
  return !!p && avail.length >= 2 && p.left !== p.right && avail.includes(p.left) && avail.includes(p.right)
}

/** Encode `left,right` lowercase (left first). */
export function encodeDualParam(left: MetricId, right: MetricId): string {
  return `${left.toLowerCase()},${right.toLowerCase()}`
}

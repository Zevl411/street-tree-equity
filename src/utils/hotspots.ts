import type { TractFeature } from '@/types'
import { metricValue, type MetricValueKey } from '@/utils/metrics'

/** #43/#90: hotspot set size — shared by HotspotsPanel list and MapView dim. */
export const HOTSPOTS_MAX = 10

/** #90: the single hotspot ranking — finite density, density ↑, rank ↓, name. Top MAX. */
export function hotspotTracts(features: TractFeature[] | null | undefined, key: MetricValueKey = 'treesPerAcre'): TractFeature[] {
  return [...(features ?? [])]
    .filter((f) => Number.isFinite(metricValue(f.properties, key)))
    .sort((a, b) => {
      const pa = a.properties, pb = b.properties
      return metricValue(pa, key) - metricValue(pb, key)
        || (pb.rank ?? 0) - (pa.rank ?? 0)
        || (pa.name ?? '').localeCompare(pb.name ?? '', undefined, { numeric: true })
    })
    .slice(0, HOTSPOTS_MAX)
}

export function hotspotGeoids(features: TractFeature[] | null | undefined, key: MetricValueKey = 'treesPerAcre'): string[] {
  return hotspotTracts(features, key).map((f) => String(f.properties.geoid))
}

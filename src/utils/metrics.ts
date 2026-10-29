/** #97 A0: metric registry. Only `trees` is registered; unknown ids fall back to trees. */
export type MetricId = 'trees'
export type MetricUnit = 'acre' | 'km2'

export interface MetricDef {
  id: MetricId
  /** Layers stub / future switch label */
  shortLabel: string
  /** Choropleth property used today (pack field) */
  valueKey: 'treesPerAcre'
  legendTitle: (unit: MetricUnit) => string
  /** Hist / unit toggle aria */
  unitNoun: string
  /** Spread / hist / compare unit suffix */
  spreadUnit: (unit: MetricUnit) => string
  bmCaption: string
  bmSwitchLabel: string
}

export const DEFAULT_METRIC: MetricId = 'trees'

export const METRICS: Record<MetricId, MetricDef> = {
  trees: {
    id: 'trees',
    shortLabel: 'Street trees',
    valueKey: 'treesPerAcre',
    legendTitle: (u) => (u === 'km2' ? 'Trees / km²' : 'Trees / acre'),
    unitNoun: 'tree density',
    spreadUnit: (u) => (u === 'km2' ? 'trees/km²' : 'trees/acre'),
    bmCaption: 'Dims tracts above this city’s median trees/acre',
    bmSwitchLabel: 'Below city median',
  },
}

export function isMetricId(v: unknown): v is MetricId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(METRICS, v)
}
/** Clamp to a registered id; unknown / missing → trees. */
export function normalizeMetric(v: unknown): MetricId {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : v
  return isMetricId(s) ? s : DEFAULT_METRIC
}
export function metricDef(id: unknown): MetricDef {
  return METRICS[normalizeMetric(id)]
}

import type { Meta, TractCollection } from '@/types'

/** #97/#98: metric registry (trees + parks); unknown ids fall back to trees. */
export type MetricId = 'trees' | 'parks'
export type MetricUnit = 'acre' | 'km2'

export type MetricValueKey = 'treesPerAcre' | 'parksPerAcre'

export interface MetricDef {
  id: MetricId
  /** Layers stub / future switch label */
  shortLabel: string
  /** Choropleth property used today (pack field) */
  valueKey: MetricValueKey
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
  parks: {
    id: 'parks',
    shortLabel: 'Parks',
    valueKey: 'parksPerAcre',
    legendTitle: (u) => (u === 'km2' ? 'Parks / km²' : 'Parks / acre'),
    unitNoun: 'park density',
    spreadUnit: (u) => (u === 'km2' ? 'parks/km²' : 'parks/acre'),
    bmCaption: 'Dims tracts above this city’s median parks/acre',
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

/** #98: pack carries this metric? trees always; parks needs tract `parksPerAcre`. */
export function metricAvailable(id: MetricId, meta: Meta | null | undefined, tracts: TractCollection | null | undefined): boolean {
  if (id === 'trees') return true
  const key = METRICS[id].valueKey
  return !!meta?.metricBreaks?.[id] && (tracts?.features ?? []).some((f) => Number.isFinite((f.properties as unknown as Record<string, number>)[key]))
}

/** #98: meta view whose `breaks`/`colors` follow the metric (trees = pack meta untouched). */
export function metricMeta(meta: Meta, id: MetricId): Meta {
  if (id === 'trees') return meta
  const breaks = meta.metricBreaks?.[id]
  if (!breaks) return meta
  const pal = ['#f7fcb9', '#d9f0a3', '#addd8e', '#78c679', '#31a354', '#006837']
  const colors = meta.colors.length === breaks.length + 1 ? meta.colors : pal.slice(-(breaks.length + 1))
  return { ...meta, breaks, colors }
}

/** #98: tract value for a metric (NaN when missing). */
export function metricValue(p: object, key: MetricValueKey): number {
  const v = (p as Record<string, unknown>)[key]
  return typeof v === 'number' ? v : NaN
}

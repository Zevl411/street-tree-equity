import type { Meta, TractCollection } from '@/types'

/** #97/#98: metric registry (trees + parks); unknown ids fall back to trees. */
export type MetricId = 'trees' | 'parks' | 'groceries' | 'risk'
export type MetricUnit = 'acre' | 'km2'

export type MetricValueKey = 'treesPerAcre' | 'parksPerAcre' | 'groceriesPerAcre' | 'nriRiskScore'

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
  /** #99: sparse amenity metric → finer precision (.toFixed(4) / km² max 2) */
  fine: boolean
  /** #99: meta.overall key for overview */
  overallKey: MetricValueKey
  /** #99: hotspots panel title + announce noun (singular/plural); null = trees canopy copy */
  hotspotNoun: [string, string] | null
  hotspotTitle: string
  /** #99: disabled caption when pack lacks the metric */
  missingCaption: string
  /** #100: false → hotspots sort desc, BM dims below median */
  higherIsBetter: boolean
  /** #100: false → unitless (no acre/km² toggle, 1 decimal) */
  usesDensityUnit: boolean
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
    fine: false, overallKey: 'treesPerAcre', hotspotNoun: null, hotspotTitle: 'Low-canopy hotspots', missingCaption: '',
    higherIsBetter: true, usesDensityUnit: true,
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
    fine: true, overallKey: 'parksPerAcre', hotspotNoun: ['low park access tract', 'low park access tracts'], hotspotTitle: 'Low park access', missingCaption: 'This pack has no park metric yet',
    higherIsBetter: true, usesDensityUnit: true,
  },
  groceries: {
    id: 'groceries',
    shortLabel: 'Groceries',
    valueKey: 'groceriesPerAcre',
    legendTitle: (u) => (u === 'km2' ? 'Groceries / km²' : 'Groceries / acre'),
    unitNoun: 'grocery density',
    spreadUnit: (u) => (u === 'km2' ? 'groceries/km²' : 'groceries/acre'),
    bmCaption: 'Dims tracts above this city’s median groceries/acre',
    bmSwitchLabel: 'Below city median',
    fine: true, overallKey: 'groceriesPerAcre', hotspotNoun: ['low grocery access tract', 'low grocery access tracts'], hotspotTitle: 'Low grocery access', missingCaption: 'This pack has no grocery metric yet',
    higherIsBetter: true, usesDensityUnit: true,
  },
  risk: {
    id: 'risk',
    shortLabel: 'Risk (NRI)',
    valueKey: 'nriRiskScore',
    legendTitle: () => 'NRI risk score',
    unitNoun: 'risk score',
    spreadUnit: () => 'risk score',
    bmCaption: 'Dims tracts below this city’s median NRI risk score',
    bmSwitchLabel: 'Above city median',
    fine: true, overallKey: 'nriRiskScore', hotspotNoun: ['highest-risk tract', 'highest-risk tracts'], hotspotTitle: 'Highest risk', missingCaption: 'This pack has no risk metric yet',
    higherIsBetter: false, usesDensityUnit: false,
  },
}

export const METRIC_IDS = Object.keys(METRICS) as MetricId[]

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

/** #98: pack carries this metric? trees always; others need tract valueKey + metricBreaks[id]. */
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

/** #100: display a metric value (acre-based); unitless metrics → 1 decimal, no scaling. */
export function fmtMetric(def: MetricDef, acreValue: number, km2: boolean, acresPerKm2: number): string {
  if (!def.usesDensityUnit) return acreValue.toLocaleString(undefined, { maximumFractionDigits: 1 })
  return km2 ? (acreValue * acresPerKm2).toLocaleString(undefined, { maximumFractionDigits: 2 }) : acreValue.toFixed(4)
}

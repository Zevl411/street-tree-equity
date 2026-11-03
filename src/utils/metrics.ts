import type { Meta, TractCollection } from '@/types'

/** #97/#98: metric registry (trees + parks); unknown ids fall back to trees. */
export type MetricId = 'trees' | 'parks' | 'groceries' | 'risk' | 'income' | 'foodAccess' | 'poverty' | 'noVehicle' | 'rentBurden' | 'under18' | 'asthma' | 'diabetes' | 'lep' | 'obesity'
export type MetricUnit = 'acre' | 'km2'

export type MetricValueKey = 'treesPerAcre' | 'parksPerAcre' | 'groceriesPerAcre' | 'nriRiskScore' | 'medianIncome' | 'foodAccessLowShare' | 'pctPoverty' | 'pctNoVehicle' | 'pctRentBurden' | 'pctUnder18' | 'pctAsthma' | 'pctDiabetes' | 'pctLep' | 'pctObesity'

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
  /** #115: Designer per-metric Hotspots sort override; absent → derived from higherIsBetter (true → asc) */
  hotspotSort?: 'asc' | 'desc'
  /** #100: false → unitless (no acre/km² toggle, 1 decimal) */
  usesDensityUnit: boolean
  /** #103: USD currency display (no cents) */
  currency?: boolean
  /** #106: 0–1 share displayed as percent */
  percent?: boolean
  /** #107: value already 0–100 percent points */
  percentPoints?: boolean
  /** #117 soft: neutral hover description on the metric switch */
  tooltip?: string
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
  // #103: ACS B19013 — need-focused like amenities (lowest first, dims above median); higher is better.
  income: {
    id: 'income',
    shortLabel: 'Income',
    valueKey: 'medianIncome',
    legendTitle: () => 'Median household income',
    unitNoun: 'household income',
    spreadUnit: () => 'USD',
    bmCaption: 'Dims tracts above this city’s median household income',
    bmSwitchLabel: 'Below city median',
    fine: false, overallKey: 'medianIncome', hotspotNoun: ['lowest-income tract', 'lowest-income tracts'], hotspotTitle: 'Lowest income', missingCaption: 'This pack has no income metric yet',
    higherIsBetter: true, usesDensityUnit: false, currency: true,
  },
  // #106: USDA ERS SRAM 2025 — Euclidean ½-mile low-access population share (0–1); higher = worse.
  foodAccess: {
    id: 'foodAccess',
    shortLabel: 'Food access',
    valueKey: 'foodAccessLowShare',
    legendTitle: () => 'Low food access %',
    unitNoun: 'low-access share',
    spreadUnit: () => '%',
    bmCaption: 'Dims tracts below this city’s median low-access share',
    bmSwitchLabel: 'Above city median',
    fine: true, overallKey: 'foodAccessLowShare', hotspotNoun: ['high low-access tract', 'high low-access tracts'], hotspotTitle: 'Highest low-access share', missingCaption: 'This pack has no food-access metric yet',
    higherIsBetter: false, usesDensityUnit: false, percent: true,
  },
  // #107: ACS 5-year B17001 — % of people below poverty (0–100); higher = worse (NOT income's true).
  poverty: {
    id: 'poverty',
    shortLabel: 'Poverty',
    valueKey: 'pctPoverty',
    legendTitle: () => 'Population below poverty level',
    unitNoun: 'poverty rate',
    spreadUnit: () => '%',
    bmCaption: 'Dims tracts below this city’s median poverty rate',
    bmSwitchLabel: 'Above city median',
    fine: false, overallKey: 'pctPoverty', hotspotNoun: ['highest-poverty tract', 'highest-poverty tracts'], hotspotTitle: 'Highest poverty', missingCaption: 'This pack has no poverty metric yet',
    higherIsBetter: false, usesDensityUnit: false, percentPoints: true,
  },
  // #109: ACS 5-year B08201 — % of households with no vehicle (0–100); higher = more need.
  noVehicle: {
    id: 'noVehicle',
    shortLabel: 'No vehicle',
    valueKey: 'pctNoVehicle',
    legendTitle: () => 'Households with no vehicle',
    unitNoun: 'no-vehicle share',
    spreadUnit: () => '%',
    bmCaption: 'Dims tracts below this city’s median no-vehicle share',
    bmSwitchLabel: 'Above city median',
    fine: false, overallKey: 'pctNoVehicle', hotspotNoun: ['most car-free tract', 'most car-free tracts'], hotspotTitle: 'Most car-free households', missingCaption: 'This pack has no vehicle-access metric yet',
    higherIsBetter: false, usesDensityUnit: false, percentPoints: true,
  },
  // #111: ACS 5-year B25070 — % of renters (computed burden) paying ≥30% of income on gross rent; higher = worse.
  rentBurden: {
    id: 'rentBurden',
    shortLabel: 'Rent burden',
    valueKey: 'pctRentBurden',
    legendTitle: () => 'Renters paying ≥30% of income',
    unitNoun: 'rent-burden share',
    spreadUnit: () => '%',
    bmCaption: 'Dims tracts below this city’s median rent-burden share',
    bmSwitchLabel: 'Above city median',
    fine: false, overallKey: 'pctRentBurden', hotspotNoun: ['most rent-burdened tract', 'most rent-burdened tracts'], hotspotTitle: 'Most rent-burdened', missingCaption: 'This pack has no rent-burden metric yet',
    higherIsBetter: false, usesDensityUnit: false, percentPoints: true,
  },
  // #115: ACS 5-year B01001 — % residents under 18 (M003–006 + F027–030)/001. Hotspots desc via hotspotSort override.
  under18: {
    id: 'under18',
    shortLabel: 'Under 18',
    valueKey: 'pctUnder18',
    legendTitle: () => 'Residents under 18',
    unitNoun: 'under-18 share',
    spreadUnit: () => '%',
    bmCaption: 'Dims tracts below this city’s median under-18 share',
    bmSwitchLabel: 'Below city median',
    fine: false, overallKey: 'pctUnder18', hotspotNoun: ['child-heavy tract', 'child-heavy tracts'], hotspotTitle: 'Most children', missingCaption: 'This pack has no under-18 metric yet',
    hotspotSort: 'desc',
    higherIsBetter: true, usesDensityUnit: false, percentPoints: true,
  },
  // #117: CDC PLACES 2025 — CASTHMA crude prevalence, adults ≥18 (model-based). Default polarity → Hotspots desc.
  asthma: {
    id: 'asthma',
    shortLabel: 'Asthma',
    valueKey: 'pctAsthma',
    legendTitle: () => 'Adults with current asthma',
    unitNoun: 'asthma share',
    spreadUnit: () => '%',
    bmCaption: 'Dims tracts below this city’s median asthma share',
    bmSwitchLabel: 'Above city median',
    fine: false, overallKey: 'pctAsthma', hotspotNoun: ['high-asthma tract', 'high-asthma tracts'], hotspotTitle: 'Highest asthma share', missingCaption: 'This pack has no asthma metric yet',
    tooltip: 'Model-based share of adults with current asthma (CDC PLACES). Heat and low canopy can worsen respiratory conditions.',
    higherIsBetter: false, usesDensityUnit: false, percentPoints: true,
  },
  // #119: CDC PLACES 2025 — DIABETES crude prevalence, adults ≥18 (model-based). Default polarity → Hotspots desc.
  diabetes: {
    id: 'diabetes',
    shortLabel: 'Diabetes',
    valueKey: 'pctDiabetes',
    legendTitle: () => 'Adults with diabetes',
    unitNoun: 'diabetes share',
    spreadUnit: () => '%',
    bmCaption: 'Dims tracts below this city’s median diabetes share',
    bmSwitchLabel: 'Above city median',
    fine: false, overallKey: 'pctDiabetes', hotspotNoun: ['high-diabetes tract', 'high-diabetes tracts'], hotspotTitle: 'Highest diabetes share', missingCaption: 'This pack has no diabetes metric yet',
    tooltip: 'Model-based share of adults with diagnosed diabetes (CDC PLACES). Shown as community-need context alongside canopy.',
    higherIsBetter: false, usesDensityUnit: false, percentPoints: true,
  },
  // #120: ACS 5-year B16004 — % residents 5+ speaking English less than "very well" (Σ36 cells / 001). Default polarity → Hotspots desc.
  lep: {
    id: 'lep',
    shortLabel: 'Limited English',
    valueKey: 'pctLep',
    legendTitle: () => 'Residents 5+ with limited English',
    unitNoun: 'limited-English share',
    spreadUnit: () => '%',
    bmCaption: 'Dims tracts below this city’s median limited-English share',
    bmSwitchLabel: 'Above city median',
    fine: false, overallKey: 'pctLep', hotspotNoun: ['high limited-English tract', 'high limited-English tracts'], hotspotTitle: 'Highest limited-English share', missingCaption: 'This pack has no limited-English metric yet',
    tooltip: 'Share of residents age 5+ who speak English less than ‘very well’',
    higherIsBetter: false, usesDensityUnit: false, percentPoints: true,
  },
  // #121: CDC PLACES 2025 — OBESITY crude prevalence, adults ≥18 (model-based). Default polarity → Hotspots desc.
  obesity: {
    id: 'obesity',
    shortLabel: 'Obesity',
    valueKey: 'pctObesity',
    legendTitle: () => 'Adults with obesity',
    unitNoun: 'obesity share',
    spreadUnit: () => '%',
    bmCaption: 'Dims tracts below this city’s median obesity share',
    bmSwitchLabel: 'Above city median',
    fine: false, overallKey: 'pctObesity', hotspotNoun: ['high-obesity tract', 'high-obesity tracts'], hotspotTitle: 'Highest obesity share', missingCaption: 'This pack has no obesity metric yet',
    tooltip: 'Model-based share of adults with obesity (CDC PLACES). Shown as community-need context alongside canopy.',
    higherIsBetter: false, usesDensityUnit: false, percentPoints: true,
  },
}

/** #115: Hotspots ascending? Per-metric hotspotSort override, else polarity (higherIsBetter → lowest first). */
export function hotspotAscending(def: MetricDef): boolean {
  return def.hotspotSort ? def.hotspotSort === 'asc' : def.higherIsBetter
}

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
/** #103: unitless display — currency metrics → USD no cents, else 1 decimal. */
export function fmtUnitless(def: MetricDef, n: number): string {
  if (def.percentPoints) return `${n.toFixed(1)}%`
  if (def.percent) return `${(n * 100).toFixed(1)}%`
  return def.currency ? USD.format(n) : n.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

export const METRIC_IDS = Object.keys(METRICS) as MetricId[]

const METRIC_BY_LOWER: Record<string, MetricId> = {
  ...Object.fromEntries(METRIC_IDS.map((id) => [id.toLowerCase(), id])),
  // #115 soft aliases
  under18plus: 'under18', children: 'under18',
  // #117 soft alias
  casthma: 'asthma',
  // #120 soft aliases
  limitedenglish: 'lep', english: 'lep',
}

export function isMetricId(v: unknown): v is MetricId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(METRICS, v)
}
/** #118: strict resolver (case-insensitive + aliases); unknown → null. Same table as normalizeMetric. */
export function resolveMetric(v: unknown): MetricId | null {
  if (typeof v !== 'string') return null
  return METRIC_BY_LOWER[v.trim().toLowerCase()] ?? null
}
/** Clamp to a registered id; unknown / missing → trees. */
export function normalizeMetric(v: unknown): MetricId {
  if (typeof v !== 'string') return DEFAULT_METRIC
  // #109: case-insensitive (noVehicle / novehicle, foodAccess / foodaccess)
  return METRIC_BY_LOWER[v.trim().toLowerCase()] ?? DEFAULT_METRIC
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

/** #113: metrics this pack carries, in registry order. */
export function availableMetrics(meta: Meta | null | undefined, tracts: TractCollection | null | undefined): MetricId[] {
  return METRIC_IDS.filter((id) => metricAvailable(id, meta, tracts))
}

/** #113: default dual pair — trees|risk when both available, else first two available. */
export function defaultDualPair(avail: MetricId[]): [MetricId, MetricId] | null {
  if (avail.length < 2) return null
  if (avail.includes('trees') && avail.includes('risk')) return ['trees', 'risk']
  return [avail[0], avail[1]]
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
  if (!def.usesDensityUnit) return fmtUnitless(def, acreValue)
  return km2 ? (acreValue * acresPerKm2).toLocaleString(undefined, { maximumFractionDigits: 2 }) : acreValue.toFixed(4)
}

import { GAP_COLUMNS, gapCells, scenarioProps, type GapTargetMode } from './canopyGap.ts'
/** #139 current-view CSV — pure helpers (no DOM / store / alias value imports so `node --test` can load them).
 * `cell()` lives here and is re-used by every sibling export in exportData.ts. */
import type { Meta, TractProps } from '@/types'
import { METRICS, type MetricDef, type MetricId, type MetricValueKey } from './metrics.ts'
import { placesCitation } from './placesCitation.ts'
import { canopyCitation } from './canopySource.ts'
import { PLACES_MEASURES } from './placesMeasures.ts'

export const CRLF = '\r\n'
/** Same constant as stores/ui (kept local so this module stays store-free). */
const ACRES_PER_KM2 = 1 / 0.0040468564224

/** RFC 4180 cell: quote iff it holds `"` `,` CR or LF; internal quotes doubled. Shared by all exports. */
export const cell = (v: unknown): string => {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** #139 soft formula-injection guard — TEXT cells only (`=` `+` `-` `@` leading → `'` prefix). Numbers never pass here. */
export const textCell = (v: string | null | undefined): string => {
  if (v === null || v === undefined || v === '') return ''
  return cell(/^[=+\-@]/.test(v) ? `'${v}` : v)
}

/** Local YYYY-MM-DD (same as exportFilename). */
export function ymd(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export type DensUnit = 'acre' | 'km2'
export interface ViewRow { cityId: string; cityName?: string; meta?: Meta; props: TractProps }

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const fixed = (n: number | null, dp: number): string => (n === null ? '' : n.toFixed(dp))

/** PLACES CI props (`<valueKey>Lo` / `<valueKey>Hi`, #23 soft cols). */
const CI_KEYS = new Set<MetricValueKey>(['pctAsthma', 'pctDiabetes', 'pctObesity', 'pctMentalHealth', 'pctPhysicalHealth', 'pctChd', 'pctBpHigh', 'pctInactivity', 'pctCopd', 'pctSmoking', 'pctStroke', 'pctDisability', 'pctShortSleep', 'pctUninsured'])
/** ACS MOE props (`<valueKey>Moe`). */
const MOE_KEYS = new Set<MetricValueKey>(['medianIncome', 'pctPoverty', 'pctNoVehicle', 'pctRentBurden', 'pctUnder18', 'pctAge65Plus', 'pctLep', 'pctSnap'])
export const metricHasCi = (id: MetricId) => CI_KEYS.has(METRICS[id].valueKey)
export const metricHasMoe = (id: MetricId) => MOE_KEYS.has(METRICS[id].valueKey)

/** Street-tree density in the UI unit (acre 4 dp; km² 2 dp, treesPerKm2 when present). */
export function mappedStreetTreesCell(t: TractProps, unit: DensUnit): string {
  const acre = num(t.treesPerAcre)
  if (unit === 'km2') return fixed(num(t.treesPerKm2) ?? (acre === null ? null : acre * ACRES_PER_KM2), 2)
  return fixed(acre, 4)
}
export const mappedStreetTreesUnit = (unit: DensUnit) => (unit === 'km2' ? 'trees_per_km2' : 'trees_per_acre')

export function metricUnitToken(def: MetricDef, unit: DensUnit): string {
  if (def.id === 'canopyGap') return 'acres'
  if (def.usesDensityUnit) return def.id === 'trees' ? mappedStreetTreesUnit(unit) : `${def.id}_per_${unit}`
  if (def.percent || def.percentPoints) return '%'
  if (def.currency) return 'USD'
  if (def.id === 'risk') return 'score'
  if (def.id === 'plantNeed') return 'index'
  return 'value'
}

/** Locked number formatting; never locale-grouped. Null / non-finite → empty. */
export function metricValueCell(def: MetricDef, t: TractProps, unit: DensUnit): string {
  if (def.id === 'trees') return mappedStreetTreesCell(t, unit)
  const v = num((t as unknown as Record<string, unknown>)[def.valueKey])
  if (v === null) return ''
  if (def.usesDensityUnit) return unit === 'km2' ? (v * ACRES_PER_KM2).toFixed(2) : v.toFixed(4)
  if (def.percentPoints) return v.toFixed(1)
  if (def.percent) return (v * 100).toFixed(1)
  if (def.currency) return String(Math.round(v))
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}
const auxCell = (def: MetricDef, t: TractProps, suffix: 'Lo' | 'Hi' | 'Moe'): string => {
  const v = num((t as unknown as Record<string, unknown>)[`${def.valueKey}${suffix}`])
  if (v === null) return ''
  return def.currency ? String(Math.round(v)) : v.toFixed(1)
}

export interface CurrentViewOpts {
  gapTarget?: GapTargetMode
  rows: ViewRow[]
  /** length 1 (single / compare) or 2 (dual: left, right) */
  metrics: MetricId[]
  unit: DensUnit
  /** Lines WITHOUT the leading `# `; helper prefixes. */
  comments: string[]
  /** Compare scope: leading city_id, city_name columns. */
  compare?: boolean
}

/** #139: slim current-view CSV. Comment preamble → header → rows; CRLF incl. trailing; UTF-8 no BOM. */
export function toCurrentViewCsv(o: CurrentViewOpts): string {
  const defs = o.metrics.map((id) => METRICS[id])
  const dual = defs.length === 2
  // Dual: CI / MOE slots emitted for BOTH sides when either side needs them (stable header per pair).
  const ci = dual ? defs.some((d) => metricHasCi(d.id)) : metricHasCi(defs[0].id)
  const moe = dual ? defs.some((d) => metricHasMoe(d.id)) : metricHasMoe(defs[0].id)
  const metricCols = (p: string) => [`${p}_id`, `${p}_label`, `${p}_value`, `${p}_unit`, ...(ci ? [`${p}_ci_lo`, `${p}_ci_hi`] : []), ...(moe ? [`${p}_moe`] : [])]
  const header = [
    ...(o.compare ? ['city_id', 'city_name'] : []),
    'geoid', 'tract_name', 'mapped_street_trees', 'mapped_street_trees_unit', 'canopy_pct', ...GAP_COLUMNS,
    ...(dual ? [...metricCols('metric_a'), ...metricCols('metric_b')] : metricCols('metric')),
  ]
  const metricCells = (def: MetricDef, t: TractProps) => [
    cell(def.id), textCell(def.shortLabel), metricValueCell(def, t, o.unit), cell(metricUnitToken(def, o.unit)),
    ...(ci ? [auxCell(def, t, 'Lo'), auxCell(def, t, 'Hi')] : []),
    ...(moe ? [auxCell(def, t, 'Moe')] : []),
  ]
  // Compare: on-screen order — all of city A, then all of city B (first-appearance order); geoid asc within each city.
  const cityOrder = new Map<string, number>()
  for (const r of o.rows) if (!cityOrder.has(r.cityId)) cityOrder.set(r.cityId, cityOrder.size)
  const rows = [...o.rows].sort((a, b) =>
    (o.compare ? cityOrder.get(a.cityId)! - cityOrder.get(b.cityId)! : 0) || String(a.props.geoid).localeCompare(String(b.props.geoid)))
  const lines = [
    ...o.comments.map((c) => `# ${c.replace(/[\r\n]+/g, ' ')}`),
    header.join(','),
    ...rows.map(({ cityId, cityName, props, meta }) => { const t=scenarioProps(props,meta??({} as Meta),o.gapTarget); return [
      ...(o.compare ? [cell(cityId), textCell(cityName ?? '')] : []),
      cell(t.geoid), textCell(t.name ?? ''), mappedStreetTreesCell(t, o.unit), cell(mappedStreetTreesUnit(o.unit)), cell(num(t.canopyPct)), ...gapCells(t).map(cell),
      ...defs.flatMap((d) => metricCells(d, t)),
    ].join(',')}),
  ]
  return lines.join(CRLF) + CRLF
}

/** #140: Designer-locked tooltip for all 3 current-view CSV entries (supplements each entry's aria-label). */
export const CSV_VIEW_TOOLTIP = 'Download the tracts and metrics in this view as a CSV file'

/** `sources:` text resolved from meta only (no hardcoded years). */
export function sourcesLine(meta: Meta, metrics: MetricId[]): string {
  const parts: string[] = []
  parts.push(meta.osmTimestamp ? `OSM trees/parks/roads as of ${meta.osmTimestamp}` : 'OSM trees/parks/roads')
  if (meta.censusVintage) parts.push(`Census ${meta.censusVintage}`)
  const acs = meta.acs ?? meta.acsPoverty ?? meta.acsNoVehicle ?? meta.acsRentBurden ?? meta.acsUnder18 ?? meta.acsAge ?? meta.acsLep ?? meta.acsSnap
  if (acs?.vintage) parts.push(`ACS ${acs.vintage}`)
  const cdc = meta.cdcPlaces
  if (cdc) {
    const years = [...new Set(Object.values(cdc.years ?? {}).filter((y): y is number => typeof y === 'number' && Number.isFinite(y)))].sort()
    parts.push(`CDC PLACES ${cdc.release}${years.length ? ` (BRFSS ${years.join('/')})` : ''}`)
  }
  if (metrics.includes('risk') && meta.nri) parts.push(`FEMA NRI ${meta.nri.version}`)
  if (metrics.includes('foodAccess') && meta.fara) parts.push(`USDA ERS ${meta.fara.version}`)
  return parts.join('; ')
}

/** Per-metric PLACES citation lines (placesCitation, year from meta.cdcPlaces.years). */
export function citationLines(meta: Meta, metrics: MetricId[]): string[] {
  const cdc = meta.cdcPlaces
  const canopyLines = meta.canopy ? [`citation: ${canopyCitation(meta)}`] : []
  if (!cdc) return canopyLines
  return [...metrics.flatMap((id) => {
    const p = PLACES_MEASURES[id]
    if (!p || (cdc.measures && !cdc.measures.includes(p[0]))) return []
    return [`citation: ${placesCitation(p[1], p[2], cdc.years?.[p[0]])}`]
  }), ...canopyLines]
}

export interface PackRef { id: string; meta: Meta }
const metricText = (ids: MetricId[]) => ids.map((id) => `${id} · ${METRICS[id].shortLabel}`).join(' + ')
const packText = (p: PackRef) => [p.id, p.meta.cityName, p.meta.subtitle].filter(Boolean).join(' · ')

/** Preamble lines (without `# `). Compare: 2 packs → two `pack:` lines + per-pack sources. */
export function currentViewComments(packs: PackRef[], metrics: MetricId[], url: string, d = new Date(), mode: GapTargetMode = 'p75'): string[] {
  const multi = packs.length > 1
  return [
    'Street Tree Equity — current-view CSV',
    ...packs.map((p) => `pack: ${packText(p)}`),
    `metric: ${metricText(metrics)}`,
    `generated: ${ymd(d)}`,
    ...packs.map((p) => `sources${multi ? ` (${p.id})` : ''}: ${sourcesLine(p.meta, metrics)}`),
    ...packs.flatMap(p => citationLines(p.meta, metrics).map(line => multi ? `${line} (pack ${p.id})` : line)),
    'canopy_gap: max(0, target canopy percentage - tract canopy percentage) / 100 * canopy sampling land acres; targets compare canopy cover, not planting capacity.',
    "canopy_target_mode: p75 uses this pack's unweighted type-7 75th-percentile tract canopy estimate; 30 uses a fixed 30% comparison. Numerical targets and gaps use unrounded values.",
    'land_acres: estimated non-water support of the canopy calculation, not Census area_acres; missing support is blank, never substituted.',
    'plant_need_canopy: relative low-canopy score (0–100), independent of canopy_gap_pct, canopy_gap_acres and the selected target.',
    ...packs.map(p=>`canopy_target (${p.id}): p75=${p.meta.canopyGap?.p75??'unavailable'}; fixed=30; selected=${mode}`),
    'canopy_pct: % of non-water land; mostly-water and missing estimates are blank, not zero.',
    'schema: canopy_pct is USFS estimated percent canopy over non-water land; mapped_street_trees and mapped_street_trees_unit retain the former canopy/canopy_unit OSM-density values; plant_need_canopy replaces plant_need_trees in full exports.',
    `url: ${url}`,
  ]
}

/** exportFilename scope: view-<id> | view-<left>-<right> | view-compare-<id>. */
export function viewScope(metrics: MetricId[], compare = false): string {
  return compare ? `view-compare-${metrics[0]}` : `view-${metrics.join('-')}`
}

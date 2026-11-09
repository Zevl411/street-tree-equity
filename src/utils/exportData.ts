import { GAP_COLUMNS, gapCells, scenarioProps, type GapTargetMode } from '@/utils/canopyGap'
import { dataUrl } from '@/composables/useData'
import { cityMedian } from '@/utils/densityBins'
import { ACRES_PER_KM2 } from '@/stores/ui'
import type { Meta, TractCollection, TractProps } from '@/types'
// #139: `cell()` moved to the pure currentViewCsv module (unit-testable); same function, re-used here.
import { cell, ymd } from '@/utils/currentViewCsv'
export { CSV_VIEW_TOOLTIP, cell, CRLF, toCurrentViewCsv, currentViewComments, viewScope, metricHasCi, metricHasMoe } from '@/utils/currentViewCsv'

// #23 full CSV (headers + row) lives in the pure fullCsv module (node-testable); re-exported for callers.
export { CSV_HEADERS, fullCsvHeaders, PLACES_EXPORT, csvRow, toCsv } from '@/utils/fullCsv'

export const ODBL_NOTICE =
  'Includes OpenStreetMap-derived values (ODbL). © OSM contributors. Tracts: U.S. Census Bureau.'


export function exportFilename(cityId: string, scope: string, ext: 'csv' | 'geojson', d = new Date()): string {
  return `street-tree-equity_${cityId}_${scope}_${ymd(d)}.${ext}`
}

export function downloadBlob(content: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Same static file the app already loaded (browser-cached); avoids touching App.vue to pass tracts down. */
export async function fetchTracts(dataPath: string): Promise<TractCollection> {
  const res = await fetch(dataUrl('tracts-equity.geojson', dataPath))
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as TractCollection
}

/** GeoJSON with properties trimmed to the CSV fields (nearestParks/centroid dropped). */
export function toGeoJson(fc: TractCollection, meta: Meta, mode: GapTargetMode = 'p75'): string {
  return JSON.stringify({
    type: 'FeatureCollection',
    attribution: ODBL_NOTICE,
    features: fc.features.map((f) => {
      const t = scenarioProps(f.properties,meta,mode)
      return {
        type: 'Feature', geometry: f.geometry,
        properties: {
          geoid: t.geoid, tract_name: t.name, county: t.county, tree_count: t.treeCount,
          trees_per_acre: t.treesPerAcre, trees_per_km2: t.treesPerKm2, area_acres: t.areaAcres, area_km2: t.areaKm2,
          rank: t.rank, percentile: t.percentile, bottom_quartile: t.bottomQuartile, parks_inside: t.parksInside,
          road_km: t.roadKm, low_tree_road_km: t.lowTreeRoadKm, low_tree_road_pct: t.lowTreeRoadPct,
          city_name: meta.cityName, subtitle: meta.subtitle, census_vintage: meta.censusVintage, generated_at: meta.generatedAt,
          parks_per_acre: t.parksPerAcre ?? null, park_area_acres: t.parkAreaAcres ?? null, groceries_per_acre: t.groceriesPerAcre ?? null,
          nri_risk_score: t.nriRiskScore ?? null, nri_risk_rating: t.nriRiskRating ?? null, nri_sovi_score: t.nriSoviScore ?? null, median_income: t.medianIncome ?? null,
          food_access_low_share: t.foodAccessLowShare ?? null, food_access_low_share_1mi: t.foodAccessLowShare1mi ?? null, food_access_lila: t.foodAccessLila ?? null,
          pct_poverty: t.pctPoverty ?? null, pct_poverty_moe: t.pctPovertyMoe ?? null, pct_no_vehicle: t.pctNoVehicle ?? null, pct_no_vehicle_moe: t.pctNoVehicleMoe ?? null, pct_rent_burden: t.pctRentBurden ?? null, pct_rent_burden_moe: t.pctRentBurdenMoe ?? null, pct_severe_rent_burden: t.pctSevereRentBurden ?? null, pct_under_18: t.pctUnder18 ?? null, pct_under_18_moe: t.pctUnder18Moe ?? null, pop_under_18: t.popUnder18 ?? null, pct_age_65_plus: t.pctAge65Plus ?? null, pct_age_65_plus_moe: t.pctAge65PlusMoe ?? null, pop_65_plus: t.pop65Plus ?? null, pct_asthma: t.pctAsthma ?? null, pct_asthma_ci_lo: t.pctAsthmaLo ?? null, pct_asthma_ci_hi: t.pctAsthmaHi ?? null, pct_diabetes: t.pctDiabetes ?? null, pct_diabetes_ci_lo: t.pctDiabetesLo ?? null, pct_diabetes_ci_hi: t.pctDiabetesHi ?? null, pct_obesity: t.pctObesity ?? null, pct_obesity_ci_lo: t.pctObesityLo ?? null, pct_obesity_ci_hi: t.pctObesityHi ?? null, pct_mental_health: t.pctMentalHealth ?? null, pct_mental_health_ci_lo: t.pctMentalHealthLo ?? null, pct_mental_health_ci_hi: t.pctMentalHealthHi ?? null, pct_physical_health: t.pctPhysicalHealth ?? null, pct_physical_health_ci_lo: t.pctPhysicalHealthLo ?? null, pct_physical_health_ci_hi: t.pctPhysicalHealthHi ?? null, pct_chd: t.pctChd ?? null, pct_chd_ci_lo: t.pctChdLo ?? null, pct_chd_ci_hi: t.pctChdHi ?? null, pct_bphigh: t.pctBpHigh ?? null, pct_bphigh_ci_lo: t.pctBpHighLo ?? null, pct_bphigh_ci_hi: t.pctBpHighHi ?? null, pct_inactivity: t.pctInactivity ?? null, pct_inactivity_ci_lo: t.pctInactivityLo ?? null, pct_inactivity_ci_hi: t.pctInactivityHi ?? null, pct_copd: t.pctCopd ?? null, pct_copd_ci_lo: t.pctCopdLo ?? null, pct_copd_ci_hi: t.pctCopdHi ?? null, pct_smoking: t.pctSmoking ?? null, pct_smoking_ci_lo: t.pctSmokingLo ?? null, pct_smoking_ci_hi: t.pctSmokingHi ?? null, pct_stroke: t.pctStroke ?? null, pct_stroke_ci_lo: t.pctStrokeLo ?? null, pct_stroke_ci_hi: t.pctStrokeHi ?? null, pct_disability: t.pctDisability ?? null, pct_disability_ci_lo: t.pctDisabilityLo ?? null, pct_disability_ci_hi: t.pctDisabilityHi ?? null, pct_short_sleep: t.pctShortSleep ?? null, pct_short_sleep_ci_lo: t.pctShortSleepLo ?? null, pct_short_sleep_ci_hi: t.pctShortSleepHi ?? null, pct_uninsured: t.pctUninsured ?? null, pct_uninsured_ci_lo: t.pctUninsuredLo ?? null, pct_uninsured_ci_hi: t.pctUninsuredHi ?? null, pct_depression: t.pctDepression ?? null, pct_depression_ci_lo: t.pctDepressionLo ?? null, pct_depression_ci_hi: t.pctDepressionHi ?? null, pct_general_health: t.pctGeneralHealth ?? null, pct_general_health_ci_lo: t.pctGeneralHealthLo ?? null, pct_general_health_ci_hi: t.pctGeneralHealthHi ?? null, pct_lep: t.pctLep ?? null, pct_lep_moe: t.pctLepMoe ?? null, pop_lep: t.popLep ?? null, pct_snap: t.pctSnap ?? null, pct_snap_moe: t.pctSnapMoe ?? null, hh_snap: t.hhSnap ?? null, plant_need: t.plantNeed ?? null, plant_need_canopy: t.plantNeedParts?.T ?? null, plant_need_poverty: t.plantNeedParts?.P ?? null, plant_need_asthma: t.plantNeedParts?.A ?? null,
          bike_km: t.bikeKm ?? null, transit_stops: t.transitStopsInside ?? null,
          sidewalk_km: t.sidewalkKm ?? null, canopy_pct: t.canopyPct ?? null,
          ...Object.fromEntries(GAP_COLUMNS.map((key,i)=>[key,gapCells(t)[i]])),
        },
      }
    }),
  })
}

/** #64: below-median (<=) CSV in the UI density unit; `flagged` = all finite tracts + below_median column. */
export function toBelowMedianCsv(tracts: TractProps[], cityId: string, unit: 'acre' | 'km2', flagged = false): string | null {
  const median = cityMedian({ type: 'FeatureCollection', features: tracts.map((properties) => ({ properties })) } as unknown as TractCollection)
  if (median === null) return null
  const km2 = unit === 'km2'
  const dens = (t: TractProps) => (km2 ? (Number.isFinite(t.treesPerKm2) ? t.treesPerKm2 : t.treesPerAcre * ACRES_PER_KM2) : t.treesPerAcre)
  const rows = tracts
    .filter((t) => Number.isFinite(t.treesPerAcre) && (flagged || t.treesPerAcre <= median))
    .sort((a, b) => a.treesPerAcre - b.treesPerAcre || String(a.geoid).localeCompare(String(b.geoid)))
  const header = ['geoid', 'city_id', 'density', 'density_unit', 'rank', ...(flagged ? ['below_median'] : [])]
  const lines = rows.map((t) => [
    t.geoid, cityId, dens(t).toFixed(4), km2 ? 'trees_per_km2' : 'trees_per_acre', Number.isFinite(t.rank) ? t.rank : '',
    ...(flagged ? [t.treesPerAcre <= median ? 'true' : 'false'] : []),
  ].map(cell).join(','))
  return [header.join(','), ...lines].join('\r\n') + '\r\n'
}

/** #68: hotspots CSV — exactly the rows passed in (panel's on-screen list, same order). */
export function toHotspotsCsv(tracts: TractProps[], cityId: string, unit: 'acre' | 'km2'): string {
  const km2 = unit === 'km2'
  const dens = (t: TractProps) => (km2 ? (Number.isFinite(t.treesPerKm2) ? t.treesPerKm2 : t.treesPerAcre * ACRES_PER_KM2) : t.treesPerAcre)
  const lines = tracts.map((t) => [
    t.geoid, cityId, dens(t).toFixed(4), km2 ? 'trees_per_km2' : 'trees_per_acre', Number.isFinite(t.rank) ? t.rank : '',
  ].map(cell).join(','))
  return ['geoid,city_id,density,density_unit,rank', ...lines].join('\r\n') + '\r\n'
}

/** #71: favorites CSV — same schema as #68 hotspots; rows = panel's on-screen (pack-joined) list, same order. */
export const toFavoritesCsv = (tracts: TractProps[], cityId: string, unit: 'acre' | 'km2'): string =>
  toHotspotsCsv(tracts, cityId, unit)

/** #78: every pack tract, slim analysis table; rank asc (nullish last), geoid tie-break. */
export function toAllTractsCsv(tracts: TractProps[], cityId: string, unit: 'acre' | 'km2', starredGeoids: Iterable<string>, meta: Meta = {} as Meta, mode: GapTargetMode = 'p75'): string {
  const median = cityMedian({ type: 'FeatureCollection', features: tracts.map((properties) => ({ properties })) } as unknown as TractCollection)
  const km2 = unit === 'km2'
  const starred = new Set(starredGeoids)
  const dens = (t: TractProps) => (km2 ? (Number.isFinite(t.treesPerKm2) ? t.treesPerKm2 : t.treesPerAcre * ACRES_PER_KM2) : t.treesPerAcre)
  const medInUnit = median === null ? null : km2 ? median * ACRES_PER_KM2 : median
  const r = (t: TractProps) => (Number.isFinite(t.rank) ? (t.rank as number) : Infinity)
  const rows = [...tracts].sort((a, b) => r(a) - r(b) || String(a.geoid).localeCompare(String(b.geoid)))
  const lines = rows.map((t) => {
    const ok = Number.isFinite(t.treesPerAcre) && Number.isFinite(dens(t))
    const d = ok ? dens(t) : null
    const delta = d !== null && medInUnit !== null ? d - medInUnit : null
    const pct = ok && median !== null && median !== 0 ? Math.round(((t.treesPerAcre - median) / median) * 100) : null
    const signed = (n: number, s: string) => (n > 0 ? `+${s}` : s)
    return [
      t.geoid, cityId, d === null ? '' : d.toFixed(4), km2 ? 'trees_per_km2' : 'trees_per_acre',
      Number.isFinite(t.rank) ? t.rank : '',
      delta === null ? '' : signed(delta, delta.toFixed(4)),
      pct === null ? '' : signed(pct, String(pct)),
      starred.has(t.geoid) ? 'true' : 'false', ...gapCells(scenarioProps(t,meta,mode)),
    ].map(cell).join(',')
  })
  return [['geoid,city_id,density,density_unit,rank,vs_median,vs_median_pct,favorite', ...GAP_COLUMNS].join(','), ...lines].join('\r\n') + '\r\n'
}

export const PLANT_HERE_HEADERS = ['city_id', 'geoid', 'street_name', 'highway', 'length_m', 'length_mi'] as const

/** #92: every plant-here segment in the loaded roads-lowtree pack; length desc, name asc (blank last), geoid asc. */
export function toPlantHereCsv(
  roads: { features: Array<{ properties?: Record<string, unknown> | null }> },
  cityId: string,
): string {
  const clean = (n: unknown): string => {
    const s = n === null || n === undefined ? '' : String(n).trim()
    return /^(unnamed|null|undefined)$/i.test(s) ? '' : s
  }
  const rows = roads.features.map((f) => {
    const p = f.properties ?? {}
    const len = Number(p.lengthM)
    const ok = Number.isFinite(len)
    return {
      geoid: p.geoid == null ? '' : String(p.geoid),
      name: clean(p.name),
      highway: p.highway == null ? '' : String(p.highway),
      m: ok ? Math.round(len) : null,
      mi: ok ? (len * 0.000621371).toFixed(3) : '',
    }
  })
  rows.sort((a, b) =>
    (b.m ?? -Infinity) - (a.m ?? -Infinity)
    || (a.name === '' ? 1 : 0) - (b.name === '' ? 1 : 0)
    || a.name.localeCompare(b.name)
    || a.geoid.localeCompare(b.geoid))
  const lines = rows.map((r) => [cityId, r.geoid, r.name, r.highway, r.m ?? '', r.mi].map(cell).join(','))
  return [PLANT_HERE_HEADERS.join(','), ...lines].join('\r\n') + '\r\n'
}

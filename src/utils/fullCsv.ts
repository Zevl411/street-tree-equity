import { GAP_COLUMNS, gapCells, scenarioProps, type GapTargetMode } from './canopyGap.ts'
/** #23 full-tract CSV — pure (no DOM / store / alias value imports) so `node --test` can load it.
 * #143 bug fix: headers and row cells for the CDC PLACES triples both derive from PLACES_EXPORT, so they
 * can't drift apart again (row() had dropped bphigh…stroke and shifted every later column left by 15). */
import type { Meta, TractProps } from '@/types'
import { cell } from './currentViewCsv.ts'

type PlacesKey = 'pctGeneralHealth' | 'pctDepression' | 'pctAsthma' | 'pctDiabetes' | 'pctObesity' | 'pctMentalHealth' | 'pctPhysicalHealth' | 'pctChd' | 'pctBpHigh' | 'pctInactivity' | 'pctCopd' | 'pctSmoking' | 'pctStroke' | 'pctDisability' | 'pctShortSleep' | 'pctUninsured'
/** [csv stem, TractProps value key] — invent-append order (NOT switch order); CI props are `<key>Lo` / `<key>Hi`. */
export const PLACES_EXPORT: readonly (readonly [string, PlacesKey])[] = [
  ['asthma', 'pctAsthma'], ['diabetes', 'pctDiabetes'], ['obesity', 'pctObesity'], ['mental_health', 'pctMentalHealth'],
  ['physical_health', 'pctPhysicalHealth'], ['chd', 'pctChd'], ['bphigh', 'pctBpHigh'], ['inactivity', 'pctInactivity'],
  ['copd', 'pctCopd'], ['smoking', 'pctSmoking'], ['stroke', 'pctStroke'], ['disability', 'pctDisability'], ['short_sleep', 'pctShortSleep'], ['uninsured', 'pctUninsured'],
  ['depression', 'pctDepression'], ['general_health', 'pctGeneralHealth'],
]
const placesCells = (t: TractProps) => PLACES_EXPORT.flatMap(([, k]) => [t[k], t[`${k}Lo`], t[`${k}Hi`]])

/** #23 client-side export. Blob download only — no server endpoint. */
export const CSV_HEADERS = [
  'geoid', 'tract_name', 'county', 'tree_count', 'trees_per_acre', 'trees_per_km2', 'area_acres', 'area_km2',
  'rank', 'percentile', 'bottom_quartile', 'parks_inside', 'road_km', 'low_tree_road_km', 'low_tree_road_pct',
  'city_name', 'subtitle', 'census_vintage', 'generated_at',
  // #98 soft: parks metric (appended; trees columns unchanged)
  'parks_per_acre', 'park_area_acres',
  // #99 soft: groceries metric (appended)
  'groceries_per_acre',
  // #100 soft: FEMA NRI (appended)
  'nri_risk_score', 'nri_risk_rating', 'nri_sovi_score', 'median_income',
  // #106 soft: USDA SRAM 2025
  'food_access_low_share', 'food_access_low_share_1mi', 'food_access_lila',
  // #107 soft: ACS B17001
  'pct_poverty', 'pct_poverty_moe',
  // #109 soft: ACS B08201
  'pct_no_vehicle', 'pct_no_vehicle_moe',
  // #111 soft: ACS B25070
  'pct_rent_burden', 'pct_rent_burden_moe', 'pct_severe_rent_burden',
  // #115 soft: ACS B01001
  'pct_under_18', 'pct_under_18_moe', 'pop_under_18', 'pct_age_65_plus', 'pct_age_65_plus_moe', 'pop_65_plus',
  // #117–#143 soft: CDC PLACES value + 95% CI per measure (invent-append order; see PLACES_EXPORT)
  ...PLACES_EXPORT.flatMap(([n]) => [`pct_${n}`, `pct_${n}_ci_lo`, `pct_${n}_ci_hi`]),
  // #120 soft: ACS B16004
  'pct_lep', 'pct_lep_moe', 'pop_lep',
  // #123 soft: ACS B22001
  'pct_snap', 'pct_snap_moe', 'hh_snap', 'plant_need', 'plant_need_canopy', 'plant_need_poverty', 'plant_need_asthma',
  // #104 soft: mobility overlays
  'bike_km', 'transit_stops',
  // #110 soft
  'sidewalk_km', 'canopy_pct', ...GAP_COLUMNS,
]


/** #151: same header array, no second list or builder. */
export function fullCsvHeaders(): readonly string[] { return CSV_HEADERS }

export function csvRow(t: TractProps, meta: Meta, mode: GapTargetMode = 'p75'): string {
  return [
    t.geoid, t.name, t.county, t.treeCount, t.treesPerAcre, t.treesPerKm2, t.areaAcres, t.areaKm2,
    t.rank, t.percentile, t.bottomQuartile, t.parksInside, t.roadKm, t.lowTreeRoadKm, t.lowTreeRoadPct,
    meta.cityName, meta.subtitle, meta.censusVintage, meta.generatedAt,
    t.parksPerAcre, t.parkAreaAcres, t.groceriesPerAcre,
    t.nriRiskScore, t.nriRiskRating, t.nriSoviScore, t.medianIncome,
    t.foodAccessLowShare, t.foodAccessLowShare1mi, t.foodAccessLila, t.pctPoverty, t.pctPovertyMoe, t.pctNoVehicle, t.pctNoVehicleMoe, t.pctRentBurden, t.pctRentBurdenMoe, t.pctSevereRentBurden, t.pctUnder18, t.pctUnder18Moe, t.popUnder18, t.pctAge65Plus, t.pctAge65PlusMoe, t.pop65Plus,
    ...placesCells(t),
    t.pctLep, t.pctLepMoe, t.popLep, t.pctSnap, t.pctSnapMoe, t.hhSnap, t.plantNeed, t.plantNeedParts?.T, t.plantNeedParts?.P, t.plantNeedParts?.A,
    t.bikeKm, t.transitStopsInside,
    t.sidewalkKm, t.canopyPct, ...gapCells(scenarioProps(t,meta,mode)),
  ].map(cell).join(',')
}

/** Header row first (exact Designer order); ODbL notice is shown in the UI, not in the CSV. */
export const toCsv = (tracts: TractProps[], meta: Meta, mode: GapTargetMode = 'p75') =>
  [CSV_HEADERS.join(','), ...tracts.map((t) => csvRow(t, meta, mode))].join('\r\n') + '\r\n'

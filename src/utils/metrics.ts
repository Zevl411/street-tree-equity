import type { Meta, TractCollection } from '@/types'

/** #97/#98: metric registry (trees + parks); unknown ids fall back to canopy. */
export type MetricId = 'canopy' | 'canopyGap' | 'trees' | 'parks' | 'groceries' | 'risk' | 'income' | 'foodAccess' | 'poverty' | 'noVehicle' | 'rentBurden' | 'under18' | 'asthma' | 'diabetes' | 'lep' | 'obesity' | 'snap' | 'plantNeed' | 'mentalHealth' | 'age65' | 'physicalHealth' | 'chd' | 'bphigh' | 'inactivity' | 'copd' | 'smoking' | 'stroke' | 'disability' | 'shortSleep' | 'uninsured' | 'depression'
export type MetricUnit = 'acre' | 'km2'

export type MetricValueKey = 'pctGeneralHealth' | 'pctDepression' | 'canopyPct' | 'canopyGapAcres' | 'treesPerAcre' | 'parksPerAcre' | 'groceriesPerAcre' | 'nriRiskScore' | 'medianIncome' | 'foodAccessLowShare' | 'pctPoverty' | 'pctNoVehicle' | 'pctRentBurden' | 'pctUnder18' | 'pctAsthma' | 'pctDiabetes' | 'pctLep' | 'pctObesity' | 'pctSnap' | 'plantNeed' | 'pctMentalHealth' | 'pctAge65Plus' | 'pctPhysicalHealth' | 'pctChd' | 'pctBpHigh' | 'pctInactivity' | 'pctCopd' | 'pctSmoking' | 'pctStroke' | 'pctDisability' | 'pctShortSleep' | 'pctUninsured'

export interface MetricDef {
  id: MetricId
  /** Layers stub / future switch label */
  shortLabel: string
  label?: string
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

export const DEFAULT_METRIC: MetricId = 'canopy'

export const METRICS: Record<MetricId, MetricDef> = {
  canopy: {
    id: 'canopy', shortLabel: 'Tree canopy', valueKey: 'canopyPct', overallKey: 'canopyPct',
    legendTitle: () => 'Share of land under tree canopy', unitNoun: 'tree-canopy share', spreadUnit: () => '%',
    bmCaption: 'Dims tracts above this city’s median tree-canopy share', bmSwitchLabel: 'Below city median',
    hotspotNoun: ['low-canopy tract', 'low-canopy tracts'], hotspotTitle: 'Lowest tree canopy',
    missingCaption: 'This pack has no tree-canopy estimate yet', higherIsBetter: true,
    usesDensityUnit: false, percentPoints: true, fine: false,
    tooltip: "Share of each tract's land area under tree canopy, excluding open water (USFS/NLCD Tree Canopy Cover, 2025, v2025.6). Satellite-based model estimates from Landsat and Sentinel-2 at 30 m resolution; small or scattered urban canopy can be underestimated. Not a street-tree count or a direct measure of sidewalk shade. Open water is masked using Annual NLCD Land Cover 2025, Collection 1.2, class 11.",
  },
  canopyGap: {
    id: 'canopyGap', label: 'Canopy gap to target', shortLabel: 'Canopy gap (acres)', valueKey: 'canopyGapAcres', overallKey: 'canopyGapAcres',
    legendTitle: () => 'Additional canopy to target (acres)', unitNoun: 'canopy-gap area', spreadUnit: () => 'acres',
    bmCaption: "Dims tracts below this city's median canopy-gap area", bmSwitchLabel: 'Above city median',
    hotspotNoun: ['tract with a canopy gap', 'tracts with canopy gaps'], hotspotTitle: 'Largest canopy gaps',
    missingCaption: 'This pack has no canopy-gap estimate yet', higherIsBetter: false,
    usesDensityUnit: false, percent: false, percentPoints: false, currency: false, fine: false,
    tooltip: "Estimated additional tree-canopy area needed to reach the selected canopy target, in acres. The default target is the 75th-percentile tract canopy estimate in this pack — your city's leafier neighborhoods — or you can choose a fixed 30%. The gap uses non-water canopy-sampling land area; larger tracts can have larger gaps. This is a comparison, not a tree count, planting-space survey or official canopy goal. USFS canopy estimates are modeled at 30 m and can miss small or scattered urban canopy.",
  },
  trees: {
    id: 'trees',
    shortLabel: 'Mapped street trees (OSM)',
    valueKey: 'treesPerAcre',
    legendTitle: (u) => (u === 'km2' ? 'Mapped street trees / km²' : 'Mapped street trees / acre'),
    unitNoun: 'mapped street-tree density',
    spreadUnit: (u) => (u === 'km2' ? 'trees/km²' : 'trees/acre'),
    bmCaption: 'Dims tracts above this city’s median mapped street-tree density',
    bmSwitchLabel: 'Below city median',
    fine: false, overallKey: 'treesPerAcre', hotspotNoun: ['low mapped-tree-density tract', 'low mapped-tree-density tracts'], hotspotTitle: 'Lowest mapped street-tree density', missingCaption: '',
    higherIsBetter: true, usesDensityUnit: true,
    tooltip: 'Counts street trees mapped in OpenStreetMap. Coverage varies by city; zero can mean unmapped, not treeless.',
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
  // #123: ACS 5-year B22001 — % households that received SNAP (002/001). Placed after lep to keep the ACS cluster contiguous.
  snap: {
    id: 'snap',
    shortLabel: 'SNAP households',
    valueKey: 'pctSnap',
    legendTitle: () => 'Households receiving SNAP',
    unitNoun: 'SNAP share',
    spreadUnit: () => '%',
    bmCaption: 'Dims tracts below this city’s median SNAP share',
    bmSwitchLabel: 'Above city median',
    fine: false, overallKey: 'pctSnap', hotspotNoun: ['high-SNAP tract', 'high-SNAP tracts'], hotspotTitle: 'Highest SNAP share', missingCaption: 'This pack has no SNAP metric yet',
    tooltip: 'Share of households that received Food Stamps/SNAP in the past 12 months',
    higherIsBetter: false, usesDensityUnit: false, percentPoints: true,
  },
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
  // #124: build-time 0–100 composite (inverted canopy + poverty + soft asthma; pack min-max, equal weights).
  // Union/registry appended after snap; the Layers switch sits right after Trees via METRIC_SWITCH_ORDER.
  plantNeed: {
    id: 'plantNeed',
    shortLabel: 'Planting need',
    valueKey: 'plantNeed',
    legendTitle: () => 'Planting need score (0–100)',
    unitNoun: 'planting-need score',
    spreadUnit: () => ' pts',
    bmCaption: 'Dims tracts below this city’s median planting need',
    bmSwitchLabel: 'Above city median',
    fine: false, overallKey: 'plantNeed', hotspotNoun: ['high planting-need tract', 'high planting-need tracts'], hotspotTitle: 'Highest planting need', missingCaption: 'This pack has no planting-need score yet',
    tooltip: 'Score 0–100 combining low tree canopy, poverty, and (where available) adult asthma, relative within this city. Higher = more need.',
    higherIsBetter: true, hotspotSort: 'desc', usesDensityUnit: false,
  },
  // #125: CDC PLACES 2025 — MHLTH frequent mental distress, adults ≥18 (model-based). Default polarity → Hotspots desc.
  // Registry appended after plantNeed; Layers switch sits after Obesity (end of PLACES cluster) via METRIC_SWITCH_ORDER.
  mentalHealth: {
    id: 'mentalHealth',
    shortLabel: 'Mental health',
    valueKey: 'pctMentalHealth',
    legendTitle: () => 'Adults with frequent mental distress',
    unitNoun: 'mental-distress share',
    spreadUnit: () => '%',
    bmCaption: 'Dims tracts below this city’s median mental-distress share',
    bmSwitchLabel: 'Above city median',
    fine: false, overallKey: 'pctMentalHealth', hotspotNoun: ['high-distress tract', 'high-distress tracts'], hotspotTitle: 'Highest mental-health share', missingCaption: 'This pack has no mental-health metric yet',
    tooltip: 'Model-based share of adults reporting 14+ days of poor mental health in the past month (CDC PLACES). Shown as community-need context alongside canopy.',
    higherIsBetter: false, usesDensityUnit: false, percentPoints: true,
  },
  // #114: ACS 5-year B01001 — % residents age 65+ (M020–025 + F044–049)/001. Heat-vulnerability framing; higher = worse.
  age65: {
    id: 'age65',
    shortLabel: 'Age 65+',
    valueKey: 'pctAge65Plus',
    legendTitle: () => 'Residents age 65+',
    unitNoun: 'age 65+ share',
    spreadUnit: () => '%',
    bmCaption: 'Dims tracts below this city’s median age 65+ share',
    bmSwitchLabel: 'Above city median',
    fine: false, overallKey: 'pctAge65Plus', hotspotNoun: ['oldest-skewing tract', 'oldest-skewing tracts'], hotspotTitle: 'Highest share 65+', missingCaption: 'This pack has no age 65+ metric yet',
    tooltip: 'Higher share = more heat-vulnerable residents',
    higherIsBetter: false, usesDensityUnit: false, percentPoints: true,
  },
  // #127: CDC PLACES 2025 — PHLTH frequent physical distress, adults ≥18 (model-based). Default polarity → Hotspots desc.
  // Registry appended after mentalHealth; Layers switch sits after Mental health (end of PLACES cluster) via METRIC_SWITCH_ORDER.
  physicalHealth: {
    id: 'physicalHealth',
    shortLabel: 'Physical health',
    valueKey: 'pctPhysicalHealth',
    legendTitle: () => 'Adults with frequent physical distress',
    unitNoun: 'physical-distress share',
    spreadUnit: () => '%',
    bmCaption: 'Dims tracts below this city’s median physical-distress share',
    bmSwitchLabel: 'Above city median',
    fine: false, overallKey: 'pctPhysicalHealth', hotspotNoun: ['high physical-distress tract', 'high physical-distress tracts'], hotspotTitle: 'Highest physical-health share', missingCaption: 'This pack has no physical-health metric yet',
    tooltip: 'Model-based share of adults reporting 14+ days of poor physical health in the past month (CDC PLACES). Community-need context — no causal/diagnostic claim.',
    higherIsBetter: false, usesDensityUnit: false, percentPoints: true,
  },
  // #129: CDC PLACES 2025 — CHD coronary heart disease, adults ≥18 (model-based). Default polarity → Hotspots desc.
  // Registry appended after physicalHealth; Layers switch sits after Physical health (end of PLACES cluster).
  chd: {
    id: 'chd',
    shortLabel: 'Heart disease',
    valueKey: 'pctChd',
    legendTitle: () => 'Adults with coronary heart disease',
    unitNoun: 'heart-disease share',
    spreadUnit: () => '%',
    bmCaption: 'Dims tracts below this city’s median heart-disease share',
    bmSwitchLabel: 'Above city median',
    fine: false, overallKey: 'pctChd', hotspotNoun: ['high heart-disease tract', 'high heart-disease tracts'], hotspotTitle: 'Highest heart-disease share', missingCaption: 'This pack has no heart-disease metric yet',
    tooltip: 'Model-based share of adults ever told they had coronary heart disease or angina (CDC PLACES). Community-need context — no causal/diagnostic claim.',
    higherIsBetter: false, usesDensityUnit: false, percentPoints: true,
  },
  // #131: CDC PLACES 2025 — BPHIGH high blood pressure, adults ≥18 (model-based). Default polarity → Hotspots desc.
  // Registry appended after chd; Layers switch sits after Heart disease (end of PLACES cluster).
  bphigh: {
    id: 'bphigh',
    shortLabel: 'Blood pressure',
    valueKey: 'pctBpHigh',
    legendTitle: () => 'Adults with high blood pressure',
    unitNoun: 'high-blood-pressure share',
    spreadUnit: () => '%',
    bmCaption: 'Dims tracts below this city’s median high-blood-pressure share',
    bmSwitchLabel: 'Above city median',
    fine: false, overallKey: 'pctBpHigh', hotspotNoun: ['high blood-pressure tract', 'high blood-pressure tracts'], hotspotTitle: 'Highest high-blood-pressure share', missingCaption: 'This pack has no blood-pressure metric yet',
    tooltip: 'Model-based share of adults ever told they have high blood pressure (CDC PLACES). Community-need context — no causal/diagnostic claim.',
    higherIsBetter: false, usesDensityUnit: false, percentPoints: true,
  },
  // #133: CDC PLACES 2025 — LPA no leisure-time physical activity, adults ≥18 (model-based). Default polarity → Hotspots desc.
  // Registry appended after bphigh; Layers switch sits after Blood pressure (end of PLACES cluster).
  inactivity: {
    id: 'inactivity',
    shortLabel: 'Inactivity',
    valueKey: 'pctInactivity',
    legendTitle: () => 'Adults with no leisure-time physical activity',
    unitNoun: 'physical-inactivity share',
    spreadUnit: () => '%',
    bmCaption: 'Dims tracts below this city’s median physical-inactivity share',
    bmSwitchLabel: 'Above city median',
    fine: false, overallKey: 'pctInactivity', hotspotNoun: ['high-inactivity tract', 'high-inactivity tracts'], hotspotTitle: 'Highest physical-inactivity share', missingCaption: 'This pack has no physical-activity metric yet',
    tooltip: 'Model-based share of adults reporting no physical activity outside work in the past month (CDC PLACES). Shade and walkable streets are context — no causal claim.',
    higherIsBetter: false, usesDensityUnit: false, percentPoints: true,
  },
  // #136: CDC PLACES 2025 — COPD chronic obstructive pulmonary disease, adults ≥18 (model-based). Default polarity → Hotspots desc.
  // Registry appended after inactivity; Layers switch sits after Inactivity (end of PLACES / health cluster).
  copd: {
    id: 'copd',
    shortLabel: 'COPD',
    valueKey: 'pctCopd',
    legendTitle: () => 'Adults with COPD (chronic obstructive pulmonary disease)',
    unitNoun: 'COPD share',
    spreadUnit: () => '%',
    bmCaption: 'Dims tracts below this city’s median COPD share',
    bmSwitchLabel: 'Above city median',
    fine: false, overallKey: 'pctCopd', hotspotNoun: ['high-COPD tract', 'high-COPD tracts'], hotspotTitle: 'Highest COPD share', missingCaption: 'This pack has no COPD metric yet',
    tooltip: 'Model-based share of adults ever told they have COPD (chronic obstructive pulmonary disease) (CDC PLACES). Community-need context — no causal/diagnostic claim.',
    higherIsBetter: false, usesDensityUnit: false, percentPoints: true,
  },
  // #138: CDC PLACES 2025 — CSMOKING current cigarette smoking, adults ≥18 (model-based). Default polarity → Hotspots desc.
  // Registry appended after copd; Layers switch sits after COPD (end of PLACES / health cluster).
  smoking: {
    id: 'smoking',
    shortLabel: 'Smoking',
    valueKey: 'pctSmoking',
    legendTitle: () => 'Adults who currently smoke cigarettes',
    unitNoun: 'adult smoking share',
    spreadUnit: () => '%',
    bmCaption: 'Dims tracts below this city’s median adult smoking share',
    bmSwitchLabel: 'Above city median',
    fine: false, overallKey: 'pctSmoking', hotspotNoun: ['high-smoking tract', 'high-smoking tracts'], hotspotTitle: 'Highest adult smoking share', missingCaption: 'This pack has no smoking metric yet',
    tooltip: 'Model-based share of adults who currently smoke cigarettes (CDC PLACES). Community-need context — no causal/diagnostic claim.',
    higherIsBetter: false, usesDensityUnit: false, percentPoints: true,
  },
  // #141: CDC PLACES 2025 — STROKE stroke among adults ≥18 (model-based). Default polarity → Hotspots desc.
  // Registry appended after smoking; Layers switch sits after Smoking (end of PLACES / health cluster).
  stroke: {
    id: 'stroke',
    shortLabel: 'Stroke',
    valueKey: 'pctStroke',
    legendTitle: () => 'Adults ever told they had a stroke',
    unitNoun: 'stroke share',
    spreadUnit: () => '%',
    bmCaption: 'Dims tracts below this city’s median stroke share',
    bmSwitchLabel: 'Above city median',
    fine: false, overallKey: 'pctStroke', hotspotNoun: ['high-stroke tract', 'high-stroke tracts'], hotspotTitle: 'Highest stroke share', missingCaption: 'This pack has no stroke metric yet',
    tooltip: 'Model-based share of adults ever told they had a stroke (CDC PLACES). Community-need context — no causal/diagnostic claim.',
    higherIsBetter: false, usesDensityUnit: false, percentPoints: true,
  },
  // #143: CDC PLACES 2025 — DISABILITY any disability, adults ≥18 (model-based). Default polarity → Hotspots desc.
  // Registry appended after stroke; Layers switch sits after Smoking (end of PLACES / health cluster). Person-first, need-framed copy.
  disability: {
    id: 'disability',
    shortLabel: 'Disability',
    valueKey: 'pctDisability',
    legendTitle: () => 'Adults reporting any disability',
    unitNoun: 'disability share',
    spreadUnit: () => '%',
    bmCaption: 'Dims tracts below this city’s median share of adults with a disability',
    bmSwitchLabel: 'Above city median',
    fine: false, overallKey: 'pctDisability', hotspotNoun: ['high-disability-share tract', 'high-disability-share tracts'], hotspotTitle: 'Highest share of adults with a disability', missingCaption: 'This pack has no disability metric yet',
    tooltip: 'Model-based share of adults reporting any disability — hearing, vision, cognition, mobility, self-care, or independent living (CDC PLACES). Higher shares flag greater need for accessible streets, shade, benches, and restrooms. Community-need context — no causal or diagnostic claim.',
    higherIsBetter: false, usesDensityUnit: false, percentPoints: true,
  },
  // #144: CDC PLACES 2025 — SLEEP short sleep duration (<7 h), adults ≥18 (model-based; BRFSS 2022). Default polarity → Hotspots desc.
  // Registry appended after disability; Layers switch sits after Disability (end of PLACES / health cluster). Neutral copy; no shade/heat/noise claim.
  shortSleep: {
    id: 'shortSleep',
    shortLabel: 'Short sleep',
    valueKey: 'pctShortSleep',
    legendTitle: () => 'Adults sleeping under 7 hours',
    unitNoun: 'short-sleep share',
    spreadUnit: () => '%',
    bmCaption: 'Dims tracts below this city’s median share of adults sleeping under 7 hours',
    bmSwitchLabel: 'Above city median',
    fine: false, overallKey: 'pctShortSleep', hotspotNoun: ['high-short-sleep tract', 'high-short-sleep tracts'], hotspotTitle: 'Highest share of adults with short sleep', missingCaption: 'This pack has no short-sleep metric yet',
    tooltip: 'Model-based share of adults who usually sleep under 7 hours in a 24-hour period (CDC PLACES). Short sleep is associated with higher risk of several chronic conditions. Community-need context — no causal or diagnostic claim.',
    higherIsBetter: false, usesDensityUnit: false, percentPoints: true,
  },
  // #146: CDC PLACES 2025 — ACCESS2 lack of health insurance, ages 18–64. Adults 18+ proxy weights.
  // Registry appended after shortSleep; Layers switch after Short sleep. Age range and proxy are explicit in copy.
  uninsured: {
    id: 'uninsured',
    shortLabel: 'No health insurance',
    valueKey: 'pctUninsured',
    legendTitle: () => 'Adults 18–64 with no health insurance',
    unitNoun: 'uninsured share',
    spreadUnit: () => '%',
    bmCaption: 'Dims tracts below this city’s median share of adults 18–64 with no health insurance',
    bmSwitchLabel: 'Above city median',
    fine: false, overallKey: 'pctUninsured', hotspotNoun: ['high-uninsured tract', 'high-uninsured tracts'], hotspotTitle: 'Highest share of adults 18–64 with no health insurance', missingCaption: 'This pack has no uninsured metric yet',
    tooltip: 'Model-based share of adults aged 18–64 with no current health insurance (CDC PLACES). Higher shares flag greater need for accessible care and community health resources. Prevalence is ages 18–64; city aggregates are weighted by adults 18+ (PLACES TotalPop18plus — no 18–64 denominator in the GIS file). Community-need context — no causal or diagnostic claim.',
    higherIsBetter: false, usesDensityUnit: false, percentPoints: true,
  },
  // #150: CDC PLACES lifetime professional-diagnosis history, not current symptoms or MHLTH.
  depression: {
    id: 'depression', label: 'Depression history (adults)', shortLabel: 'Depression history',
    valueKey: 'pctDepression', overallKey: 'pctDepression',
    legendTitle: () => 'Adults ever told they had a depressive disorder',
    unitNoun: 'depression-history share', spreadUnit: () => '%',
    bmCaption: 'Dims tracts below this city’s median share of adults ever told they had a depressive disorder',
    bmSwitchLabel: 'Above city median', fine: false,
    hotspotNoun: ['tract with a higher reported depression-history share', 'tracts with higher reported depression-history shares'],
    hotspotTitle: 'Highest share reporting a depression history',
    missingCaption: 'This pack has no depression-history estimate yet',
    tooltip: 'Model-based share of adults aged 18+ who report ever being told by a doctor, nurse, or other health professional that they had a depressive disorder, including depression, major depression, dysthymia, or minor depression (CDC PLACES). This is a lifetime history measure, not necessarily current depression; it does not measure severity or duration. Mental health (MHLTH) instead measures 14 or more days of poor mental health in the past 30 days. Community-need context — no causal or diagnostic claim.',
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
  if (def.id === 'canopyGap' && n > 0 && n < 0.05) return '<0.1'
  if (def.id === 'canopy' && n > 0 && n < 0.05) return '<0.1%'
  if (def.percentPoints) return `${n.toFixed(1)}%`
  if (def.percent) return `${(n * 100).toFixed(1)}%`
  return def.currency ? USD.format(n) : n.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

export const METRIC_IDS = Object.keys(METRICS) as MetricId[]
/** #124 Planting need after Trees; #125 Mental health after Obesity; #150 Depression history after Mental health; #127 Physical health after Depression history; #143 cardio reorder: #131 Blood pressure after Physical health; #129 Heart disease after Blood pressure; #141 Stroke after Heart disease; #133 Inactivity after Stroke; #136 COPD after Inactivity; #138 Smoking after COPD; #143 Disability after Smoking; #144 Short sleep after Disability; #146 Uninsured (ACCESS2) after Short sleep; rest in registry order. */
/** #114: Age 65+ right after Rent burden, with Under 18 moved directly after Age 65+. */
const BASE_SWITCH_ORDER: MetricId[] = ['canopy', 'canopyGap', 'trees', 'plantNeed', ...METRIC_IDS.filter((id) => id !== 'canopy' && id !== 'canopyGap' && id !== 'trees' && id !== 'plantNeed' && id !== 'mentalHealth' && id !== 'depression' && id !== 'physicalHealth' && id !== 'chd' && id !== 'bphigh' && id !== 'inactivity' && id !== 'copd' && id !== 'smoking' && id !== 'stroke' && id !== 'disability' && id !== 'shortSleep' && id !== 'uninsured' && id !== 'age65' && id !== 'under18')
  .flatMap((id): MetricId[] => (id === 'obesity' ? ['obesity', 'mentalHealth', 'depression', 'physicalHealth', 'bphigh', 'chd', 'stroke', 'inactivity', 'copd', 'smoking', 'disability', 'shortSleep', 'uninsured'] : [id]))]
const RB = BASE_SWITCH_ORDER.indexOf('rentBurden')
export const METRIC_SWITCH_ORDER: MetricId[] = [...BASE_SWITCH_ORDER.slice(0, RB + 1), 'age65', 'under18', ...BASE_SWITCH_ORDER.slice(RB + 1)]

const METRIC_BY_LOWER: Record<string, MetricId> = {
  ...Object.fromEntries(METRIC_IDS.map((id) => [id.toLowerCase(), id])),
  'canopy gap': 'canopyGap', 'canopy deficit': 'canopyGap', 'tree canopy gap': 'canopyGap',
  'tree canopy': 'canopy', tcc: 'canopy', shade: 'canopy',
  // #115 soft aliases
  under18plus: 'under18', children: 'under18',
  // #117 soft alias
  casthma: 'asthma',
  // #120 soft aliases
  limitedenglish: 'lep', english: 'lep',
  // #123 soft aliases
  foodstamps: 'snap', pctsnap: 'snap',
  // #124 soft alias (plantneed comes from the lowercase id)
  need: 'plantNeed',
  // #125 soft aliases (mentalhealth comes from the lowercase id)
  mhlth: 'mentalHealth', mental: 'mentalHealth',
  // #127 soft aliases (physicalhealth comes from the lowercase id)
  phlth: 'physicalHealth', physical: 'physicalHealth',
  // #129 soft alias (chd comes from the lowercase id)
  heart: 'chd',
  // #131 soft aliases (bphigh comes from the lowercase id)
  bp: 'bphigh', hypertension: 'bphigh',
  // #133 soft aliases (inactivity comes from the lowercase id)
  lpa: 'inactivity', activity: 'inactivity',
  // #136 soft aliases (copd comes from the lowercase id)
  lung: 'copd',
  // #138 soft aliases (smoking comes from the lowercase id)
  tobacco: 'smoking', cigarettes: 'smoking',
  // #141 soft aliases (stroke comes from the lowercase id)
  cerebrovascular: 'stroke',
  // #114 soft aliases
  age65plus: 'age65', seniors: 'age65',
  // #144 soft aliases (shortsleep comes from the lowercase id; first multi-word alias — exact trim+lowercase match)
  sleep: 'shortSleep', 'short sleep': 'shortSleep',
  // #146 soft aliases (uninsured comes from the lowercase id); no vague access/healthcare alias.
  insurance: 'uninsured', noinsurance: 'uninsured', 'no insurance': 'uninsured', access2: 'uninsured',
  // #150: lifetime-history aliases; never reinterpret depressed or existing MHLTH links.
  depressive: 'depression', 'depressive disorder': 'depression',
}

export function isMetricId(v: unknown): v is MetricId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(METRICS, v)
}
/** #118: strict resolver (case-insensitive + aliases); unknown → null. Same table as normalizeMetric. */
export function resolveMetric(v: unknown): MetricId | null {
  if (typeof v !== 'string') return null
  return METRIC_BY_LOWER[v.trim().toLowerCase()] ?? null
}
/** Clamp to a registered id; unknown / missing → canopy. */
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
  if (id === 'canopyGap') {
    const ramp=['#d9f0a3','#addd8e','#78c679','#31a354','#006837'], n=breaks.length+1
    return {...meta,breaks,colors:Array.from({length:n},(_,i)=>ramp[n<=1?0:Math.round(i*4/(n-1))])}
  }
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

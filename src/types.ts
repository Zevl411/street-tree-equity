import type { Feature, FeatureCollection, Geometry } from 'geojson'

export interface NearbyPark {
  id: number
  name: string
  areaAcres: number
  distanceKm: number
  /** Park centroid falls inside the tract polygon. */
  inside?: boolean
}

export interface TractProps {
  geoid: string
  name: string
  county: string
  treeCount: number
  areaAcres: number
  areaKm2: number
  treesPerAcre: number
  treesPerKm2: number
  parksInside: number
  /** #98 park|playground centroid count per acre / km²; sum of their acres */
  parksPerAcre?: number
  parksPerKm2?: number
  parkAreaAcres?: number
  /** #99 supermarket|greengrocer point count in tract; per acre / km²; nearest km (soft) */
  groceriesInside?: number
  groceriesPerAcre?: number
  groceriesPerKm2?: number
  /** #102: OSM amenity=school join (overlay + Hotspots count; not a MetricId). */
  schoolsInside?: number
  schoolsPerAcre?: number
  schoolsPerKm2?: number
  nearestSchoolKm?: number
  /** #100 FEMA NRI (tract join) */
  nriRiskScore?: number
  nriRiskRating?: string
  /** #103: ACS B19013 median household income (USD) + MOE */
  medianIncome?: number
  medianIncomeMoe?: number
  /** #106 USDA ERS SRAM 2025 (Euclidean): ½-mi + 1-mi low-access population share 0–1; LILA ½/10 + low-income flags 0|1 */
  foodAccessLowShare?: number
  foodAccessLowShare1mi?: number
  foodAccessLila?: number
  foodAccessLowIncome?: number
  /** #107: ACS B17001 % below poverty (0–100, 1 dp) + derived MOE */
  pctPoverty?: number
  pctPovertyMoe?: number
  /** #109: ACS B08201 % households with no vehicle (0–100, 1 dp) + derived MOE */
  pctNoVehicle?: number
  pctNoVehicleMoe?: number
  /** #111: ACS B25070 % renters paying ≥30% of income (0–100, 1 dp) + derived MOE, severe ≥50%, renter base n */
  pctRentBurden?: number
  pctRentBurdenMoe?: number
  pctSevereRentBurden?: number
  rentBurdenBase?: number
  /** #115: ACS B01001 % residents under 18 (0–100, 1 dp) + derived MOE, count, % under 5 */
  pctUnder18?: number
  pctUnder18Moe?: number
  popUnder18?: number
  pctUnder5?: number
  /** #114: ACS B01001 % residents age 65+ (0–100, 1 dp) + derived MOE, count, % 75+ */
  pctAge65Plus?: number
  pctAge65PlusMoe?: number
  pop65Plus?: number
  pctAge75Plus?: number
  /** #117: CDC PLACES 2025 CASTHMA crude prevalence (0–100, 1 dp) + 95% CI + adult pop weight */
  pctAsthma?: number
  pctAsthmaLo?: number
  pctAsthmaHi?: number
  asthmaAdultPop?: number
  /** #119: CDC PLACES 2025 DIABETES crude prevalence (0–100, 1 dp) + 95% CI + adult pop weight */
  pctDiabetes?: number
  pctDiabetesLo?: number
  pctDiabetesHi?: number
  /** #121: CDC PLACES 2025 OBESITY crude prevalence (0–100, 1 dp) + 95% CI + adult pop weight */
  pctObesity?: number
  pctObesityLo?: number
  pctObesityHi?: number
  obesityAdultPop?: number
  /** #125: CDC PLACES 2025 MHLTH crude prevalence (frequent mental distress, 0–100, 1 dp) + 95% CI + adult pop weight */
  pctMentalHealth?: number
  pctMentalHealthLo?: number
  pctMentalHealthHi?: number
  mentalHealthAdultPop?: number
  /** #127: CDC PLACES 2025 PHLTH crude prevalence (frequent physical distress, 0–100, 1 dp) + 95% CI + adult pop weight */
  pctPhysicalHealth?: number
  pctPhysicalHealthLo?: number
  pctPhysicalHealthHi?: number
  physicalHealthAdultPop?: number
  /** #129: CDC PLACES 2025 CHD crude prevalence (coronary heart disease, 0–100, 1 dp) + 95% CI + adult pop weight */
  pctChd?: number
  pctChdLo?: number
  pctChdHi?: number
  chdAdultPop?: number
  /** #131: CDC PLACES 2025 BPHIGH crude prevalence (high blood pressure, 0–100, 1 dp) + 95% CI + adult pop weight */
  pctBpHigh?: number
  pctBpHighLo?: number
  pctBpHighHi?: number
  bpHighAdultPop?: number
  /** #120: ACS B16004 % residents 5+ speaking English less than "very well" (0–100, 1 dp) + derived MOE, count */
  pctLep?: number
  pctLepMoe?: number
  popLep?: number
  /** #123: ACS B22001 % households that received SNAP (0–100, 1 dp) + derived MOE, household count */
  pctSnap?: number
  pctSnapMoe?: number
  hhSnap?: number
  /** #124: 0–100 planting-need composite (pack min-max; equal weights) + rescaled parts */
  plantNeed?: number
  plantNeedParts?: { T: number; P: number; A?: number }
  diabetesAdultPop?: number
  nriSoviScore?: number
  nriEalScore?: number
  nearestGroceryKm?: number
  /** #104 OSM bike network km in tract (segment-midpoint clip), per km²; transit stops inside; nearest stop km */
  bikeKm?: number
  /** #110 OSM mapped sidewalk km in tract (length rule in scripts/lib/sidewalks.mjs), per ALAND km² */
  sidewalkKm?: number
  sidewalkKmPerKm2?: number
  bikeKmPerKm2?: number
  transitStopsInside?: number
  nearestTransitKm?: number
  /** #108 OSM amenity=library / community_centre join (overlay + Hotspots count; not a MetricId) */
  librariesInside?: number
  communityCentresInside?: number
  civicInside?: number
  nearestLibraryKm?: number
  /** #122 OSM leisure=garden / allotments join (overlay + Hotspots count; not a MetricId) */
  gardensInside?: number
  allotmentsInside?: number
  greenGrowInside?: number
  nearestGardenKm?: number
  /** #126 OSM amenity=drinking_water join (overlay + Hotspots count; not a MetricId) */
  fountainsInside?: number
  nearestFountainKm?: number
  /** #128 OSM amenity=post_office join (overlay + Hotspots count; not a MetricId) */
  postOfficesInside?: number
  nearestPostOfficeKm?: number
  /** #130 OSM leisure=playground join (overlay + Hotspots count; not a MetricId) */
  playgroundsInside?: number
  nearestPlaygroundKm?: number
  /** #112 OSM amenity=pharmacy / clinic / doctors join (overlay + Hotspots count; not a MetricId) */
  pharmaciesInside?: number
  clinicsInside?: number
  healthInside?: number
  nearestPharmacyKm?: number
  /** #116 OSM amenity=hospital / fire_station join (overlay + Hotspots count; not a MetricId) */
  hospitalsInside?: number
  fireStationsInside?: number
  emergencyInside?: number
  nearestHospitalKm?: number
  nearestParks: NearbyPark[]
  roadKm: number | null
  lowTreeRoadKm: number | null
  lowTreeRoadPct: number | null
  centroid: [number, number]
  rank: number
  percentile: number
  bottomQuartile: boolean
}

export interface ParkProps {
  id: number
  osmId: string
  name: string
  areaAcres: number
  leisure?: 'park' | 'playground'
  lon: number
  lat: number
}

export interface Meta {
  /** Optional pack format version (UI prefers it over cities.json version). */
  version?: number | string
  cityName: string
  subtitle: string
  bbox: [number, number, number, number]
  dataBbox: [number, number, number, number]
  generatedAt: string
  osmTimestamp: string | null
  censusVintage: string
  counts: { tracts: number; trees: number; parks: number; groceries?: number; schools?: number; bikeKm?: number; transitStops?: number; libraries?: number; communityCentres?: number; gardens?: number; allotments?: number; fountains?: number; postOffices?: number; playgrounds?: number; pharmacies?: number; clinics?: number; hospitals?: number; fireStations?: number; sidewalkKm?: number; lowTreeRoadSegments: number }
  overall: { treesPerAcre: number; parksPerAcre?: number; groceriesPerAcre?: number; schoolsPerAcre?: number; nriRiskScore?: number | null; medianIncome?: number | null; foodAccessLowShare?: number | null; pctPoverty?: number | null; pctPovertyMedian?: number | null; pctNoVehicle?: number | null; pctNoVehicleMedian?: number | null; pctRentBurden?: number | null; pctRentBurdenMedian?: number | null; pctUnder18?: number | null; pctUnder18Median?: number | null; pctAge65Plus?: number | null; pctAge65PlusMedian?: number | null; pctAsthma?: number | null; pctAsthmaMedian?: number | null; pctDiabetes?: number | null; pctDiabetesMedian?: number | null; pctObesity?: number | null; pctObesityMedian?: number | null; pctMentalHealth?: number | null; pctMentalHealthMedian?: number | null; pctPhysicalHealth?: number | null; pctPhysicalHealthMedian?: number | null; pctChd?: number | null; pctChdMedian?: number | null; pctBpHigh?: number | null; pctBpHighMedian?: number | null; pctLep?: number | null; pctLepMedian?: number | null; pctSnap?: number | null; pctSnapMedian?: number | null; plantNeed?: number | null; bottomQuartileMax: number }
  breaks: number[]
  /** #98: per-metric breaks (trees stay in `breaks`) */
  metricBreaks?: { parks?: number[]; groceries?: number[]; risk?: number[]; income?: number[]; foodAccess?: number[]; poverty?: number[]; noVehicle?: number[]; rentBurden?: number[]; under18?: number[]; age65?: number[]; asthma?: number[]; diabetes?: number[]; obesity?: number[]; mentalHealth?: number[]; physicalHealth?: number[]; chd?: number[]; bphigh?: number[]; lep?: number[]; snap?: number[]; plantNeed?: number[] }
  /** #100: FEMA NRI provenance for About */
  nri?: { version: string; retrievedAt: string; sourceUrl: string }
  /** #106 USDA ERS SRAM provenance */
  fara?: { version: string; updated: string; retrievedAt: string; sourceUrl: string; columns?: Record<string, string> }
  /** #103 ACS provenance */
  acs?: { table: string; vintage: string; retrievedAt: string; sourceUrl: string }
  /** #107 ACS B17001 provenance (same vintage as acs) */
  acsPoverty?: { table: string; vintage: string; retrievedAt: string; sourceUrl: string }
  /** #109 ACS B08201 provenance (same vintage as acs) */
  acsNoVehicle?: { table: string; vintage: string; retrievedAt: string; sourceUrl: string }
  /** #111 ACS B25070 provenance (same vintage as acs) */
  acsRentBurden?: { table: string; vintage: string; retrievedAt: string; sourceUrl: string }
  /** #115 ACS B01001 provenance (same vintage as acs) */
  acsUnder18?: { table: string; vintage: string; retrievedAt: string; sourceUrl: string }
  acsAge?: { table: string; vintage: string; retrievedAt: string; sourceUrl: string }
  acsLep?: { table: string; vintage: string; retrievedAt: string; sourceUrl: string }
  acsSnap?: { table: string; vintage: string; retrievedAt: string; sourceUrl: string }
  /** #124 planting-need composite provenance */
  plantNeed?: { inputs: string[]; weights: 'equal'; scaling: 'pack min-max'; asthmaIncluded: boolean }
  /** #117 CDC PLACES provenance */
  cdcPlaces?: { release: string; measure: string; measures?: string[]; dataYear: number; valueType: string; retrievedAt: string; sourceUrl: string; columns: Record<string, string> }
  colors: string[]
  roadsBufferMeters: number | null
  attribution: { osm: string; census: string; fema?: string; acs?: string; usda?: string; acsPoverty?: string; acsNoVehicle?: string; acsRentBurden?: string; acsUnder18?: string; acsAge?: string; acsLep?: string; acsSnap?: string; cdcPlaces?: string }
}

export type TractFeature = Feature<Geometry, TractProps>
export type TractCollection = FeatureCollection<Geometry, TractProps>
export type ParkCollection = FeatureCollection<Geometry, ParkProps>

/** A packaged city listed in public/cities.json. Its files live under `${BASE_URL}${dataPath}/`. */
export interface CityEntry {
  id: string
  cityName: string
  subtitle?: string
  dataPath: string
  /** [west, south, east, north]; optional for coming-soon packs. */
  bbox?: [number, number, number, number]
  /** Omit or 'ready' = selectable; 'coming-soon' = listed but disabled (no data loaded). */
  status?: 'ready' | 'coming-soon'
}

export const isReady = (c: Pick<CityEntry, 'status'>): boolean => c.status !== 'coming-soon'
export interface CityManifest {
  version: number
  cities: CityEntry[]
}

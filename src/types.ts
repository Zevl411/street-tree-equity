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
  /** #120: ACS B16004 % residents 5+ speaking English less than "very well" (0–100, 1 dp) + derived MOE, count */
  pctLep?: number
  pctLepMoe?: number
  popLep?: number
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
  counts: { tracts: number; trees: number; parks: number; groceries?: number; schools?: number; bikeKm?: number; transitStops?: number; libraries?: number; communityCentres?: number; sidewalkKm?: number; lowTreeRoadSegments: number }
  overall: { treesPerAcre: number; parksPerAcre?: number; groceriesPerAcre?: number; schoolsPerAcre?: number; nriRiskScore?: number | null; medianIncome?: number | null; foodAccessLowShare?: number | null; pctPoverty?: number | null; pctPovertyMedian?: number | null; pctNoVehicle?: number | null; pctNoVehicleMedian?: number | null; pctRentBurden?: number | null; pctRentBurdenMedian?: number | null; pctUnder18?: number | null; pctUnder18Median?: number | null; pctAsthma?: number | null; pctAsthmaMedian?: number | null; pctDiabetes?: number | null; pctDiabetesMedian?: number | null; pctObesity?: number | null; pctObesityMedian?: number | null; pctLep?: number | null; pctLepMedian?: number | null; bottomQuartileMax: number }
  breaks: number[]
  /** #98: per-metric breaks (trees stay in `breaks`) */
  metricBreaks?: { parks?: number[]; groceries?: number[]; risk?: number[]; income?: number[]; foodAccess?: number[]; poverty?: number[]; noVehicle?: number[]; rentBurden?: number[]; under18?: number[]; asthma?: number[]; diabetes?: number[]; obesity?: number[]; lep?: number[] }
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
  acsLep?: { table: string; vintage: string; retrievedAt: string; sourceUrl: string }
  /** #117 CDC PLACES provenance */
  cdcPlaces?: { release: string; measure: string; measures?: string[]; dataYear: number; valueType: string; retrievedAt: string; sourceUrl: string; columns: Record<string, string> }
  colors: string[]
  roadsBufferMeters: number | null
  attribution: { osm: string; census: string; fema?: string; acs?: string; usda?: string; acsPoverty?: string; acsNoVehicle?: string; acsRentBurden?: string; acsUnder18?: string; acsLep?: string; cdcPlaces?: string }
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

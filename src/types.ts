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
  /** #100 FEMA NRI (tract join) */
  nriRiskScore?: number
  nriRiskRating?: string
  nriSoviScore?: number
  nriEalScore?: number
  nearestGroceryKm?: number
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
  counts: { tracts: number; trees: number; parks: number; groceries?: number; lowTreeRoadSegments: number }
  overall: { treesPerAcre: number; parksPerAcre?: number; groceriesPerAcre?: number; nriRiskScore?: number | null; bottomQuartileMax: number }
  breaks: number[]
  /** #98: per-metric breaks (trees stay in `breaks`) */
  metricBreaks?: { parks?: number[]; groceries?: number[]; risk?: number[] }
  /** #100: FEMA NRI provenance for About */
  nri?: { version: string; retrievedAt: string; sourceUrl: string }
  colors: string[]
  roadsBufferMeters: number | null
  attribution: { osm: string; census: string; fema?: string }
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

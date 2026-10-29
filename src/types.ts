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
  lon: number
  lat: number
}

export interface Meta {
  cityName: string
  subtitle: string
  bbox: [number, number, number, number]
  dataBbox: [number, number, number, number]
  generatedAt: string
  osmTimestamp: string | null
  censusVintage: string
  counts: { tracts: number; trees: number; parks: number; lowTreeRoadSegments: number }
  overall: { treesPerAcre: number; bottomQuartileMax: number }
  breaks: number[]
  colors: string[]
  roadsBufferMeters: number | null
  attribution: { osm: string; census: string }
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
  /** [west, south, east, north] */
  bbox: [number, number, number, number]
}
export interface CityManifest {
  version: number
  cities: CityEntry[]
}
/** A Nominatim search hit (subset of fields we use). */
export interface PlaceResult {
  place_id: number
  display_name: string
  lat: string
  lon: string
}

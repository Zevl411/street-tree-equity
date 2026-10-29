import { dataUrl } from '@/composables/useData'
import type { Meta, TractCollection, TractProps } from '@/types'

/** #23 client-side export. Blob download only — no server endpoint. */
export const CSV_HEADERS = [
  'geoid', 'tract_name', 'county', 'tree_count', 'trees_per_acre', 'trees_per_km2', 'area_acres', 'area_km2',
  'rank', 'percentile', 'bottom_quartile', 'parks_inside', 'road_km', 'low_tree_road_km', 'low_tree_road_pct',
  'city_name', 'subtitle', 'census_vintage', 'generated_at',
] as const

export const ODBL_NOTICE =
  'Includes OpenStreetMap-derived values (ODbL). © OSM contributors. Tracts: U.S. Census Bureau.'

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function row(t: TractProps, meta: Meta): string {
  return [
    t.geoid, t.name, t.county, t.treeCount, t.treesPerAcre, t.treesPerKm2, t.areaAcres, t.areaKm2,
    t.rank, t.percentile, t.bottomQuartile, t.parksInside, t.roadKm, t.lowTreeRoadKm, t.lowTreeRoadPct,
    meta.cityName, meta.subtitle, meta.censusVintage, meta.generatedAt,
  ].map(cell).join(',')
}

/** Header row first (exact Designer order); ODbL notice is shown in the UI, not in the CSV. */
export const toCsv = (tracts: TractProps[], meta: Meta) =>
  [CSV_HEADERS.join(','), ...tracts.map((t) => row(t, meta))].join('\r\n') + '\r\n'

export function exportFilename(cityId: string, scope: string, ext: 'csv' | 'geojson', d = new Date()): string {
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return `street-tree-equity_${cityId}_${scope}_${ymd}.${ext}`
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
export function toGeoJson(fc: TractCollection, meta: Meta): string {
  return JSON.stringify({
    type: 'FeatureCollection',
    attribution: ODBL_NOTICE,
    features: fc.features.map((f) => {
      const t = f.properties
      return {
        type: 'Feature', geometry: f.geometry,
        properties: {
          geoid: t.geoid, tract_name: t.name, county: t.county, tree_count: t.treeCount,
          trees_per_acre: t.treesPerAcre, trees_per_km2: t.treesPerKm2, area_acres: t.areaAcres, area_km2: t.areaKm2,
          rank: t.rank, percentile: t.percentile, bottom_quartile: t.bottomQuartile, parks_inside: t.parksInside,
          road_km: t.roadKm, low_tree_road_km: t.lowTreeRoadKm, low_tree_road_pct: t.lowTreeRoadPct,
          city_name: meta.cityName, subtitle: meta.subtitle, census_vintage: meta.censusVintage, generated_at: meta.generatedAt,
        },
      }
    }),
  })
}

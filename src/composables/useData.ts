import { ref } from 'vue'
import type { FeatureCollection } from 'geojson'
import type { CityManifest, Meta, ParkCollection, TractCollection } from '@/types'

// All data is static JSON shipped with the site. BASE_URL makes it work at "/" (dev, Express)
// and at "/street-tree-equity/" (GitHub Pages project site). Each city in public/cities.json
// has a dataPath (Portland: "data", i.e. public/data/).
export const dataUrl = (file: string, dataPath = 'data') => `${import.meta.env.BASE_URL}${dataPath}/${file}`

async function getJson<T>(url: string, label: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load ${label}: HTTP ${res.status}`)
  return (await res.json()) as T
}

export const loadCities = () => getJson<CityManifest>(`${import.meta.env.BASE_URL}cities.json`, 'cities.json')

export function useData() {
  const meta = ref<Meta | null>(null)
  const tracts = ref<TractCollection | null>(null)
  const parks = ref<ParkCollection | null>(null)
  const roads = ref<FeatureCollection | null>(null)
  const loading = ref(true)
  const error = ref<string | null>(null)

  async function load(dataPath = 'data') {
    loading.value = true
    error.value = null
    const get = <T>(f: string) => getJson<T>(dataUrl(f, dataPath), f)
    try {
      const [m, t, p, r] = await Promise.all([
        get<Meta>('meta.json'),
        get<TractCollection>('tracts-equity.geojson'),
        get<ParkCollection>('parks.geojson'),
        get<FeatureCollection>('roads-lowtree.geojson').catch(() => null),
      ])
      meta.value = m
      tracts.value = t
      parks.value = p
      roads.value = r
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  return { meta, tracts, parks, roads, loading, error, load }
}

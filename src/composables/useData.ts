import { ref, shallowRef } from 'vue'
import type { FeatureCollection } from 'geojson'
import { saveLastPack } from '@/utils/offlinePack'
import type { CityManifest, Meta, ParkCollection, TractCollection } from '@/types'

// All data is static JSON shipped with the site. BASE_URL makes it work at "/" (dev, Express)
// and at "/street-tree-equity/" (GitHub Pages project site). Each city in public/cities.json
// has a dataPath (Portland: "data", i.e. public/data/).
export const dataUrl = (file: string, dataPath = 'data') => `${import.meta.env.BASE_URL}${dataPath}/${file}`

async function getJson<T>(url: string, label: string, signal?: AbortSignal, keep?: Response[]): Promise<T> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Failed to load ${label}: HTTP ${res.status}`)
  keep?.push(res.clone())
  return (await res.json()) as T
}

export const loadCities = () => getJson<CityManifest>(`${import.meta.env.BASE_URL}cities.json`, 'cities.json')

export function useData() {
  const meta = ref<Meta | null>(null)
  const tracts = ref<TractCollection | null>(null)
  const parks = ref<ParkCollection | null>(null)
  const roads = ref<FeatureCollection | null>(null)
  // #51: static pack tree points (optional). shallowRef — can be large; never deep-reactive / Pinia.
  const trees = shallowRef<FeatureCollection | null>(null)
  const loading = ref(true)
  const error = ref<string | null>(null)

  // #61: one controller per load(); a newer load aborts the older so only the latest sets refs/error.
  let controller: AbortController | null = null

  function clearPack() {
    meta.value = null
    tracts.value = null
    parks.value = null
    roads.value = null
    trees.value = null
  }

  /** Resolves true when this load won and succeeded. */
  async function load(dataPath = 'data'): Promise<boolean> {
    controller?.abort()
    const ctl = new AbortController()
    controller = ctl
    const { signal } = ctl
    loading.value = true
    error.value = null
    // Clear the previous city's pack so MapView unmounts (no wrong-city map while loading).
    clearPack()
    const kept: Response[] = []
    const get = <T>(f: string) => getJson<T>(dataUrl(f, dataPath), f, signal, kept)
    try {
      const [m, t, p, r, tr] = await Promise.all([
        get<Meta>('meta.json'),
        get<TractCollection>('tracts-equity.geojson'),
        get<ParkCollection>('parks.geojson'),
        get<FeatureCollection>('roads-lowtree.geojson').catch(() => null),
        // Missing/invalid trees.geojson is not an error: overlay just hides.
        get<FeatureCollection>('trees.geojson').catch(() => null),
      ])
      if (controller !== ctl) return false
      meta.value = m
      tracts.value = t
      parks.value = p
      roads.value = r
      trees.value = tr && Array.isArray(tr.features) && tr.features.length > 0 ? tr : null
      void saveLastPack(kept)
      return true
    } catch (e) {
      if (controller !== ctl || (e instanceof DOMException && e.name === 'AbortError')) return false
      clearPack()
      error.value = e instanceof Error ? e.message : String(e)
      return false
    } finally {
      if (controller === ctl) {
        loading.value = false
        controller = null
      }
    }
  }

  return { meta, tracts, parks, roads, trees, loading, error, load }
}

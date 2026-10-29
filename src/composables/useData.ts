import { ref } from 'vue'
import type { FeatureCollection } from 'geojson'
import type { Meta, ParkCollection, TractCollection } from '@/types'

// All data is static JSON shipped with the site (public/data). BASE_URL makes it work
// at "/" (dev, Express) and at "/street-tree-equity/" (GitHub Pages project site).
export const dataUrl = (file: string) => `${import.meta.env.BASE_URL}data/${file}`

async function getJson<T>(file: string): Promise<T> {
  const res = await fetch(dataUrl(file))
  if (!res.ok) throw new Error(`Failed to load ${file}: HTTP ${res.status}`)
  return (await res.json()) as T
}

export function useData() {
  const meta = ref<Meta | null>(null)
  const tracts = ref<TractCollection | null>(null)
  const parks = ref<ParkCollection | null>(null)
  const roads = ref<FeatureCollection | null>(null)
  const loading = ref(true)
  const error = ref<string | null>(null)

  async function load() {
    loading.value = true
    try {
      const [m, t, p, r] = await Promise.all([
        getJson<Meta>('meta.json'),
        getJson<TractCollection>('tracts-equity.geojson'),
        getJson<ParkCollection>('parks.geojson'),
        getJson<FeatureCollection>('roads-lowtree.geojson').catch(() => null),
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

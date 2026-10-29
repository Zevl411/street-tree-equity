import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { loadCities } from '@/composables/useData'
import type { CityEntry, PlaceResult } from '@/types'

export const DEFAULT_CITY = 'portland-or'
const CITY_KEY = 'ste-city'
const FALLBACK_CITIES: CityEntry[] = [{
  id: DEFAULT_CITY, cityName: 'Portland, OR', subtitle: 'Central Portland', dataPath: 'data',
  bbox: [-122.75, 45.47, -122.58, 45.57],
}]

/** Which place is shown, the tract selection, and the "not built" Nominatim pick. */
export const useCityStore = defineStore('city', () => {
  const cities = ref<CityEntry[]>([])
  const cityId = ref<string | null>(null)
  const city = computed<CityEntry | null>(() => cities.value.find((c) => c.id === cityId.value) ?? null)
  const defaultCity = computed<CityEntry | null>(
    () => cities.value.find((c) => c.id === DEFAULT_CITY) ?? cities.value[0] ?? null,
  )
  const selectedGeoid = ref<string | null>(null)
  const notBuilt = ref<PlaceResult | null>(null)

  async function loadManifest(): Promise<void> {
    try {
      cities.value = (await loadCities()).cities
    } catch {
      // Manifest missing: fall back to the built-in Portland pack in data/.
      cities.value = FALLBACK_CITIES
    }
  }

  /** ?city= first, then localStorage, then the default. Unknown ids are ignored. */
  function initialCityId(): string {
    const fromUrl = new URLSearchParams(window.location.search).get('city')
    let stored: string | null = null
    try { stored = localStorage.getItem(CITY_KEY) } catch { /* ignore */ }
    const known = (id: string | null): id is string => !!id && cities.value.some((c) => c.id === id)
    return [fromUrl, stored].find(known) ?? DEFAULT_CITY
  }

  /** Switch city; returns the entry and whether it changed (caller loads data). */
  function setCity(id: string): { entry: CityEntry; changed: boolean } | null {
    const c = cities.value.find((x) => x.id === id) ?? defaultCity.value
    if (!c) return null
    notBuilt.value = null
    selectedGeoid.value = null
    const changed = c.id !== cityId.value
    cityId.value = c.id
    try { localStorage.setItem(CITY_KEY, c.id) } catch { /* storage unavailable */ }
    const url = new URL(window.location.href)
    url.searchParams.set('city', c.id)
    window.history.replaceState(null, '', url)
    return { entry: c, changed }
  }

  function setNotBuilt(place: PlaceResult | null): void {
    notBuilt.value = place
    selectedGeoid.value = null
  }

  function select(geoid: string | null): void {
    selectedGeoid.value = geoid
  }

  return { cities, cityId, city, defaultCity, selectedGeoid, notBuilt, loadManifest, initialCityId, setCity, setNotBuilt, select }
})

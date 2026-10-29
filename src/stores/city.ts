import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { loadCities } from '@/composables/useData'
import { isReady, type CityEntry } from '@/types'

export const DEFAULT_CITY = 'portland-or'
const CITY_KEY = 'ste-city'
const FALLBACK_CITIES: CityEntry[] = [{
  id: DEFAULT_CITY, cityName: 'Portland, OR', subtitle: 'Central Portland', dataPath: 'data',
  bbox: [-122.75, 45.47, -122.58, 45.57], status: 'ready',
}]

/** Which packaged city is shown and the tract selection. Only ready packs load data. */
export const useCityStore = defineStore('city', () => {
  const cities = ref<CityEntry[]>([])
  const cityId = ref<string | null>(null)
  const city = computed<CityEntry | null>(() => cities.value.find((c) => c.id === cityId.value) ?? null)
  const defaultCity = computed<CityEntry | null>(
    () => cities.value.find((c) => c.id === DEFAULT_CITY) ?? cities.value[0] ?? null,
  )
  const selectedGeoid = ref<string | null>(null)
  const manifestError = ref(false)
  const manifestVersion = ref<number | null>(null)

  async function loadManifest(): Promise<void> {
    try {
      const m = await loadCities()
      cities.value = m.cities
      manifestVersion.value = Number.isFinite(m.version) ? m.version : null
      manifestError.value = false
    } catch {
      // Manifest missing: fall back to the built-in Portland pack in data/.
      cities.value = FALLBACK_CITIES
      manifestError.value = true
    }
  }

  /** ?city= first, then localStorage, then the default. Unknown and coming-soon ids are ignored. */
  function initialCityId(): string {
    const fromUrl = new URLSearchParams(window.location.search).get('city')
    let stored: string | null = null
    try { stored = localStorage.getItem(CITY_KEY) } catch { /* ignore */ }
    const known = (id: string | null): id is string => !!id && cities.value.some((c) => c.id === id && isReady(c))
    return [fromUrl, stored].find(known) ?? DEFAULT_CITY
  }

  /** Switch city; returns the entry and whether it changed (caller loads data). */
  function setCity(id: string): { entry: CityEntry; changed: boolean } | null {
    // Coming-soon packs have no data yet: stay on the current ready city (or the default).
    const ready = (x: CityEntry | null | undefined) => (x && isReady(x) ? x : null)
    const c = ready(cities.value.find((x) => x.id === id)) ?? ready(city.value) ?? ready(defaultCity.value)
      ?? cities.value.find(isReady) ?? null
    if (!c) return null
    selectedGeoid.value = null
    const changed = c.id !== cityId.value
    cityId.value = c.id
    try { localStorage.setItem(CITY_KEY, c.id) } catch { /* storage unavailable */ }
    const url = new URL(window.location.href)
    url.searchParams.set('city', c.id)
    window.history.replaceState(null, '', url)
    return { entry: c, changed }
  }

  function select(geoid: string | null): void {
    selectedGeoid.value = geoid
  }

  return { cities, cityId, city, defaultCity, selectedGeoid, manifestError, manifestVersion, loadManifest, initialCityId, setCity, select }
})

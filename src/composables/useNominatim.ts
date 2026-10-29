import { ref } from 'vue'
import type { CityEntry, PlaceResult } from '@/types'

/**
 * Place search via OpenStreetMap Nominatim (free, no key). Discovery only — we never fetch
 * map data live (no Overpass in the browser).
 * Usage policy: https://operations.osmfoundation.org/policies/nominatim/
 *  - absolute max 1 request/second; identify the application.
 *  - We debounce typing by 500 ms, skip queries < 3 chars, keep max 1 request in flight
 *    (older ones are aborted) and space requests ≥ 1 s apart.
 *  - Browsers forbid scripts from setting User-Agent (it is silently dropped / may fail CORS
 *    preflight), so identification relies on the Referer header the browser sends
 *    (https://zevl411.github.io/street-tree-equity/). APP_ID below documents the intended UA.
 */
export const APP_ID =
  'StreetTreeEquity/1.0 (https://zevl411.github.io/street-tree-equity/; contact via GitHub Zevl411/street-tree-equity)'
const ENDPOINT = 'https://nominatim.openstreetmap.org/search?format=json&limit=5&addressdetails=1&q='
const DEBOUNCE_MS = 500
const MIN_GAP_MS = 1000
const MIN_CHARS = 3

let lastRequestAt = 0

export function useNominatim() {
  const searching = ref(false)
  const results = ref<PlaceResult[] | null>(null) // null = not searched yet
  const failed = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  let ctrl: AbortController | null = null

  async function run(q: string) {
    const query = q.trim()
    if (query.length < MIN_CHARS) { results.value = null; return }
    ctrl?.abort()
    const mine = (ctrl = new AbortController())
    searching.value = true
    failed.value = false
    try {
      const wait = MIN_GAP_MS - (Date.now() - lastRequestAt)
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      if (mine.signal.aborted) return
      lastRequestAt = Date.now()
      const res = await fetch(ENDPOINT + encodeURIComponent(query), {
        signal: mine.signal,
        headers: { Accept: 'application/json', 'Accept-Language': navigator.language || 'en' },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      results.value = (await res.json()) as PlaceResult[]
    } catch (e) {
      if (mine.signal.aborted) return
      results.value = []
      failed.value = true
    } finally {
      if (ctrl === mine) searching.value = false
    }
  }

  /** Call on input; fires after 500 ms of no typing. */
  function debounced(q: string) {
    clearTimeout(timer)
    timer = setTimeout(() => run(q), DEBOUNCE_MS)
  }
  /** Call on Enter: search now. */
  function now(q: string) {
    clearTimeout(timer)
    run(q)
  }
  function reset() {
    clearTimeout(timer)
    ctrl?.abort()
    searching.value = false
    results.value = null
    failed.value = false
  }

  return { searching, results, failed, debounced, now, reset }
}

function km(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = Math.PI / 180
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(a))
}

/** The packaged city within ~50 km of the hit (by bbox center), or null. */
export function matchCity(p: PlaceResult, cities: CityEntry[], maxKm = 50): CityEntry | null {
  let best: CityEntry | null = null
  let bestD = Infinity
  for (const c of cities) {
    const d = km(Number(p.lat), Number(p.lon), (c.bbox[1] + c.bbox[3]) / 2, (c.bbox[0] + c.bbox[2]) / 2)
    if (d <= maxKm && d < bestD) { best = c; bestD = d }
  }
  return best
}

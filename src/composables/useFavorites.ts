import { ref } from 'vue'

/** #45 Starred tracts: `ste-favorites` = { [cityId]: geoid[] }, newest first. Separate from #44 `ste-view`. */
export const FAVORITES_KEY = 'ste-favorites'
export const FAVORITES_CAP = 50
type FavMap = Record<string, string[]>

function read(): FavMap {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY)
    const v = raw ? JSON.parse(raw) : {}
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    const out: FavMap = {}
    for (const [k, arr] of Object.entries(v)) if (Array.isArray(arr)) out[k] = arr.filter((g): g is string => typeof g === 'string')
    return out
  } catch { return {} }
}
const favs = ref<FavMap>(read())
function write() {
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs.value)) } catch { /* fail soft */ }
}

export function useFavorites() {
  const list = (cityId: string | null | undefined) => (cityId ? favs.value[cityId] ?? [] : [])
  const isStarred = (cityId: string | null | undefined, geoid: string) => list(cityId).includes(geoid)
  function toggle(cityId: string | null | undefined, geoid: string): boolean {
    if (!cityId) return false
    const cur = list(cityId).filter((g) => g !== geoid)
    const starred = cur.length === list(cityId).length
    const next = starred ? [geoid, ...cur].slice(0, FAVORITES_CAP) : cur
    favs.value = { ...favs.value, [cityId]: next }
    write()
    return starred
  }
  /** Drop GEOIDs not in the loaded pack; rewrites storage only if something changed. */
  function prune(cityId: string | null | undefined, valid: Iterable<string>) {
    if (!cityId || !favs.value[cityId]) return
    const set = new Set(valid)
    const cur = favs.value[cityId]
    const next = cur.filter((g) => set.has(g))
    if (next.length === cur.length) return
    favs.value = { ...favs.value, [cityId]: next }
    write()
  }
  return { favs, list, isStarred, toggle, prune }
}

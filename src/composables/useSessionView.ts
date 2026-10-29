/** #44: last map camera (+ selected tract) per city, in localStorage only. No PII. */
const VIEW_KEY = 'ste-view'

export interface SessionView {
  cityId: string
  lng: number
  lat: number
  zoom: number
  geoid?: string | null
}

export function readSessionView(): SessionView | null {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null') as Partial<SessionView> | null
    if (!v || typeof v.cityId !== 'string') return null
    const { lng, lat, zoom } = v
    if (![lng, lat, zoom].every((n) => typeof n === 'number' && Number.isFinite(n))) return null
    if (Math.abs(lng!) > 180 || Math.abs(lat!) > 85 || zoom! < 1 || zoom! > 22) return null
    const geoid = typeof v.geoid === 'string' && /^\d{6,15}$/.test(v.geoid) ? v.geoid : null
    return { cityId: v.cityId, lng: lng!, lat: lat!, zoom: zoom!, geoid }
  } catch { return null }
}

/** Merge a patch into the stored view; a cityId change drops the old camera/geoid. */
export function writeSessionView(patch: Partial<SessionView> & { cityId: string }): void {
  try {
    const prev = readSessionView()
    const base = prev && prev.cityId === patch.cityId ? prev : { cityId: patch.cityId }
    const next = { ...base, ...patch }
    if (typeof (next as SessionView).lng !== 'number' && !next.geoid) return
    localStorage.setItem(VIEW_KEY, JSON.stringify(next))
  } catch { /* storage unavailable */ }
}

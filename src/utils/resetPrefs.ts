/**
 * #58 Reset saved preferences.
 * Known keys (as of #58): ste-city, ste-view, ste-favorites, ste-theme, ste-basemap,
 * ste-density-unit, ste-fill-opacity, ste-choropleth, ste-legend-open, ste-bin (#79, per-city map),
 * ste-palette (#81, `cb` when colorblind-safe ramp is on).
 * We sweep every `ste-*` key so future prefs aren't orphaned. Never touches non-ste-* keys.
 */
export function wipeSavedPrefs(): void {
  let keys: string[] = []
  try {
    keys = Object.keys(localStorage).filter((k) => k.startsWith('ste-'))
  } catch {
    return
  }
  for (const k of keys) {
    try { localStorage.removeItem(k) } catch { /* fail soft */ }
  }
}

/** Wipe ste-* prefs, then hard-navigate to the bare path (no query/hash). */
export function resetPrefsAndReload(): void {
  const u = new URL(location.href)
  u.search = ''
  u.hash = ''
  wipeSavedPrefs()
  location.assign(u.pathname || '/')
}

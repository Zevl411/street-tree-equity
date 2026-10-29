import type { Basemap, ThemeName } from '@/stores/ui'

/** Parsed, validated view params from the URL (?city=&geoid=|tract=&basemap=&theme=). */
export interface DeepLink {
  city: string | null
  geoid: string | null
  basemap: Basemap | null
  theme: ThemeName | null
}

export function readDeepLink(search: string = window.location.search): DeepLink {
  const q = new URLSearchParams(search)
  const basemap = q.get('basemap')
  const theme = q.get('theme')
  const geoid = (q.get('geoid') ?? q.get('tract'))?.trim() || null
  return {
    city: q.get('city'),
    geoid: geoid && /^\d{6,15}$/.test(geoid) ? geoid : null,
    basemap: basemap === 'streets' || basemap === 'satellite' ? basemap : null,
    theme: theme === 'treeLight' || theme === 'treeDark' ? theme : null,
  }
}

/** Rewrite the view params in place (no reload). Drops invalid/stale ones like `tract`. */
export function writeDeepLink(v: { city: string | null; geoid: string | null; basemap: Basemap; theme: ThemeName }): void {
  const url = new URL(window.location.href)
  const q = url.searchParams
  for (const k of ['city', 'geoid', 'tract', 'basemap', 'theme']) q.delete(k)
  if (v.city) q.set('city', v.city)
  if (v.geoid) q.set('geoid', v.geoid)
  q.set('basemap', v.basemap)
  q.set('theme', v.theme)
  if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url)
}

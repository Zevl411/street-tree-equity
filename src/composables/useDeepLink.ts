import type { Basemap, DensityUnit, ThemeName } from '@/stores/ui'

/** Visibility of the four toggleable map layers (choropleth is always on). */
export interface LayerFlags {
  trees: boolean
  parks: boolean
  roads: boolean
  bq: boolean
}

export const DEFAULT_LAYERS: LayerFlags = { trees: true, parks: true, roads: true, bq: false }
const LAYER_TOKENS = ['trees', 'parks', 'roads', 'bq'] as const

/** `layers=trees,parks,bq` → flags. Unknown tokens ignored; empty value = all off; absent = null. */
export function parseLayers(raw: string | null): LayerFlags | null {
  if (raw === null) return null
  const set = new Set(raw.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))
  return { trees: set.has('trees'), parks: set.has('parks'), roads: set.has('roads'), bq: set.has('bq') }
}

/** Flags → token string, or null when they equal the app default (keeps share links short). */
export function encodeLayers(f: LayerFlags): string | null {
  if (LAYER_TOKENS.every((k) => f[k] === DEFAULT_LAYERS[k])) return null
  return LAYER_TOKENS.filter((k) => f[k]).join(',')
}

/** Parsed, validated view params from the URL (?city=&geoid=|tract=&basemap=&theme=&layers=). */
export interface DeepLink {
  city: string | null
  geoid: string | null
  basemap: Basemap | null
  theme: ThemeName | null
  layers: LayerFlags | null
  unit: DensityUnit | null
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
    layers: parseLayers(q.get('layers')),
    unit: ((u) => (u === 'acre' || u === 'km2' ? u : null))(q.get('unit')?.trim().toLowerCase()),
  }
}

/** Rewrite the view params in place (no reload). Drops invalid/stale ones like `tract`. */
export function writeDeepLink(v: { city: string | null; geoid: string | null; basemap: Basemap; theme: ThemeName; layers: LayerFlags; unit: DensityUnit }): void {
  const url = new URL(window.location.href)
  const q = url.searchParams
  for (const k of ['city', 'geoid', 'tract', 'basemap', 'theme', 'layers', 'unit']) q.delete(k)
  if (v.city) q.set('city', v.city)
  if (v.geoid) q.set('geoid', v.geoid)
  q.set('basemap', v.basemap)
  q.set('theme', v.theme)
  const layers = encodeLayers(v.layers)
  if (layers !== null) q.set('layers', layers)
  if (v.unit === 'km2') q.set('unit', 'km2')
  if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url)
}

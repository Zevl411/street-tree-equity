import { DEFAULT_METRIC, normalizeMetric, type MetricId } from '@/utils/metrics'
import type { Basemap, DensityUnit, ThemeName } from '@/stores/ui'
import type { ChoroplethMode } from '@/utils/choropleth'

/** Visibility of the four toggleable map layers (choropleth is always on). */
export interface LayerFlags {
  trees: boolean
  parks: boolean
  roads: boolean
  bq: boolean
  /** #59: dim tracts above the city median (session + URL only). */
  bm: boolean
}

export const DEFAULT_LAYERS: LayerFlags = { trees: true, parks: true, roads: true, bq: false, bm: false }
const LAYER_TOKENS = ['trees', 'parks', 'roads', 'bq', 'bm'] as const

/** `layers=trees,parks,bq` → flags. Unknown tokens ignored; empty value = all off; absent = null. */
export function parseLayers(raw: string | null): LayerFlags | null {
  if (raw === null) return null
  const set = new Set(raw.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))
  return { trees: set.has('trees'), parks: set.has('parks'), roads: set.has('roads'), bq: set.has('bq'), bm: set.has('bm') }
}

/** Flags → token string, or null when they equal the app default (keeps share links short). */
export function encodeLayers(f: LayerFlags): string | null {
  if (LAYER_TOKENS.every((k) => f[k] === DEFAULT_LAYERS[k])) return null
  return LAYER_TOKENS.filter((k) => f[k]).join(',')
}

/** #85: canonical `treeLight`/`treeDark` (exact) or aliases `light`/`dark` (case-insensitive) → ThemeName. */
export function parseTheme(raw: string | null): ThemeName | null {
  if (!raw) return null
  const t = raw.trim()
  if (t === 'treeLight' || t === 'treeDark') return t
  const a = t.toLowerCase()
  if (a === 'light') return 'treeLight'
  if (a === 'dark') return 'treeDark'
  return null
}

/** Parsed, validated view params from the URL (?city=&geoid=|tract=&basemap=&theme=&layers=). */
export interface DeepLink {
  city: string | null
  geoid: string | null
  basemap: Basemap | null
  theme: ThemeName | null
  layers: LayerFlags | null
  unit: DensityUnit | null
  /** #97: always a registered metric (unknown → trees) */
  metric: MetricId
  /** #70: `hc=1` → contrast ramp; null when absent (keep stored mode). */
  hc: boolean | null
  /** #70 stretch: `legend=0|1`; null when absent. */
  legend: boolean | null
  /** #73 stretch: `bin=i` histogram bin; null when absent/invalid (clamped after meta loads). */
  bin: number | null
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
    theme: parseTheme(theme),
    layers: parseLayers(q.get('layers')),
    hc: q.get('hc') === '1' ? true : null,
    legend: ((l) => (l === '1' ? true : l === '0' ? false : null))(q.get('legend')),
    bin: ((b) => (b !== null && /^\d{1,2}$/.test(b) ? Number(b) : null))(q.get('bin')),
    // #97: unknown / missing → trees
    metric: normalizeMetric(q.get('metric')),
    unit: ((u) => (u === 'acre' || u === 'km2' ? u : null))(q.get('unit')?.trim().toLowerCase()),
  }
}

/** Rewrite the view params in place (no reload). Drops invalid/stale ones like `tract`. */
export interface ShareFlags { choroplethMode?: ChoroplethMode; legend?: boolean | null; bin?: number | null }

/** #70: shared hc/legend rules for writeDeepLink + tractShareUrl. */
export function applyShareFlags(q: URLSearchParams, v: ShareFlags): void {
  q.delete('hc')
  q.delete('legend')
  q.delete('bin')
  if (v.choroplethMode === 'contrast') q.set('hc', '1')
  if (v.legend != null) q.set('legend', v.legend ? '1' : '0')
  if (v.bin != null) q.set('bin', String(v.bin))
}

export function writeDeepLink(v: { city: string | null; geoid: string | null; basemap: Basemap; theme: ThemeName; layers: LayerFlags; unit: DensityUnit; metric?: MetricId } & ShareFlags): void {
  const url = new URL(window.location.href)
  const q = url.searchParams
  for (const k of ['city', 'geoid', 'tract', 'basemap', 'theme', 'layers', 'unit', 'metric']) q.delete(k)
  if (v.city) q.set('city', v.city)
  if (v.geoid) q.set('geoid', v.geoid)
  q.set('basemap', v.basemap)
  q.set('theme', v.theme)
  const layers = encodeLayers(v.layers)
  if (layers !== null) q.set('layers', layers)
  if (v.unit === 'km2') q.set('unit', 'km2')
  // #97: omit when default metric
  if (v.metric && v.metric !== DEFAULT_METRIC) q.set('metric', v.metric)
  applyShareFlags(q, v)
  if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url)
}

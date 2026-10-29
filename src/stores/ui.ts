import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { ChoroplethMode, ChoroplethPalette } from '@/utils/choropleth'
import { DEFAULT_METRIC, METRICS, normalizeMetric, type MetricId } from '@/utils/metrics'

export type ThemeName = 'treeLight' | 'treeDark'
export type Basemap = 'streets' | 'satellite'
export type DensityUnit = 'acre' | 'km2'

/** Acres per km² — converts trees/acre → trees/km². */
export const ACRES_PER_KM2 = 1 / 0.0040468564224

const THEME_KEY = 'ste-theme'
const BASEMAP_KEY = 'ste-basemap'
const UNIT_KEY = 'ste-density-unit'
const FILL_OPACITY_KEY = 'ste-fill-opacity'
const CHOROPLETH_KEY = 'ste-choropleth'
const PALETTE_KEY = 'ste-palette'
const LEGEND_KEY = 'ste-legend-open'
const BIN_KEY = 'ste-bin'

/** #79: ste-bin = { [cityId]: 0-based legend index }. Bad JSON / bad values → dropped. */
function readBinMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(BIN_KEY)
    const o = raw ? JSON.parse(raw) : {}
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {}
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(o)) if (Number.isInteger(v) && (v as number) >= 0) out[k] = v as number
    return out
  } catch { return {} }
}
export function storedBin(cityId: string | null | undefined): number | null {
  if (!cityId) return null
  return readBinMap()[cityId] ?? null
}
/** #79: write/merge (i ≥ 0 int) or delete the city's key; removes ste-bin when empty. */
export function persistBin(cityId: string | null | undefined, i: number | null) {
  if (!cityId) return
  try {
    const m = readBinMap()
    if (i !== null && Number.isInteger(i) && i >= 0) m[cityId] = i
    else delete m[cityId]
    if (Object.keys(m).length) localStorage.setItem(BIN_KEY, JSON.stringify(m))
    else localStorage.removeItem(BIN_KEY)
  } catch { /* storage unavailable */ }
}

export const FILL_OPACITY_MIN = 0.3
export const FILL_OPACITY_MAX = 1
export const FILL_OPACITY_DEFAULT = 0.65

/** #48: clamp to [0.3, 1]; non-finite → default. */
export function clampFillOpacity(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  if (!Number.isFinite(n)) return FILL_OPACITY_DEFAULT
  return Math.min(FILL_OPACITY_MAX, Math.max(FILL_OPACITY_MIN, n))
}

function read(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function write(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* storage unavailable */ }
}

/** Saved preference, else OS prefers-color-scheme, else light. */
export function initialTheme(): ThemeName {
  const saved = read(THEME_KEY)
  if (saved === 'treeLight' || saved === 'treeDark') return saved
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'treeDark' : 'treeLight'
}

function initialBasemap(): Basemap {
  return read(BASEMAP_KEY) === 'satellite' ? 'satellite' : 'streets'
}

/** UI chrome state: theme, basemap, layer visibility, About dialog. */
export const useUiStore = defineStore('ui', () => {
  const theme = ref<ThemeName>(initialTheme())
  const isDark = computed(() => theme.value === 'treeDark')
  const themeAnnounce = ref('')

  function setTheme(name: ThemeName): void {
    theme.value = name
    write(THEME_KEY, name)
    themeAnnounce.value = name === 'treeDark' ? 'Dark mode on' : 'Light mode on'
  }
  function toggleTheme(): void {
    setTheme(isDark.value ? 'treeLight' : 'treeDark')
  }

  // #76 stretch: follow live OS scheme changes until the user saves an explicit choice.
  // Does not persist; once `ste-theme` exists (toggle / share link) the listener is a no-op.
  const mq = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)') : undefined
  mq?.addEventListener?.('change', (e: MediaQueryListEvent) => {
    if (read(THEME_KEY) !== null) return
    theme.value = e.matches ? 'treeDark' : 'treeLight'
  })

  // Satellite UI ships in a later PR; the field + persistence are ready for it.
  const basemap = ref<Basemap>(initialBasemap())
  watch(basemap, (b) => write(BASEMAP_KEY, b))
  function setBasemap(b: Basemap): void {
    basemap.value = b
  }

  // #38: display-only density unit; persisted locally, not in deep links.
  // #97 A0: active metric (session only; trees is the only registered metric).
  const activeMetric = ref<MetricId>(DEFAULT_METRIC)
  const metric = computed(() => METRICS[activeMetric.value])
  function setActiveMetric(id: unknown) { activeMetric.value = normalizeMetric(id) }
  const densityUnit = ref<DensityUnit>(read(UNIT_KEY) === 'km2' ? 'km2' : 'acre')
  watch(densityUnit, (u) => write(UNIT_KEY, u))
  function setDensityUnit(u: DensityUnit): void {
    densityUnit.value = u
  }

  // #48: tract choropleth fill opacity; persisted locally, not in deep links.
  const fillOpacity = ref<number>(clampFillOpacity(read(FILL_OPACITY_KEY)))
  watch(fillOpacity, (v) => write(FILL_OPACITY_KEY, String(v)))
  function setFillOpacity(v: number): void {
    fillOpacity.value = clampFillOpacity(v)
  }

  // #49: global choropleth color ramp; persisted locally (own key), not in deep links.
  const choroplethMode = ref<ChoroplethMode>(read(CHOROPLETH_KEY) === 'contrast' ? 'contrast' : 'green')
  watch(choroplethMode, (m) => write(CHOROPLETH_KEY, m))
  function setChoroplethMode(m: ChoroplethMode): void {
    choroplethMode.value = m === 'contrast' ? 'contrast' : 'green'
  }

  // #81: colorblind-safe ramp family; orthogonal to choroplethMode; local only.
  const choroplethPalette = ref<ChoroplethPalette>(read(PALETTE_KEY) === 'cb' ? 'cb' : 'default')
  watch(choroplethPalette, (p) => {
    try { if (p === 'cb') localStorage.setItem(PALETTE_KEY, 'cb'); else localStorage.removeItem(PALETTE_KEY) } catch { /* ignore */ }
  })
  function setChoroplethPalette(p: ChoroplethPalette): void {
    choroplethPalette.value = p === 'cb' ? 'cb' : 'default'
  }

  // #53: legend expand/collapse; null = no stored choice (default by viewport).
  const legendStored = read(LEGEND_KEY)
  const legendExpandedPref = ref<boolean | null>(legendStored === '1' ? true : legendStored === '0' ? false : null)
  function setLegendExpanded(v: boolean): void {
    legendExpandedPref.value = v
    write(LEGEND_KEY, v ? '1' : '0')
  }

  const showTrees = ref(true)
  const showParks = ref(true)
  const showRoads = ref(true)
  const highlightBottomQuartile = ref(false)
  /** #59: not persisted — session + share link (`bm`) only. */
  const belowMedian = ref(false)
  /** #73: histogram bin filter — persisted per city in ste-bin (#79) by App. null = all bins. */
  const densityBinIndex = ref<number | null>(null)
  function setDensityBin(i: number | null, binCount?: number) {
    densityBinIndex.value = i !== null && Number.isInteger(i) && i >= 0 && (binCount === undefined || i < binCount) ? i : null
  }
  const aboutOpen = ref(false)

  return {
    activeMetric, metric, setActiveMetric,
    theme, isDark, themeAnnounce, setTheme, toggleTheme,
    basemap, setBasemap,
    densityUnit, setDensityUnit,
    fillOpacity, setFillOpacity,
    choroplethMode, setChoroplethMode, choroplethPalette, setChoroplethPalette,
    legendExpandedPref, setLegendExpanded,
    showTrees, showParks, showRoads, highlightBottomQuartile, belowMedian, aboutOpen,
    densityBinIndex, setDensityBin,
  }
})

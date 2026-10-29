<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import maplibregl, { type ExpressionSpecification, type GeoJSONSource, type Map as MlMap, type StyleSpecification } from 'maplibre-gl'
import type { Feature, FeatureCollection } from 'geojson'
import type { Meta, ParkCollection, TractCollection } from '@/types'
import { cityMedian as sharedCityMedian } from '@/utils/densityBins'
import { storeToRefs } from 'pinia'
import { writeSessionView, type SessionView } from '@/composables/useSessionView'
import { cameraDuration } from '@/composables/usePrefersReducedMotion'
import { useCityStore } from '@/stores/city'
import { useUiStore, type Basemap } from '@/stores/ui'
import { choroplethColors } from '@/utils/choropleth'

// Free, no-key basemap. OpenFreeMap is free to use with no registration or API key.
// Swap via VITE_BASEMAP_STYLE (any MapLibre style URL that needs no key).
// If VITE_BASEMAP_STYLE is set it wins for both streets themes (the theme toggle won't swap it).
// Satellite always uses EOxCloudless 2025 (free, no key, CC BY-NC-SA).
const ENV_STYLE: string | undefined = import.meta.env.VITE_BASEMAP_STYLE || undefined
const STREETS_LIGHT = 'https://tiles.openfreemap.org/styles/positron'
const STREETS_DARK = 'https://tiles.openfreemap.org/styles/dark'
const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  // #57: free OpenFreeMap glyphs so cluster count labels render on satellite too.
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    eox: {
      type: 'raster',
      tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg'],
      tileSize: 256,
      attribution: '<a href="https://cloudless.eox.at" target="_blank" rel="noopener noreferrer">EOxCloudless</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2025)',
    },
  },
  layers: [{ id: 'eox', type: 'raster', source: 'eox' }],
}
function styleFor(b: Basemap, dark: boolean): string | StyleSpecification {
  if (b === 'satellite') return SATELLITE_STYLE
  return ENV_STYLE ?? (dark ? STREETS_DARK : STREETS_LIGHT)
}
function palette(dark: boolean, sat: boolean) {
  if (sat) return { outline: '#ffffff', outlineOpacity: 0.95, selected: '#ffeb3b', hover: 0.7, base: 0.55, treeStroke: '#ffffff' }
  return dark
    ? { outline: '#e0e0e0', outlineOpacity: 0.85, selected: '#fafafa', hover: 0.9, base: 0.75, treeStroke: '#212121' }
    : { outline: '#ffffff', outlineOpacity: 0.9, selected: '#212121', hover: 0.85, base: 0.65, treeStroke: '#ffffff' }
}

const props = defineProps<{
  mobile?: boolean
  dataPath: string
  meta: Meta
  tracts: TractCollection
  /** #44: restored camera for this city (first load only); null = fit to city. */
  initialView?: SessionView | null
  parks: ParkCollection
  roads: FeatureCollection | null
  /** #51: pack tree points; null = pack has none (layer not added). */
  trees?: FeatureCollection | null
  /** #60 stretch: #54 focus mode bumps the selected outline. */
  focusMode?: boolean
  /** #90: while the Hotspots panel is open, dim tracts not in this set. */
  hotspotsOpen?: boolean
  hotspotGeoids?: string[]
}>()
const cityStore = useCityStore()
const { selectedGeoid } = storeToRefs(cityStore)
const ui = useUiStore()
const { isDark, basemap, fillOpacity, choroplethMode, choroplethPalette, showTrees, showParks, showRoads, highlightBottomQuartile, belowMedian, densityUnit, densityBinIndex } = storeToRefs(ui)
let scaleCtrl: maplibregl.ScaleControl | null = null
function mountScale() {
  if (!map) return
  if (scaleCtrl) map.removeControl(scaleCtrl)
  scaleCtrl = new maplibregl.ScaleControl({ maxWidth: 112, unit: densityUnit.value === 'km2' ? 'metric' : 'imperial' })
  map.addControl(scaleCtrl, 'bottom-left')
}
const emit = defineEmits<{ satelliteError: [] }>()

const el = ref<HTMLDivElement | null>(null)
let map: MlMap | null = null
let hoveredId: string | null = null
let satErrors = 0
const SAT_ERROR_LIMIT = 3
const ready = ref(false)

function fillColor(): ExpressionSpecification {
  const { breaks } = props.meta
  const colors = choroplethColors(props.meta, choroplethMode.value, choroplethPalette.value)
  const expr: unknown[] = ['step', ['to-number', ['get', ui.metric.valueKey], -1], colors[0]]
  breaks.forEach((b, i) => expr.push(b, colors[i + 1]))
  return expr as ExpressionSpecification
}

function firstSymbolLayerId(m: MlMap): string | undefined {
  return m.getStyle().layers?.find((l) => l.type === 'symbol')?.id
}

/** #48: user base opacity; hover = min(1, base + 0.12) so hover never dims. */
/** #59: median of finite treesPerAcre in the loaded pack; null when < 2 values. */
function cityMedian(): number | null {
  return sharedCityMedian(props.tracts, ui.metric.valueKey)
}
const BELOW_MEDIAN_DIM = 0.22

/** #48: user base opacity; hover = min(1, base + 0.12) so hover never dims.
 *  #59: when Below city median is on, above-median tracts drop to base * 0.22 (selected stays full). */
function tractFillOpacity(): ExpressionSpecification {
  const base = fillOpacity.value
  const hover = Math.min(1, base + 0.12)
  const hoverOf = (d: number): ExpressionSpecification => ['case', ['boolean', ['feature-state', 'hover'], false], Math.min(1, d + 0.12), d] as ExpressionSpecification
  // #73: bin wins — while a histogram bin is selected, opacity follows the bin only and the
  // #59 median dim is suspended (no AND). Clearing the bin restores #59 paint.
  // #90: hotspot dim wins while the panel is open — suspends #73 bin and #59 median paint.
  const hot = props.hotspotsOpen ? (props.hotspotGeoids ?? []) : []
  if (hot.length) {
    const dim = base * BELOW_MEDIAN_DIM
    return [
      'case',
      ['==', ['get', 'geoid'], selectedGeoid.value ?? ''], base,
      ['!', ['in', ['to-string', ['get', 'geoid']], ['literal', hot]]], hoverOf(dim),
      ['boolean', ['feature-state', 'hover'], false], hover,
      base,
    ] as ExpressionSpecification
  }
  const bin = densityBinIndex.value
  if (bin !== null) {
    const dim = base * BELOW_MEDIAN_DIM
    // Same bin math as binIndex()/fill `step`: index = number of breaks <= v.
    const last = choroplethColors(props.meta, choroplethMode.value, choroplethPalette.value).length - 1
    const idx: ExpressionSpecification = ['min', last, ['+', 0, ...props.meta.breaks.map((b) => ['case', ['>=', ['to-number', ['get', ui.metric.valueKey], -1], b], 1, 0])]] as unknown as ExpressionSpecification
    return [
      'case',
      ['==', ['get', 'geoid'], selectedGeoid.value ?? ''], base,
      ['!=', idx, bin], hoverOf(dim),
      ['boolean', ['feature-state', 'hover'], false], hover,
      base,
    ] as ExpressionSpecification
  }
  const median = belowMedian.value ? cityMedian() : null
  if (median === null) return ['case', ['boolean', ['feature-state', 'hover'], false], hover, base]
  const dim = base * BELOW_MEDIAN_DIM
  return [
    'case',
    ['==', ['get', 'geoid'], selectedGeoid.value ?? ''], base,
    // #100: risk (higherIsBetter=false) dims below-median tracts
    ui.metric.higherIsBetter ? ['>', ['to-number', ['get', ui.metric.valueKey], -1], median] : ['<', ['to-number', ['get', ui.metric.valueKey], -1], median],
    ['case', ['boolean', ['feature-state', 'hover'], false], Math.min(1, dim + 0.12), dim],
    ['boolean', ['feature-state', 'hover'], false], hover,
    base,
  ] as ExpressionSpecification
}
function refreshTractOpacity() {
  if (map?.getLayer('tracts-fill')) map.setPaintProperty('tracts-fill', 'fill-opacity', tractFillOpacity())
}

/** #51/#57/#94: trees source + layers; called on style.load and when deferred trees arrive. */
function addTreeLayers(m: MlMap, before?: string) {
  if (!props.trees?.features.length || m.getSource('trees')) return
  // #57: MapLibre built-in clustering on the #51 trees source.
  m.addSource('trees', { type: 'geojson', data: props.trees, cluster: true, clusterRadius: 50, clusterMaxZoom: TREE_CLUSTER_MAX_ZOOM })
  const vis = showTrees.value ? 'visible' : 'none'
  m.addLayer({
    id: 'trees', type: 'circle', source: 'trees',
    filter: ['!', ['has', 'point_count']],
    layout: { visibility: vis },
    paint: treePaint(),
  }, before)
  const cp = clusterPaint()
  m.addLayer({
    id: 'trees-clusters', type: 'circle', source: 'trees', minzoom: 11,
    filter: ['has', 'point_count'],
    layout: { visibility: vis },
    paint: {
      'circle-radius': ['step', ['get', 'point_count'], 14, 25, 18, 100, 22, 500, 28] as ExpressionSpecification,
      'circle-opacity': 0.85,
      'circle-color': cp.fill, 'circle-stroke-color': cp.stroke, 'circle-stroke-width': cp.strokeWidth,
    },
  }, before)
  m.addLayer({
    id: 'trees-cluster-count', type: 'symbol', source: 'trees', minzoom: 11,
    filter: ['has', 'point_count'],
    layout: {
      visibility: vis,
      'text-field': '{point_count_abbreviated}',
      'text-size': 11,
      'text-font': ['Noto Sans Regular'],
      'text-allow-overlap': true,
    },
    paint: { 'text-color': cp.text },
  }, before)
}

function addDataLayers(m: MlMap) {
  const pal = palette(isDark.value, basemap.value === 'satellite')
  const before = firstSymbolLayerId(m)
  m.addSource('tracts', { type: 'geojson', data: props.tracts, promoteId: 'geoid' })
  m.addSource('parks', { type: 'geojson', data: props.parks })
  m.addSource('roads', { type: 'geojson', data: props.roads ?? { type: 'FeatureCollection', features: [] } })

  m.addLayer({
    id: 'tracts-fill', type: 'fill', source: 'tracts',
    paint: {
      'fill-color': fillColor(),
      'fill-opacity': tractFillOpacity(),
    },
  }, before)
  m.addLayer({
    id: 'tracts-line', type: 'line', source: 'tracts',
    paint: { 'line-color': pal.outline, 'line-width': 0.8, 'line-opacity': pal.outlineOpacity },
  }, before)
  m.addLayer({
    id: 'tracts-bottom', type: 'line', source: 'tracts',
    filter: ['==', ['get', 'bottomQuartile'], true],
    layout: { visibility: highlightBottomQuartile.value ? 'visible' : 'none' },
    paint: { 'line-color': '#d84315', 'line-width': 2, 'line-dasharray': [2, 1.5] },
  }, before)
  m.addLayer({
    id: 'parks-fill', type: 'fill', source: 'parks',
    layout: { visibility: showParks.value ? 'visible' : 'none' },
    paint: { 'fill-color': '#1b5e20', 'fill-opacity': 0.25, 'fill-outline-color': '#1b5e20' },
  }, before)
  m.addLayer({
    id: 'roads-low', type: 'line', source: 'roads',
    filter: ['==', ['get', 'geoid'], '__none__'],
    layout: { 'line-cap': 'round', visibility: showRoads.value ? 'visible' : 'none' },
    paint: { 'line-color': '#ef6c00', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.5, 16, 4] },
  }, before)
  addTreeLayers(m, before)
  // #60: halo + core, added last so the ring sits above trees/clusters and #36 dashes.
  const sp = selectedPaint()
  const selFilter = ['==', ['get', 'geoid'], selectedGeoid.value ?? ''] as any
  const layout = { 'line-join': 'round', 'line-cap': 'round' } as const
  m.addLayer({ id: 'tracts-selected-halo', type: 'line', source: 'tracts', filter: selFilter, layout, paint: sp.halo as any })
  m.addLayer({ id: 'tracts-selected', type: 'line', source: 'tracts', filter: selFilter, layout, paint: sp.core as any })
}

/** #60: selected-tract halo/core tokens by basemap/theme/contrast/focus; width zoom-interpolated around z12–14. */
function selectedPaint() {
  const sat = basemap.value === 'satellite'
  const dark = !sat && isDark.value
  const hc = choroplethMode.value === 'contrast'
  const t = sat
    ? { hc: '#000000', hw: 8, ho: 0.7, cc: '#ffeb3b', cw: 3.5 }
    : dark
      ? { hc: '#000000', hw: 7, ho: 0.75, cc: '#fafafa', cw: 3 }
      : { hc: '#ffffff', hw: 7, ho: 0.9, cc: '#212121', cw: 3 }
  const k = props.focusMode ? 1.25 : 1
  const hw = (t.hw + (hc ? 1 : 0)) * k
  const cw = (t.cw + (hc ? 0.5 : 0)) * k
  const w = (b: number) => ['interpolate', ['linear'], ['zoom'], 10, b * 0.75, 12, b, 14, b, 17, b * 1.25]
  return {
    halo: { 'line-color': t.hc, 'line-opacity': t.ho, 'line-width': w(hw) },
    core: { 'line-color': t.cc, 'line-opacity': 1, 'line-width': w(cw) },
  }
}

function applySelectedPaint() {
  if (!map?.getLayer('tracts-selected') || !map.getLayer('tracts-selected-halo')) return
  const sp = selectedPaint()
  for (const [k, v] of Object.entries(sp.halo)) map.setPaintProperty('tracts-selected-halo', k, v)
  for (const [k, v] of Object.entries(sp.core)) map.setPaintProperty('tracts-selected', k, v)
}

/** #51: tree dots — independent of #48 fill opacity; satellite gets light fill + dark stroke. */
function treePaint() {
  const sat = basemap.value === 'satellite'
  const pal = palette(isDark.value, sat)
  return {
    'circle-color': sat ? '#a5d6a7' : '#2e7d32',
    'circle-stroke-color': sat ? '#1b5e20' : pal.treeStroke,
    'circle-stroke-width': sat ? 1 : 0.5,
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 1.5, 15, 2.5, 17, 5] as ExpressionSpecification,
    // z13–14 lighter so the choropleth stays primary.
    'circle-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0.6, 14.5, 0.9] as ExpressionSpecification,
  }
}

const TREE_CLUSTER_MAX_ZOOM = 15
const TREE_LAYERS = ['trees', 'trees-clusters', 'trees-cluster-count']

/** #57: cluster colors per basemap/theme; high-contrast choropleth gets a brighter fill + heavier stroke. */
function clusterPaint() {
  const sat = basemap.value === 'satellite'
  const dark = !sat && isDark.value
  const hc = choroplethMode.value === 'contrast'
  const fill = sat ? (hc ? '#c8e6c9' : '#a5d6a7') : dark ? (hc ? '#81c784' : '#66bb6a') : (hc ? '#a5d6a7' : '#81c784')
  const stroke = sat ? '#1b5e20' : dark ? '#c8e6c9' : '#1b5e20'
  return { fill, stroke, strokeWidth: hc ? 2 : 1.5, text: dark ? '#e8f5e9' : '#1b5e20' }
}

function applyTreePaint() {
  if (!map?.getLayer('trees-clusters')) return
  const cp = clusterPaint()
  map.setPaintProperty('trees-clusters', 'circle-color', cp.fill)
  map.setPaintProperty('trees-clusters', 'circle-stroke-color', cp.stroke)
  map.setPaintProperty('trees-clusters', 'circle-stroke-width', cp.strokeWidth)
  map.setPaintProperty('trees-cluster-count', 'text-color', cp.text)
  for (const [k, v] of Object.entries(treePaint())) map.setPaintProperty('trees', k, v)
}

function setVis(id: string, on: boolean) {
  if (map?.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
}

/** #33: on phones the tract sheet covers most of the screen — fit the tract into the strip above it. */
function geomBbox(geom: unknown): [number, number, number, number] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') {
      const [x, y] = c as number[]
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
    } else if (Array.isArray(c)) c.forEach(walk)
  }
  walk((geom as { coordinates?: unknown } | null)?.coordinates)
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null
}

/** #36: zoom to one plant-here road segment; on phones keep it above the bottom sheet. */
function fitRoad(feature: Feature) {
  if (!map) return
  const b = geomBbox(feature.geometry)
  if (!b) return
  const h = map.getContainer().clientHeight
  const padding = props.mobile
    ? { top: 32, left: 32, right: 32, bottom: Math.max(32, Math.round(h * 0.6)) }
    : 48
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding, maxZoom: 18, duration: cameraDuration(500) })
}

function fitSelectedAboveSheet(g: string) {
  if (!map || !props.mobile) return
  const f = props.tracts.features.find((t) => t.properties.geoid === g)
  if (!f) return
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') {
      const [x, y] = c as number[]
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
    } else if (Array.isArray(c)) c.forEach(walk)
  }
  walk((f.geometry as { coordinates?: unknown }).coordinates)
  if (!Number.isFinite(minX)) return
  const h = map.getContainer().clientHeight
  // Keep ~40% of the map visible above the bottom sheet.
  const bottom = Math.max(24, Math.round(h * 0.6))
  map.fitBounds([[minX, minY], [maxX, maxY]], { padding: { top: 16, left: 16, right: 16, bottom }, maxZoom: 15, duration: cameraDuration(400) })
}

function applySelection() {
  if (!map || !ready.value) return
  const g = selectedGeoid.value
  map.setFilter('tracts-selected-halo', ['==', ['get', 'geoid'], g ?? ''])
  map.setFilter('tracts-selected', ['==', ['get', 'geoid'], g ?? ''])
  // Low-tree road segments: only the selected tract, or all of them when nothing is selected.
  map.setFilter('roads-low', g ? ['==', ['get', 'geoid'], g] : null)
}

function fitData() {
  const b = props.meta.dataBbox
  map?.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 24, duration: cameraDuration(600) })
}

defineExpose({
  flyTo(lon: number, lat: number, zoom = 15) {
    if (!map) return
    map.flyTo({ center: [lon, lat], zoom, duration: cameraDuration(600) })
  },
  fitData,
  fitRoad,
  resize() { map?.resize() },
})

// #55: re-fit canvas to the print page and back.
const onPrintResize = () => map?.resize()
onMounted(() => {
  if (!el.value) return
  window.addEventListener('beforeprint', onPrintResize)
  window.addEventListener('afterprint', onPrintResize)
  const b = props.meta.dataBbox
  map = new maplibregl.Map({
    container: el.value,
    style: styleFor(basemap.value, isDark.value),
    ...(props.initialView
      ? { center: [props.initialView.lng, props.initialView.lat] as [number, number], zoom: props.initialView.zoom }
      : { bounds: [[b[0], b[1]], [b[2], b[3]]] as [[number, number], [number, number]], fitBoundsOptions: { padding: 24 } }),
    attributionControl: false, // credits live in CreditStrip (#42)
  })
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right')
  mountScale()

  // Satellite fallback: repeated EOX tile/source errors -> back to streets (persisted via store).
  map.on('error', (e) => {
    const sid = (e as unknown as { sourceId?: string }).sourceId
    if (basemap.value !== 'satellite' || sid !== 'eox') return
    satErrors += 1
    if (satErrors >= SAT_ERROR_LIMIT) {
      satErrors = 0
      ui.setBasemap('streets')
      emit('satelliteError')
    }
  })

  // Fires on first load and after every setStyle (theme/basemap swap): re-add our layers each time.
  // #44: remember the camera for this city (debounced; never every frame).
  let viewTimer: ReturnType<typeof setTimeout> | undefined
  map.on('moveend', () => {
    clearTimeout(viewTimer)
    viewTimer = setTimeout(() => {
      const id = cityStore.cityId
      if (!map || !id) return
      const c = map.getCenter()
      writeSessionView({ cityId: id, lng: +c.lng.toFixed(5), lat: +c.lat.toFixed(5), zoom: +map.getZoom().toFixed(2) })
    }, 400)
  })

  map.on('style.load', () => {
    if (!map) return
    hoveredId = null
    addDataLayers(map)
    ready.value = true
    applySelection()
  })

  map.on('mousemove', 'tracts-fill', (e) => {
    if (!map || !e.features?.length) return
    const id = String(e.features[0].id)
    if (hoveredId && hoveredId !== id) map.setFeatureState({ source: 'tracts', id: hoveredId }, { hover: false })
    hoveredId = id
    map.setFeatureState({ source: 'tracts', id }, { hover: true })
    map.getCanvas().style.cursor = 'pointer'
  })
  map.on('mouseleave', 'tracts-fill', () => {
    if (!map) return
    if (hoveredId) map.setFeatureState({ source: 'tracts', id: hoveredId }, { hover: false })
    hoveredId = null
    map.getCanvas().style.cursor = ''
  })
  map.on('click', (e) => {
    if (!map) return
    // #57: cluster click zooms in instead of selecting the tract underneath.
    if (map.getLayer('trees-clusters') && map.queryRenderedFeatures(e.point, { layers: ['trees-clusters'] }).length) {
      map.easeTo({ center: e.lngLat, zoom: Math.min(map.getZoom() + 2, TREE_CLUSTER_MAX_ZOOM + 1), duration: cameraDuration(400) })
      return
    }
    const hit = map.queryRenderedFeatures(e.point, { layers: ['tracts-fill'] })
    cityStore.select(hit.length ? String(hit[0].properties.geoid) : null)
  })
  map.on('mouseenter', 'trees-clusters', () => { if (map) map.getCanvas().style.cursor = 'pointer' })
  map.on('mouseleave', 'trees-clusters', () => { if (map) map.getCanvas().style.cursor = '' })
  map.on('click', 'parks-fill', (e) => {
    const f = e.features?.[0]
    if (!map || !f) return
    new maplibregl.Popup({ closeButton: false })
      .setLngLat(e.lngLat)
      .setHTML(`<strong>${escapeHtml(String(f.properties.name))}</strong><br>${f.properties.areaAcres} acres`)
      .addTo(map)
  })
})

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function reloadStyle() {
  if (!map) return
  ready.value = false
  satErrors = 0
  // Visibility/selection are read from the stores inside addDataLayers + applySelection on style.load.
  map.setStyle(styleFor(basemap.value, isDark.value))
}
watch(basemap, reloadStyle)
// Theme only swaps the map style for streets (and only when no env override); satellite is theme-independent.
watch(isDark, () => {
  if (basemap.value === 'satellite' || ENV_STYLE) return
  reloadStyle()
})
watch(selectedGeoid, (g) => {
  applySelection()
  if (belowMedian.value || densityBinIndex.value !== null) refreshTractOpacity()
  if (g && ready.value) fitSelectedAboveSheet(g)
})
watch(fillOpacity, refreshTractOpacity)
watch(belowMedian, refreshTractOpacity)
watch(densityBinIndex, refreshTractOpacity)
watch(() => [props.hotspotsOpen, props.hotspotGeoids], refreshTractOpacity)
watch(() => props.tracts, refreshTractOpacity)
// #98: metric switch repaints fill + opacity (meta prop swaps breaks/colors).
watch(() => [ui.activeMetric, props.meta], () => {
  if (map?.getLayer('tracts-fill')) map.setPaintProperty('tracts-fill', 'fill-color', fillColor())
  refreshTractOpacity()
})
watch(choroplethMode, () => {
  if (map?.getLayer('tracts-fill')) map.setPaintProperty('tracts-fill', 'fill-color', fillColor())
  refreshTractOpacity()
  applyTreePaint()
  applySelectedPaint()
})
watch(choroplethPalette, () => {
  if (map?.getLayer('tracts-fill')) map.setPaintProperty('tracts-fill', 'fill-color', fillColor())
  refreshTractOpacity()
})
watch(isDark, applySelectedPaint)
watch(() => props.focusMode, applySelectedPaint)
watch(densityUnit, mountScale)
// #94: late-loaded (deferred) trees — add source/layers below the selection halo, or swap data.
watch(() => props.trees, (t) => {
  if (!map || !ready.value || !t?.features.length) return
  const src = map.getSource('trees') as GeoJSONSource | undefined
  if (src) { src.setData(t); return }
  addTreeLayers(map, map.getLayer('tracts-selected-halo') ? 'tracts-selected-halo' : firstSymbolLayerId(map))
})
watch(showTrees, (v) => TREE_LAYERS.forEach((id) => setVis(id, v)))
watch(showParks, (v) => setVis('parks-fill', v))
watch(showRoads, (v) => setVis('roads-low', v))
watch(highlightBottomQuartile, (v) => setVis('tracts-bottom', v))
watch(() => props.roads, (r) => {
  const src = map?.getSource('roads') as GeoJSONSource | undefined
  if (src && r) src.setData(r)
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeprint', onPrintResize); window.removeEventListener('afterprint', onPrintResize)
  map?.remove()
  map = null
})
</script>

<template>
  <div ref="el" class="map" />
</template>

<style scoped>
.map {
  position: absolute;
  inset: 0;
}
</style>

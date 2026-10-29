<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import maplibregl, { type ExpressionSpecification, type GeoJSONSource, type Map as MlMap, type StyleSpecification } from 'maplibre-gl'
import type { Feature, FeatureCollection } from 'geojson'
import type { Meta, ParkCollection, TractCollection } from '@/types'
import { storeToRefs } from 'pinia'
import { writeSessionView, type SessionView } from '@/composables/useSessionView'
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
}>()
const cityStore = useCityStore()
const { selectedGeoid } = storeToRefs(cityStore)
const ui = useUiStore()
const { isDark, basemap, fillOpacity, choroplethMode, showTrees, showParks, showRoads, highlightBottomQuartile } = storeToRefs(ui)
const emit = defineEmits<{ satelliteError: [] }>()

const el = ref<HTMLDivElement | null>(null)
let map: MlMap | null = null
let hoveredId: string | null = null
let satErrors = 0
const SAT_ERROR_LIMIT = 3
const ready = ref(false)

function fillColor(): ExpressionSpecification {
  const { breaks } = props.meta
  const colors = choroplethColors(props.meta, choroplethMode.value)
  const expr: unknown[] = ['step', ['get', 'treesPerAcre'], colors[0]]
  breaks.forEach((b, i) => expr.push(b, colors[i + 1]))
  return expr as ExpressionSpecification
}

function firstSymbolLayerId(m: MlMap): string | undefined {
  return m.getStyle().layers?.find((l) => l.type === 'symbol')?.id
}

/** #48: user base opacity; hover = min(1, base + 0.12) so hover never dims. */
function tractFillOpacity(): ExpressionSpecification {
  const base = fillOpacity.value
  return ['case', ['boolean', ['feature-state', 'hover'], false], Math.min(1, base + 0.12), base]
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
  if (props.trees?.features.length) {
    m.addSource('trees', { type: 'geojson', data: props.trees })
    m.addLayer({
      id: 'trees', type: 'circle', source: 'trees', minzoom: 13,
      layout: { visibility: showTrees.value ? 'visible' : 'none' },
      paint: treePaint(),
    }, before)
  }
  m.addLayer({
    id: 'tracts-selected', type: 'line', source: 'tracts',
    filter: ['==', ['get', 'geoid'], selectedGeoid.value ?? ''],
    paint: { 'line-color': pal.selected, 'line-width': 3 },
  })
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
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding, maxZoom: 18, duration: 500 })
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
  map.fitBounds([[minX, minY], [maxX, maxY]], { padding: { top: 16, left: 16, right: 16, bottom }, maxZoom: 15, duration: 400 })
}

function applySelection() {
  if (!map || !ready.value) return
  const g = selectedGeoid.value
  map.setFilter('tracts-selected', ['==', ['get', 'geoid'], g ?? ''])
  // Low-tree road segments: only the selected tract, or all of them when nothing is selected.
  map.setFilter('roads-low', g ? ['==', ['get', 'geoid'], g] : null)
}

function fitData() {
  const b = props.meta.dataBbox
  map?.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 24, duration: 0 })
}

defineExpose({
  flyTo(lon: number, lat: number, zoom = 15) {
    map?.flyTo({ center: [lon, lat], zoom })
  },
  fitData,
  fitRoad,
})

onMounted(() => {
  if (!el.value) return
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
  map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left')
  map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), 'top-right')

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
    const hit = map.queryRenderedFeatures(e.point, { layers: ['tracts-fill'] })
    cityStore.select(hit.length ? String(hit[0].properties.geoid) : null)
  })
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
  if (g && ready.value) fitSelectedAboveSheet(g)
})
watch(fillOpacity, () => {
  if (map?.getLayer('tracts-fill')) map.setPaintProperty('tracts-fill', 'fill-opacity', tractFillOpacity())
})
watch(choroplethMode, () => {
  if (map?.getLayer('tracts-fill')) map.setPaintProperty('tracts-fill', 'fill-color', fillColor())
})
watch(showTrees, (v) => setVis('trees', v))
watch(showParks, (v) => setVis('parks-fill', v))
watch(showRoads, (v) => setVis('roads-low', v))
watch(highlightBottomQuartile, (v) => setVis('tracts-bottom', v))
watch(() => props.roads, (r) => {
  const src = map?.getSource('roads') as GeoJSONSource | undefined
  if (src && r) src.setData(r)
})

onBeforeUnmount(() => {
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

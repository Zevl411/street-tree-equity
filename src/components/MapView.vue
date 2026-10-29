<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import maplibregl, { type ExpressionSpecification, type GeoJSONSource, type Map as MlMap } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import type { Meta, ParkCollection, TractCollection } from '@/types'
import { storeToRefs } from 'pinia'
import { dataUrl } from '@/composables/useData'
import { useCityStore } from '@/stores/city'
import { useUiStore } from '@/stores/ui'

// Free, no-key basemap. OpenFreeMap is free to use with no registration or API key.
// Swap via VITE_BASEMAP_STYLE (any MapLibre style URL that needs no key).
// If VITE_BASEMAP_STYLE is set it wins for both themes (the theme toggle won't swap the basemap).
const ENV_STYLE: string | undefined = import.meta.env.VITE_BASEMAP_STYLE || undefined
const STREETS_LIGHT = 'https://tiles.openfreemap.org/styles/positron'
const STREETS_DARK = 'https://tiles.openfreemap.org/styles/dark'
function styleUrl(dark: boolean) {
  return ENV_STYLE ?? (dark ? STREETS_DARK : STREETS_LIGHT)
}
function palette(dark: boolean) {
  return dark
    ? { outline: '#e0e0e0', outlineOpacity: 0.85, selected: '#fafafa', hover: 0.9, base: 0.75, treeStroke: '#212121' }
    : { outline: '#ffffff', outlineOpacity: 0.9, selected: '#212121', hover: 0.85, base: 0.65, treeStroke: '#ffffff' }
}

const props = defineProps<{
  dataPath: string
  meta: Meta
  tracts: TractCollection
  parks: ParkCollection
  roads: FeatureCollection | null
}>()
const cityStore = useCityStore()
const { selectedGeoid } = storeToRefs(cityStore)
const { isDark, showTrees, showParks, showRoads, highlightBottomQuartile } = storeToRefs(useUiStore())

const el = ref<HTMLDivElement | null>(null)
let map: MlMap | null = null
let hoveredId: string | null = null
const ready = ref(false)

function fillColor(): ExpressionSpecification {
  const { breaks, colors } = props.meta
  const expr: unknown[] = ['step', ['get', 'treesPerAcre'], colors[0]]
  breaks.forEach((b, i) => expr.push(b, colors[i + 1]))
  return expr as ExpressionSpecification
}

function firstSymbolLayerId(m: MlMap): string | undefined {
  return m.getStyle().layers?.find((l) => l.type === 'symbol')?.id
}

function addDataLayers(m: MlMap) {
  const pal = palette(isDark.value)
  const before = firstSymbolLayerId(m)
  m.addSource('tracts', { type: 'geojson', data: props.tracts, promoteId: 'geoid' })
  m.addSource('parks', { type: 'geojson', data: props.parks })
  m.addSource('trees', { type: 'geojson', data: dataUrl('trees.geojson', props.dataPath) })
  m.addSource('roads', { type: 'geojson', data: props.roads ?? { type: 'FeatureCollection', features: [] } })

  m.addLayer({
    id: 'tracts-fill', type: 'fill', source: 'tracts',
    paint: {
      'fill-color': fillColor(),
      'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], pal.hover, pal.base],
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
  m.addLayer({
    id: 'trees', type: 'circle', source: 'trees', minzoom: 13,
    layout: { visibility: showTrees.value ? 'visible' : 'none' },
    paint: {
      'circle-color': '#2e7d32',
      'circle-stroke-color': pal.treeStroke,
      'circle-stroke-width': 0.5,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 1.5, 17, 5],
    },
  }, before)
  m.addLayer({
    id: 'tracts-selected', type: 'line', source: 'tracts',
    filter: ['==', ['get', 'geoid'], selectedGeoid.value ?? ''],
    paint: { 'line-color': pal.selected, 'line-width': 3 },
  })
}

function setVis(id: string, on: boolean) {
  if (map?.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
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
})

onMounted(() => {
  if (!el.value) return
  const b = props.meta.dataBbox
  map = new maplibregl.Map({
    container: el.value,
    style: styleUrl(isDark.value),
    bounds: [[b[0], b[1]], [b[2], b[3]]],
    fitBoundsOptions: { padding: 24 },
    attributionControl: {
      compact: false,
      customAttribution: 'Tracts: <a href="https://www.census.gov/geographies/mapping-files.html" target="_blank">U.S. Census Bureau</a>',
    },
  })
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right')
  map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left')
  map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), 'top-right')

  // Fires on first load and after every setStyle (theme swap): re-add our layers each time.
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

watch(isDark, (d) => {
  if (!map || ENV_STYLE) return
  ready.value = false
  // Visibility/selection are read from the stores inside addDataLayers + applySelection on style.load.
  map.setStyle(styleUrl(d))
})
watch(selectedGeoid, applySelection)
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

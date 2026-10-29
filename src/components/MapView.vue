<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import maplibregl, { type ExpressionSpecification, type GeoJSONSource, type Map as MlMap } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import type { Meta, ParkCollection, TractCollection } from '@/types'
import { dataUrl } from '@/composables/useData'

// Free, no-key basemap. OpenFreeMap is free to use with no registration or API key.
// Swap via VITE_BASEMAP_STYLE (any MapLibre style URL that needs no key).
const BASEMAP_STYLE = import.meta.env.VITE_BASEMAP_STYLE || 'https://tiles.openfreemap.org/styles/positron'

const props = defineProps<{
  meta: Meta
  tracts: TractCollection
  parks: ParkCollection
  roads: FeatureCollection | null
  selectedGeoid: string | null
  showTrees: boolean
  showParks: boolean
  showRoads: boolean
  highlightBottomQuartile: boolean
}>()
const emit = defineEmits<{ select: [geoid: string | null] }>()

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
  const before = firstSymbolLayerId(m)
  m.addSource('tracts', { type: 'geojson', data: props.tracts, promoteId: 'geoid' })
  m.addSource('parks', { type: 'geojson', data: props.parks })
  m.addSource('trees', { type: 'geojson', data: dataUrl('trees.geojson') })
  m.addSource('roads', { type: 'geojson', data: props.roads ?? { type: 'FeatureCollection', features: [] } })

  m.addLayer({
    id: 'tracts-fill', type: 'fill', source: 'tracts',
    paint: {
      'fill-color': fillColor(),
      'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.85, 0.65],
    },
  }, before)
  m.addLayer({
    id: 'tracts-line', type: 'line', source: 'tracts',
    paint: { 'line-color': '#ffffff', 'line-width': 0.8, 'line-opacity': 0.9 },
  }, before)
  m.addLayer({
    id: 'tracts-bottom', type: 'line', source: 'tracts',
    filter: ['==', ['get', 'bottomQuartile'], true],
    layout: { visibility: props.highlightBottomQuartile ? 'visible' : 'none' },
    paint: { 'line-color': '#d84315', 'line-width': 2, 'line-dasharray': [2, 1.5] },
  }, before)
  m.addLayer({
    id: 'parks-fill', type: 'fill', source: 'parks',
    layout: { visibility: props.showParks ? 'visible' : 'none' },
    paint: { 'fill-color': '#1b5e20', 'fill-opacity': 0.25, 'fill-outline-color': '#1b5e20' },
  }, before)
  m.addLayer({
    id: 'roads-low', type: 'line', source: 'roads',
    filter: ['==', ['get', 'geoid'], '__none__'],
    layout: { 'line-cap': 'round', visibility: props.showRoads ? 'visible' : 'none' },
    paint: { 'line-color': '#ef6c00', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.5, 16, 4] },
  }, before)
  m.addLayer({
    id: 'trees', type: 'circle', source: 'trees', minzoom: 13,
    layout: { visibility: props.showTrees ? 'visible' : 'none' },
    paint: {
      'circle-color': '#2e7d32',
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 0.5,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 1.5, 17, 5],
    },
  }, before)
  m.addLayer({
    id: 'tracts-selected', type: 'line', source: 'tracts',
    filter: ['==', ['get', 'geoid'], props.selectedGeoid ?? ''],
    paint: { 'line-color': '#212121', 'line-width': 3 },
  })
}

function setVis(id: string, on: boolean) {
  if (map?.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
}

function applySelection() {
  if (!map || !ready.value) return
  const g = props.selectedGeoid
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
    style: BASEMAP_STYLE,
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

  map.on('load', () => {
    if (!map) return
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
    emit('select', hit.length ? String(hit[0].properties.geoid) : null)
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

watch(() => props.selectedGeoid, applySelection)
watch(() => props.showTrees, (v) => setVis('trees', v))
watch(() => props.showParks, (v) => setVis('parks-fill', v))
watch(() => props.showRoads, (v) => setVis('roads-low', v))
watch(() => props.highlightBottomQuartile, (v) => setVis('tracts-bottom', v))
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

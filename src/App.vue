<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useDisplay } from 'vuetify'
import { VBottomSheet, VMenu } from 'vuetify/components'
import MapView from '@/components/MapView.vue'
import CreditStrip from '@/components/CreditStrip.vue'
import MapLegend from '@/components/MapLegend.vue'
import TractDetails from '@/components/TractDetails.vue'
import PlacePicker from '@/components/PlacePicker.vue'
import CompareCities from '@/components/CompareCities.vue'
import TractFinder from '@/components/TractFinder.vue'
import HotspotsPanel from '@/components/HotspotsPanel.vue'
import FavoritesPanel from '@/components/FavoritesPanel.vue'
import { useData } from '@/composables/useData'
import { useCityStore } from '@/stores/city'
import { ACRES_PER_KM2, useUiStore } from '@/stores/ui'
import { readSessionView, writeSessionView, type SessionView } from '@/composables/useSessionView'
import { copyText } from '@/utils/clipboard'
import { readDeepLink, writeDeepLink, type LayerFlags } from '@/composables/useDeepLink'
import { isReady, type NearbyPark } from '@/types'
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts'
import { resetPrefsAndReload } from '@/utils/resetPrefs'
import { useOverlayFocus, firstFocusableIn, focusSoon } from '@/composables/useOverlayFocus'

const { meta, tracts, parks, roads, trees, loading, error, load } = useData()
/** #51: hide the trees switch when the pack ships no tree points. */
const treesAvailable = computed(() => !!trees.value?.features.length)
const ISSUE_URL = 'https://github.com/Zevl411/street-tree-equity/issues/new'

const cityStore = useCityStore()
const { cities, city, selectedGeoid } = storeToRefs(cityStore)
const ui = useUiStore()
const { theme, isDark, basemap, fillOpacity, themeAnnounce, showTrees, showParks, showRoads, highlightBottomQuartile, belowMedian, aboutOpen, densityUnit, choroplethMode } = storeToRefs(ui)

const loadingName = computed(() => city.value?.cityName ?? meta.value?.cityName ?? 'this place')
const { mdAndUp } = useDisplay()
const themeLabel = computed(() => (isDark.value ? 'Switch to light mode' : 'Switch to dark mode'))
const resetLabel = computed(() => `Show all of ${meta.value?.subtitle || meta.value?.cityName || 'the map'}`)
const layersOpen = ref(false)
const finderOpen = ref(false)
const hotspotsOpen = ref(false)
const favoritesOpen = ref(false)
const shortcutsOpen = ref(false)
const resetConfirmOpen = ref(false)
function confirmReset() {
  resetConfirmOpen.value = false
  aboutOpen.value = false
  resetPrefsAndReload()
}
// #53: collapsed by default on mobile, expanded on desktop; explicit choice persisted (ste-legend-open).
const legendExpanded = computed({
  get: () => ui.legendExpandedPref ?? mdAndUp.value,
  set: (v: boolean) => ui.setLegendExpanded(v),
})
/** #54 focus mode: layout-only chrome trim (no Fullscreen API, not persisted). */
const focusMode = ref(false)
const focusLabel = computed(() => (focusMode.value ? 'Exit focus' : 'Focus map'))
function setFocus(on: boolean) {
  if (on) {
    layersOpen.value = false; finderOpen.value = false; hotspotsOpen.value = false; favoritesOpen.value = false
    compareOpen.value = false; shortcutsOpen.value = false; aboutOpen.value = false
    cityStore.select(null)
  }
  focusMode.value = on
}
function toggleFocus() { setFocus(!focusMode.value) }
const mapRef = ref<InstanceType<typeof MapView> | null>(null)

// #55 print: expand legend for the page, restore prior pref after (doesn't write ste-legend-open).
const printing = ref(false)
let prePrintPref: boolean | null | undefined
function onBeforePrint() {
  if (printing.value) return
  printing.value = true
  prePrintPref = ui.legendExpandedPref
  ui.legendExpandedPref = true
}
function onAfterPrint() {
  if (!printing.value) return
  printing.value = false
  if (prePrintPref !== undefined) ui.legendExpandedPref = prePrintPref
  prePrintPref = undefined
  mapRef.value?.resize()
}
async function printMap() {
  onBeforePrint()
  await nextTick()
  mapRef.value?.resize()
  requestAnimationFrame(() => {
    window.print()
  })
}
const printMq = window.matchMedia('print')
const onPrintMq = (e: MediaQueryListEvent) => { if (!e.matches) onAfterPrint() }
window.addEventListener('beforeprint', onBeforePrint)
window.addEventListener('afterprint', onAfterPrint)
printMq.addEventListener('change', onPrintMq)
onBeforeUnmount(() => {
  window.removeEventListener('beforeprint', onBeforePrint)
  window.removeEventListener('afterprint', onAfterPrint)
  printMq.removeEventListener('change', onPrintMq)
})

const selectedTract = computed(() =>
  tracts.value?.features.find((f) => f.properties.geoid === selectedGeoid.value)?.properties ?? null,
)
const drawerOpen = computed({
  get: () => selectedTract.value !== null,
  set: (v: boolean) => { if (!v) cityStore.select(null) },
})

function flyToPark(p: NearbyPark) {
  const park = parks.value?.features.find((f) => f.properties.id === p.id)
  if (park) mapRef.value?.flyTo(park.properties.lon, park.properties.lat, 15)
}

const updated = computed(() => (meta.value?.osmTimestamp ? new Date(meta.value.osmTimestamp).toLocaleDateString() : ''))
// #56 Copy citations (plain text, reuses #47 copyText fallback).
const citationsText = computed(() => [
  'Street Tree Equity — data sources',
  `- Street trees & parks: © OpenStreetMap contributors (ODbL) https://www.openstreetmap.org/copyright${updated.value ? `; OSM data as of ${updated.value}` : ''}`,
  `- Tract boundaries: U.S. Census Bureau cartographic boundary files (public domain)${meta.value?.censusVintage ? `; vintage ${meta.value.censusVintage}` : ''}`,
  '- Streets basemap: OpenFreeMap / OpenMapTiles / © OpenStreetMap contributors — https://openfreemap.org',
  '- Satellite: EOxCloudless 2025 by EOX IT Services GmbH — modified Copernicus Sentinel data 2025 — CC BY-NC-SA (non-commercial) — https://cloudless.eox.at',
  '- Code: https://github.com/Zevl411/street-tree-equity (MIT)',
].join('\n'))
const citationsSnack = ref(false)
const citationsFallbackOpen = ref(false)
function selectCitations() {
  const el = document.querySelector<HTMLTextAreaElement>('#citations-fallback textarea')
  el?.focus(); el?.select()
}
async function copyCitations() {
  if (await copyText(citationsText.value)) citationsSnack.value = true
  else citationsFallbackOpen.value = true
}

/** #44: stored camera for the first city shown (cleared after boot so city switches fit). */
const initialView = ref<SessionView | null>(null)

async function selectCity(id: string, restore: SessionView | null = null) {
  const res = cityStore.setCity(id)
  if (!res) return
  initialView.value = restore && restore.cityId === res.entry.id ? restore : null
  if (res.changed || !meta.value) await load(res.entry.dataPath)
  if (!initialView.value) mapRef.value?.fitData()
}

function retry() {
  if (city.value) load(city.value.dataPath)
}

async function init() {
  const link = readDeepLink()
  if (link.theme && link.theme !== ui.theme) ui.setTheme(link.theme)
  if (link.basemap) ui.setBasemap(link.basemap)
  if (link.layers) applyLayers(link.layers)
  if (link.unit) ui.setDensityUnit(link.unit)
  await cityStore.loadManifest()
  // #44 precedence per field: URL param > localStorage (ready packs only) > default.
  const stored = readSessionView()
  const bootCity = cityStore.initialCityId()
  const inPack = (g: string | null | undefined) => !!g && !!tracts.value?.features.some((f) => f.properties.geoid === g)
  // A URL geoid owns the camera; otherwise restore the stored camera only for the same city.
  await selectCity(bootCity, !link.geoid && stored?.cityId === bootCity ? stored : null)
  if (link.geoid && inPack(link.geoid)) cityStore.select(link.geoid)
  else if (!link.geoid && stored?.cityId === cityStore.cityId && inPack(stored.geoid)) cityStore.select(stored.geoid!)
  watch(selectedGeoid, (g) => { if (cityStore.cityId) writeSessionView({ cityId: cityStore.cityId, geoid: g }) }, { immediate: true })
  syncUrl()
  openCompareFromUrl()
  openHotspotsFromUrl()
  applyBelowMedianFromUrl()
  openFavoritesFromUrl()
  openFocusFromUrl()
  // Keep the address bar shareable as the view changes.
  watch([() => cityStore.cityId, selectedGeoid, basemap, theme, showTrees, showParks, showRoads, highlightBottomQuartile, belowMedian, densityUnit], syncUrl)
}

function currentLayers(): LayerFlags {
  return { trees: showTrees.value, parks: showParks.value, roads: showRoads.value, bq: highlightBottomQuartile.value, bm: belowMedian.value }
}
/** Presets omit `bm` (#59) so they leave the median dim as-is. */
function applyLayers(f: Omit<LayerFlags, 'bm'> & { bm?: boolean }) {
  showTrees.value = f.trees
  showParks.value = f.parks
  showRoads.value = f.roads
  highlightBottomQuartile.value = f.bq
  if (f.bm !== undefined) belowMedian.value = f.bm
}

/** One-tap layer presets (#37). They only set the four switches; switches stay the source of truth. */
const LAYER_PRESETS: { id: string; label: string; flags: Omit<LayerFlags, 'bm'> }[] = [
  { id: 'equity', label: 'Equity', flags: { trees: true, parks: true, roads: false, bq: true } },
  { id: 'plant', label: 'Plant-here', flags: { trees: true, parks: false, roads: true, bq: false } },
  { id: 'parks', label: 'Parks', flags: { trees: true, parks: true, roads: false, bq: false } },
]
const activePreset = computed(() => {
  const c = currentLayers()
  return LAYER_PRESETS.find((p) => (Object.keys(p.flags) as (keyof typeof p.flags)[]).every((k) => p.flags[k] === c[k]))?.id ?? null
})

function syncUrl() {
  writeDeepLink({ city: cityStore.cityId, geoid: selectedGeoid.value, basemap: basemap.value, theme: theme.value, layers: currentLayers(), unit: densityUnit.value })
}

const compareOpen = ref(false)

// #40 city overview strip — meta + already-loaded tracts only.
const overviewDensity = computed(() => {
  const m = meta.value
  if (!m) return ''
  return densityUnit.value === 'km2'
    ? `${(m.overall.treesPerAcre * ACRES_PER_KM2).toLocaleString(undefined, { maximumFractionDigits: 1 })} / km²`
    : `${m.overall.treesPerAcre.toFixed(2)} / acre`
})
const plantHere = computed<{ pct: number } | { segments: number } | null>(() => {
  let road = 0
  let low = 0
  for (const f of tracts.value?.features ?? []) {
    const { roadKm, lowTreeRoadKm } = f.properties
    if (roadKm != null && lowTreeRoadKm != null) { road += roadKm; low += lowTreeRoadKm }
  }
  if (road > 0) return { pct: Math.round((100 * low) / road) }
  const seg = meta.value?.counts.lowTreeRoadSegments ?? 0
  return seg > 0 ? { segments: seg } : null
})
const plantHereStat = computed(() => {
  const p = plantHere.value
  if (!p) return ''
  return 'pct' in p ? `${p.pct}% plant-here streets` : `${p.segments.toLocaleString()} plant-here segments`
})
const plantHereChip = computed(() => {
  const p = plantHere.value
  if (!p) return ''
  return 'pct' in p ? `${p.pct}% plant-here` : `${p.segments.toLocaleString()} segments`
})
const compareInitial = ref<[string, string] | null>(null)
function startCompare() {
  compareInitial.value = null
  compareOpen.value = true
}
/** ?compare=idA,idB with two different ready ids opens the dialog pre-filled; anything else is ignored. */
function openCompareFromUrl() {
  const raw = new URLSearchParams(window.location.search).get('compare')
  const ids = raw?.split(',').map((s) => s.trim()) ?? []
  const ok = (id: string) => cities.value.some((c) => c.id === id && isReady(c))
  if (ids.length === 2 && ids[0] !== ids[1] && ids.every(ok)) {
    compareInitial.value = [ids[0], ids[1]]
    compareOpen.value = true
  }
}

/** #59: need ≥2 finite densities in the loaded pack for a median. */
const medianAvailable = computed(() => (tracts.value?.features ?? []).filter((f) => Number.isFinite(f.properties.treesPerAcre)).length >= 2)
/** #59 ?belowMedian=1: one-shot alias → turn the dim on, strip the param; `layers=…,bm` then owns it. */
function applyBelowMedianFromUrl() {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('belowMedian')) return
  if (url.searchParams.get('belowMedian') === '1' && medianAvailable.value) belowMedian.value = true
  url.searchParams.delete('belowMedian')
  history.replaceState(history.state, '', url)
  syncUrl()
}

/** #43 ?hotspots=1 opens the panel once tracts are ready, then the flag is stripped from the URL. */
const pendingHotspotsFromUrl = ref(false)
function stripHotspotsParam() {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('hotspots')) return
  url.searchParams.delete('hotspots')
  history.replaceState(history.state, '', url)
}
function tryOpenHotspotsFromUrl() {
  if (!pendingHotspotsFromUrl.value) return
  if (!tracts.value?.features.length) return
  // Deep-link geoid wins; still strip the one-shot flag.
  if (selectedGeoid.value) {
    pendingHotspotsFromUrl.value = false
    stripHotspotsParam()
    return
  }
  pendingHotspotsFromUrl.value = false
  hotspotsOpen.value = true
  stripHotspotsParam()
}
function openHotspotsFromUrl() {
  if (new URLSearchParams(window.location.search).get('hotspots') !== '1') return
  pendingHotspotsFromUrl.value = true
  tryOpenHotspotsFromUrl()
  if (pendingHotspotsFromUrl.value) {
    const stop = watch([() => tracts.value?.features.length ?? 0, selectedGeoid, loading], () => {
      tryOpenHotspotsFromUrl()
      if (!pendingHotspotsFromUrl.value) stop()
    })
  }
}
/** #45 ?fav=1: same one-shot pending-flag pattern as #43 hotspots. */
const pendingFavFromUrl = ref(false)
function stripFavParam() {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('fav')) return
  url.searchParams.delete('fav')
  history.replaceState(history.state, '', url)
}
function tryOpenFavoritesFromUrl() {
  if (!pendingFavFromUrl.value) return
  if (!tracts.value?.features.length) return
  pendingFavFromUrl.value = false
  if (!selectedGeoid.value) favoritesOpen.value = true
  stripFavParam()
}
function openFavoritesFromUrl() {
  if (new URLSearchParams(window.location.search).get('fav') !== '1') return
  pendingFavFromUrl.value = true
  tryOpenFavoritesFromUrl()
  if (pendingFavFromUrl.value) {
    const stop = watch([() => tracts.value?.features.length ?? 0, selectedGeoid, loading], () => {
      tryOpenFavoritesFromUrl()
      if (!pendingFavFromUrl.value) stop()
    })
  }
}
/** #54 ?focus=1: one-shot, entered once data is ready, then stripped (never written by Share). */
const pendingFocusFromUrl = ref(false)
function stripFocusParam() {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('focus')) return
  url.searchParams.delete('focus')
  history.replaceState(history.state, '', url)
}
function tryFocusFromUrl() {
  if (!pendingFocusFromUrl.value || !meta.value || loading.value) return
  pendingFocusFromUrl.value = false
  setFocus(true)
  stripFocusParam()
}
function openFocusFromUrl() {
  if (new URLSearchParams(window.location.search).get('focus') !== '1') { stripFocusParam(); return }
  pendingFocusFromUrl.value = true
  tryFocusFromUrl()
  if (pendingFocusFromUrl.value) {
    const stop = watch([meta, loading], () => {
      tryFocusFromUrl()
      if (!pendingFocusFromUrl.value) stop()
    })
  }
}
function pickFromHotspots(geoid: string) {
  cityStore.select(geoid)
}

const linkSnack = ref('')
async function copyLink() {
  syncUrl()
  const href = window.location.href
  if (await copyText(href)) { linkSnack.value = 'Map link copied'; return }
  shareFallbackUrl.value = href
  shareFallbackOpen.value = true
}
/** #50 fallback when both Clipboard API and execCommand fail. */
const shareFallbackOpen = ref(false)
const shareFallbackUrl = ref('')
function selectShareUrl() {
  const el = document.querySelector<HTMLTextAreaElement>('#share-fallback textarea')
  el?.focus(); el?.select()
}

onMounted(init)

const satFallback = ref(false)

// #39 a11y: skip link, overlay focus in/out.
function skipToMap() {
  document.getElementById('map-stage')?.focus()
}
const findControl = () => (mdAndUp.value ? '#find-tract-btn' : '#more-actions-btn')
useOverlayFocus(layersOpen, firstFocusableIn('#layers-panel'))
useOverlayFocus(finderOpen, '#tract-finder-panel input', findControl, () => !drawerOpen.value)
useOverlayFocus(hotspotsOpen, '#hotspots-panel .hotspots-close', () => '#map-stage', () => !drawerOpen.value)
useOverlayFocus(favoritesOpen, '#favorites-panel .favorites-close', () => '#map-stage', () => !drawerOpen.value)
useOverlayFocus(compareOpen, '#compare-panel .compare-close', () => '#city-picker-btn')
useOverlayFocus(shortcutsOpen, '#shortcuts-panel .shortcuts-close', () => '#map-stage')
useOverlayFocus(resetConfirmOpen, '#reset-confirm .reset-cancel', () => '#about-reset-btn')

// #46 keyboard shortcuts. Esc: open overlays (Vuetify dialog/menu/sheet + #39 focus restore) own their Esc;
// only when none is open do we close the tract drawer / clear selection.
const anyOverlayOpen = () => layersOpen.value || finderOpen.value || hotspotsOpen.value || favoritesOpen.value || compareOpen.value
  || aboutOpen.value || shortcutsOpen.value || document.querySelector('.v-overlay--active:not(.v-tooltip)') !== null
const hotspotsAvailable = () => !!(meta.value && tracts.value?.features.length)
useKeyboardShortcuts({
  find: () => { if (anyOverlayOpen()) return; finderOpen.value = true },
  // #54: overlays → tract drawer → exit focus → no-op.
  escape: () => {
    if (anyOverlayOpen()) return
    if (selectedGeoid.value) drawerOpen.value = false
    else if (focusMode.value) setFocus(false)
  },
  toggleTheme: () => ui.toggleTheme(),
  toggleBasemap: () => ui.setBasemap(basemap.value === 'satellite' ? 'streets' : 'satellite'),
  toggleHotspots: () => {
    if (hotspotsOpen.value) { hotspotsOpen.value = false; return }
    if (!anyOverlayOpen() && hotspotsAvailable()) hotspotsOpen.value = true
  },
  help: () => { if (!anyOverlayOpen()) shortcutsOpen.value = true },
})
const SHORTCUTS: [string, string][] = [
  ['/', 'Find tract'], ['Esc', 'Close panel, clear selection, or exit focus'], ['d', 'Toggle dark mode'],
  ['s', 'Toggle satellite basemap'], ['h', 'Low-canopy hotspots'], ['?', 'Keyboard shortcuts'],
]
const tractFromFinder = ref(false)
function pickFromFinder(geoid: string) {
  tractFromFinder.value = true
  cityStore.select(geoid)
}
watch(drawerOpen, async (open) => {
  if (open) {
    await focusSoon('#tract-details-panel .tract-close')
  } else {
    const target = tractFromFinder.value ? findControl() : '#map-stage'
    tractFromFinder.value = false
    await focusSoon(target)
  }
})
</script>

<template>
  <v-app class="app-root">
    <a href="#map-stage" class="skip-link" @click.prevent="skipToMap">Skip to map</a>
    <v-app-bar color="primary" density="comfortable" flat>
      <template #prepend>
        <v-icon icon="mdi-tree" class="ml-2" />
      </template>
      <v-app-bar-title>
        <span class="font-weight-bold">Street Tree Equity</span>
        <span v-if="meta" class="text-body-2 ml-2 opacity-80">{{ meta.cityName }}<span v-if="mdAndUp && meta.subtitle"> · {{ meta.subtitle }}</span></span>
      </v-app-bar-title>

      <PlacePicker v-if="cities.length" :label="meta?.cityName ?? ''" :mobile="!mdAndUp"
        @select="selectCity" @compare="startCompare" />
      <CompareCities v-model="compareOpen" :initial="compareInitial" :mobile="!mdAndUp"
        @open="selectCity" @copied="(m: string) => (linkSnack = m)" />


      <component v-if="!focusMode" :is="mdAndUp ? VMenu : VBottomSheet" v-model="layersOpen" v-bind="mdAndUp ? { closeOnContentClick: false, location: 'bottom end' } : {}">
        <template #activator="{ props: act }">
          <v-btn v-bind="act" icon aria-label="Layers">
            <v-icon icon="mdi-layers-outline" />
            <v-tooltip activator="parent" location="bottom">Basemap and layers</v-tooltip>
          </v-btn>
        </template>
        <v-card id="layers-panel" :min-width="mdAndUp ? 260 : undefined" :max-width="mdAndUp ? undefined : '100%'">
          <v-card-title class="text-subtitle-1">Layers</v-card-title>
          <v-card-text class="pt-0">
            <div class="text-caption mb-1">Basemap</div>
            <v-btn-toggle
              :model-value="basemap"
              mandatory divided :density="mdAndUp ? 'compact' : 'comfortable'" :class="{ 'd-flex w-100': !mdAndUp }" variant="outlined" aria-label="Basemap"
              @update:model-value="(v: 'streets' | 'satellite') => ui.setBasemap(v)"
            >
              <v-btn value="streets" :class="{ 'flex-grow-1': !mdAndUp }">Streets</v-btn>
              <v-btn value="satellite" :class="{ 'flex-grow-1': !mdAndUp }">Satellite</v-btn>
            </v-btn-toggle>
            <v-divider class="my-3" />
            <div class="text-caption mb-1">Presets</div>
            <div class="d-flex flex-wrap ga-2" role="group" aria-label="Layer presets">
              <v-chip
                v-for="p in LAYER_PRESETS" :key="p.id"
                :color="activePreset === p.id ? 'primary' : undefined"
                :variant="activePreset === p.id ? 'tonal' : 'outlined'"
                :aria-pressed="activePreset === p.id ? 'true' : 'false'"
                :size="mdAndUp ? 'default' : 'large'"
                :class="{ 'preset-chip-touch': !mdAndUp }"
                @click.stop="applyLayers(p.flags)"
              >{{ p.label }}</v-chip>
            </div>
            <div class="text-caption text-medium-emphasis mt-1 mb-2">One tap sets the switches below. You can still tweak them.</div>
            <div class="text-caption mb-1">Density unit</div>
            <v-btn-toggle :model-value="densityUnit" mandatory density="compact" variant="outlined" divided color="primary"
              class="mb-2 unit-toggle" aria-label="Tree density unit" @click.stop
              @update:model-value="(v: 'acre' | 'km2') => ui.setDensityUnit(v)">
              <v-btn value="acre" size="small">Per acre</v-btn>
              <v-btn value="km2" size="small">Per km²</v-btn>
            </v-btn-toggle>
            <div class="text-caption mb-n1">Tract fill</div>
            <v-slider :model-value="fillOpacity" :min="0.3" :max="1" :step="0.05" density="compact" color="primary"
              hide-details thumb-label class="fill-opacity-slider mb-1" aria-label="Tract fill opacity" @click.stop
              @update:model-value="(v: number) => ui.setFillOpacity(v)">
              <template #thumb-label="{ modelValue }">{{ Math.round(modelValue * 100) }}%</template>
              <template #prepend><span class="text-caption text-medium-emphasis">Fainter</span></template>
              <template #append><span class="text-caption text-medium-emphasis">Stronger</span></template>
            </v-slider>
            <div class="text-caption mb-1">Color ramp</div>
            <v-btn-toggle :model-value="choroplethMode" mandatory density="compact" variant="outlined" divided color="primary"
              class="unit-toggle" aria-label="Choropleth color ramp" @click.stop
              @update:model-value="(v: 'green' | 'contrast') => ui.setChoroplethMode(v)">
              <v-btn value="green" size="small">Green</v-btn>
              <v-btn value="contrast" size="small">High contrast</v-btn>
            </v-btn-toggle>
            <div class="text-caption text-medium-emphasis mt-1 mb-1">Same density bins — different colors.</div>
            <v-switch v-if="treesAvailable" v-model="showTrees" label="Individual trees (visible when zoomed in)" color="primary" hide-details density="compact" />
            <v-switch v-model="showParks" label="Parks" color="primary" hide-details density="compact" />
            <v-switch v-model="showRoads" label="Plant-here streets (orange)" color="orange-darken-2" hide-details density="compact" />
            <v-switch v-model="highlightBottomQuartile" label="Outline the 25% of tracts with the fewest trees" color="deep-orange" hide-details density="compact" />
            <v-switch v-model="belowMedian" label="Below city median" color="primary" hide-details density="compact" :disabled="!medianAvailable" />
            <div class="text-caption text-medium-emphasis ms-1 mb-1">Dims tracts above this city’s median trees/acre</div>
          </v-card-text>
        </v-card>
      </component>
      <TractFinder v-model="finderOpen" :mobile="!mdAndUp" :tracts="tracts?.features ?? null" :loading="loading"
        :city-id="city?.id ?? null" @pick="pickFromFinder" />
      <HotspotsPanel v-model="hotspotsOpen" :mobile="!mdAndUp" :tracts="tracts?.features ?? null" :loading="loading"
        :city-name="meta?.cityName ?? ''" :unit="densityUnit" @pick="pickFromHotspots" />
      <FavoritesPanel v-model="favoritesOpen" :mobile="!mdAndUp" :tracts="tracts?.features ?? null" :loading="loading"
        :city-name="meta?.cityName ?? ''" :unit="densityUnit" :city-id="city?.id ?? null" @pick="pickFromHotspots" />
      <template v-if="mdAndUp">
        <v-btn v-if="!focusMode" id="find-tract-btn" icon aria-label="Find tract" @click="finderOpen = true">
          <v-icon icon="mdi-magnify" />
          <v-tooltip activator="parent" location="bottom">Find tract</v-tooltip>
        </v-btn>
        <v-btn v-if="!focusMode" icon :aria-label="resetLabel" @click="mapRef?.fitData()">
          <v-icon icon="mdi-fit-to-screen-outline" />
          <v-tooltip activator="parent" location="bottom">{{ resetLabel }}</v-tooltip>
        </v-btn>
        <v-btn icon aria-label="Share map link" @click="copyLink">
          <v-icon icon="mdi-link-variant" />
          <v-tooltip activator="parent" location="bottom">Share map link</v-tooltip>
        </v-btn>
        <v-btn icon aria-label="Print map" @click="printMap">
          <v-icon icon="mdi-printer" />
          <v-tooltip activator="parent" location="bottom">Print map</v-tooltip>
        </v-btn>
        <v-btn icon :aria-label="focusLabel" :aria-pressed="focusMode ? 'true' : 'false'" @click="toggleFocus">
          <v-icon :icon="focusMode ? 'mdi-fullscreen-exit' : 'mdi-fullscreen'" />
          <v-tooltip activator="parent" location="bottom">{{ focusLabel }}</v-tooltip>
        </v-btn>
        <v-btn v-if="!focusMode" icon aria-label="About" @click="aboutOpen = true">
          <v-icon icon="mdi-information-outline" />
          <v-tooltip activator="parent" location="bottom">About</v-tooltip>
        </v-btn>
      </template>
      <v-btn icon :aria-label="themeLabel" @click="ui.toggleTheme()">
        <v-icon :icon="isDark ? 'mdi-white-balance-sunny' : 'mdi-weather-night'" />
        <v-tooltip activator="parent" location="bottom">{{ themeLabel }}</v-tooltip>
      </v-btn>
      <template v-if="!mdAndUp && focusMode">
        <v-btn icon aria-label="Share map link" @click="copyLink"><v-icon icon="mdi-link-variant" /></v-btn>
        <v-btn icon aria-label="Exit focus" aria-pressed="true" @click="setFocus(false)"><v-icon icon="mdi-fullscreen-exit" /></v-btn>
      </template>
      <v-menu v-if="!mdAndUp && !focusMode" location="bottom end">
        <template #activator="{ props: act }">
          <v-btn id="more-actions-btn" v-bind="act" icon="mdi-dots-vertical" aria-label="More actions" />
        </template>
        <v-list density="comfortable">
          <v-list-item prepend-icon="mdi-magnify" title="Find tract" @click="finderOpen = true" />
          <v-list-item v-if="meta && tracts?.features.length" prepend-icon="mdi-tree-outline" title="Low-canopy hotspots" @click="hotspotsOpen = true" />
          <v-list-item v-if="meta" prepend-icon="mdi-star-outline" title="Starred tracts" @click="favoritesOpen = true" />
          <v-list-item prepend-icon="mdi-fit-to-screen-outline" title="Fit map to city" @click="mapRef?.fitData()" />
          <v-list-item prepend-icon="mdi-link-variant" title="Share map link" @click="copyLink" />
          <v-list-item prepend-icon="mdi-printer" title="Print map" @click="printMap" />
          <v-list-item prepend-icon="mdi-fullscreen" title="Focus map" @click="setFocus(true)" />
          <v-list-item prepend-icon="mdi-keyboard-outline" title="Keyboard shortcuts" @click="shortcutsOpen = true" />
          <v-list-item prepend-icon="mdi-information-outline" title="About" @click="aboutOpen = true" />
        </v-list>
      </v-menu>
      <span class="sr-only" aria-live="polite">{{ themeAnnounce }}</span>
    </v-app-bar>

    <v-navigation-drawer v-model="drawerOpen" :location="mdAndUp ? 'right' : 'bottom'" :width="380" temporary
      :scrim="false" :class="{ 'bottom-drawer': !mdAndUp }">
      <TractDetails v-if="selectedTract && meta" :tract="selectedTract" :meta="meta"
        :roads="roads" :total="tracts?.features.length ?? 0" @fly-to-road="(f) => mapRef?.fitRoad(f)" @close="cityStore.select(null)" @fly-to-park="flyToPark" />
    </v-navigation-drawer>

    <v-main class="d-flex flex-column">
      <div id="map-stage" class="main-stage" tabindex="-1" role="region" aria-label="Map">
      <MapView
        @satellite-error="satFallback = true" v-if="city && meta && tracts && parks " :key="city.id" ref="mapRef" :initial-view="initialView" :mobile="!mdAndUp" :data-path="city.dataPath" :meta="meta" :tracts="tracts" :parks="parks" :roads="roads" :trees="trees" />

      <div v-if="loading" class="d-flex flex-column fill-height align-center justify-center">
        <v-progress-circular indeterminate color="primary" size="48" aria-label="Loading map data" />
        <div class="text-body-2 mt-3">Loading tree data for {{ loadingName }}…</div>
      </div>
      <v-alert v-if="error" type="error" class="ma-4" title="Map data didn't load">
        <p>Check your connection and try again. If it keeps happening, the data files may be updating — please open an issue.</p>
        <div class="d-flex flex-wrap ga-2 mt-3">
          <v-btn variant="flat" color="white" @click="retry">Try again</v-btn>
          <v-btn variant="outlined" :href="ISSUE_URL" target="_blank" rel="noopener noreferrer">Open a GitHub issue<span class="sr-only"> (opens in new tab)</span></v-btn>
        </div>
        <v-expansion-panels class="mt-3" variant="accordion">
          <v-expansion-panel title="Details" :text="error" />
        </v-expansion-panels>
        <div class="text-body-2 mt-2">Pick another city from the place menu above.</div>
      </v-alert>
      <CreditStrip v-if="city && meta" />
      <v-sheet v-if="meta && (mdAndUp || !drawerOpen || printing)" class="map-legend-box pa-2" rounded elevation="2" color="surface">
        <div v-if="legendExpanded" id="legend-panel">
          <div class="d-flex align-center justify-space-between mb-1">
            <span class="text-subtitle-2">Legend</span>
            <v-btn v-if="mdAndUp" icon="mdi-chevron-down" variant="text" size="small" aria-label="Hide legend" title="Hide legend"
              :aria-expanded="true" aria-controls="legend-panel" @click="legendExpanded = false" />
            <v-btn v-else variant="text" size="small" class="text-none legend-toggle" prepend-icon="mdi-chevron-down"
              :aria-expanded="true" aria-controls="legend-panel" @click="legendExpanded = false">Hide legend</v-btn>
          </div>
          <MapLegend :below-median="belowMedian && medianAvailable" :meta="meta" :trees-available="treesAvailable" :dense="mdAndUp" />
        </div>
        <v-btn v-else variant="tonal" size="small" class="text-none legend-toggle" prepend-icon="mdi-palette-swatch-outline"
          :aria-expanded="false" aria-controls="legend-panel" @click="legendExpanded = true">Legend</v-btn>
      </v-sheet>

      <v-sheet v-if="meta && !selectedTract && mdAndUp && !focusMode" class="hint no-print pa-3" rounded elevation="2" color="surface" max-width="320"
        role="region" :aria-label="`${meta.cityName} overview`">
        <div class="text-subtitle-2">{{ meta.cityName }}</div>
        <div v-if="meta.subtitle" class="text-caption text-medium-emphasis">{{ meta.subtitle }}</div>
        <div class="text-body-2 mt-1">
          <div><strong>{{ meta.counts.trees.toLocaleString() }}</strong> mapped trees · <strong>{{ meta.counts.tracts }}</strong> tracts</div>
          <div>Avg <strong>{{ overviewDensity }}</strong></div>
          <div v-if="plantHereStat">{{ plantHereStat }}</div>
        </div>
        <div class="text-caption mt-1">Click a tract for details.</div>
        <div class="d-flex ga-1 mt-1">
          <v-btn variant="tonal" size="small" class="overview-action" color="primary" @click="startCompare">Compare cities</v-btn>
          <v-btn v-if="tracts?.features.length" variant="text" size="small" class="overview-action" @click="hotspotsOpen = true">Hotspots</v-btn>
          <v-btn variant="text" size="small" class="overview-action" @click="favoritesOpen = true">Starred</v-btn>
          <v-btn variant="text" size="small" class="overview-action" @click="aboutOpen = true">About</v-btn>
        </div>
      </v-sheet>
      <v-sheet v-if="meta && !selectedTract && !drawerOpen && !mdAndUp && !focusMode" class="overview-strip no-print pa-2 d-flex align-center" rounded elevation="2" color="surface"
        role="region" :aria-label="`${meta.cityName} overview`">
        <div class="d-flex flex-wrap ga-1 flex-grow-1 text-caption">
          <v-chip size="small" variant="tonal">{{ meta.counts.trees.toLocaleString() }} trees</v-chip>
          <v-chip size="small" variant="tonal">{{ meta.counts.tracts }} tracts</v-chip>
          <v-chip size="small" variant="tonal">avg {{ overviewDensity.replace(' / ', '/') }}</v-chip>
          <v-chip v-if="plantHereChip" size="small" variant="tonal" color="deep-orange">{{ plantHereChip }}</v-chip>
        </div>
        <v-btn icon="mdi-compare" variant="text" size="small" class="overview-icon" aria-label="Compare cities" @click="startCompare" />
        <v-btn v-if="tracts?.features.length" icon="mdi-tree-outline" variant="text" size="small" class="overview-icon" aria-label="Low-canopy hotspots" @click="hotspotsOpen = true" />
        <v-btn icon="mdi-star-outline" variant="text" size="small" class="overview-icon" aria-label="Starred tracts" @click="favoritesOpen = true" />
        <v-btn icon="mdi-information-outline" variant="text" size="small" class="overview-icon" aria-label="About" @click="aboutOpen = true" />
      </v-sheet>
      </div>
    </v-main>

    <v-dialog v-model="shortcutsOpen" max-width="360">
      <v-card id="shortcuts-panel" title="Keyboard shortcuts">
        <v-card-text>
          <dl class="shortcuts-list">
            <template v-for="[k, label] in SHORTCUTS" :key="k">
              <dt><kbd>{{ k }}</kbd></dt><dd>{{ label }}</dd>
            </template>
          </dl>
          <p class="text-caption mt-3 text-medium-emphasis">Shortcuts are off while typing in a field.</p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn class="shortcuts-close" color="primary" variant="text" @click="shortcutsOpen = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="aboutOpen" :max-width="mdAndUp ? 560 : '100%'" :fullscreen="!mdAndUp" scrollable>
      <v-card title="About this map">
        <v-card-text>
          <h3 class="text-subtitle-1 font-weight-bold mb-1">What it is</h3>
          <p class="text-body-2 mb-2">Trees per acre of land by U.S. Census tract, counted from OpenStreetMap <code>natural=tree</code>.</p>
          <p class="text-body-2 mb-2">Low counts can mean fewer trees <em>or</em> fewer trees mapped — treat it as a conversation starter, and consider adding trees on OSM.</p>
          <p class="text-body-2 mb-2">Orange streets have no mapped tree within {{ meta?.roadsBufferMeters ?? 20 }} m. Parks come from OSM <code>leisure=park</code>.</p>
          <p class="text-body-2 mb-4">Static data files and no-key basemaps — no database, no API keys.</p>

          <h3 class="text-subtitle-1 font-weight-bold mb-1">Data sources</h3>
          <ul class="about-sources text-body-2 mb-4">
            <li><strong>Street trees &amp; parks</strong> — © OpenStreetMap contributors · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">ODbL<span class="sr-only"> (opens in new tab)</span></a><span v-if="updated"> · OSM data as of {{ updated }}</span></li>
            <li><strong>Tract boundaries</strong> — U.S. Census Bureau cartographic boundaries (public domain)<span v-if="meta?.censusVintage"> · {{ meta.censusVintage }}</span></li>
            <li><strong>Streets basemap</strong> — <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap<span class="sr-only"> (opens in new tab)</span></a> · OpenMapTiles · OSM data</li>
            <li><strong>Satellite</strong> — <a href="https://cloudless.eox.at" target="_blank" rel="noopener noreferrer">EOxCloudless 2025<span class="sr-only"> (opens in new tab)</span></a> by EOX · modified Copernicus Sentinel data 2025 · <strong>CC BY-NC-SA (non-commercial)</strong></li>
          </ul>

          <h3 class="text-subtitle-1 font-weight-bold mb-1">Scope &amp; code</h3>
          <p class="text-body-2 mb-2"><strong>Packaged cities only:</strong> this site shows only the cities that ship with it — it is not a live national search.</p>
          <p class="text-body-2 mb-0"><strong>Source code:</strong> <a href="https://github.com/Zevl411/street-tree-equity" target="_blank" rel="noopener noreferrer">github.com/Zevl411/street-tree-equity<span class="sr-only"> (opens in new tab)</span></a></p>

          <div class="about-reset mt-4">
            <p class="text-caption text-medium-emphasis mb-1">This browser remembers your city, map view, layers, and starred tracts.</p>
            <v-btn id="about-reset-btn" variant="text" color="error" prepend-icon="mdi-restore" @click="resetConfirmOpen = true">Reset saved preferences</v-btn>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-btn variant="text" prepend-icon="mdi-content-copy" @click="copyCitations">Copy citations</v-btn>
          <v-spacer />
          <v-btn color="primary" variant="text" @click="aboutOpen = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <v-dialog v-model="resetConfirmOpen" max-width="400">
      <v-card id="reset-confirm" title="Reset saved preferences?">
        <v-card-text class="text-body-2">Clears this browser’s saved city, map view, starred tracts, theme, basemap, and layer choices. Packaged city data on the site is not deleted.</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn class="reset-cancel" variant="text" @click="resetConfirmOpen = false">Cancel</v-btn>
          <v-btn color="error" variant="flat" @click="confirmReset">Reset</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <v-snackbar v-model="citationsSnack" timeout="2500" class="safe-snack">Citations copied</v-snackbar>
    <v-dialog v-model="citationsFallbackOpen" max-width="480" @after-enter="selectCitations">
      <v-card id="citations-fallback" title="Copy citations">
        <v-card-text>
          <v-textarea :model-value="citationsText" readonly autofocus rows="7" variant="outlined" density="compact" label="Citations" @focus="(e: FocusEvent) => (e.target as HTMLTextAreaElement).select()" />
        </v-card-text>
        <v-card-actions><v-spacer /><v-btn color="primary" variant="text" @click="citationsFallbackOpen = false">Close</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
    <v-snackbar v-model="satFallback" timeout="5000" class="safe-snack">Satellite imagery unavailable — showing streets.</v-snackbar>
    <v-dialog v-model="shareFallbackOpen" max-width="420" @after-enter="selectShareUrl">
      <v-card id="share-fallback" title="Share map link">
        <v-card-text>
          <v-textarea :model-value="shareFallbackUrl" readonly autofocus rows="3" variant="outlined" density="compact"
            aria-label="Map link" hide-details @focus="(e: FocusEvent) => (e.target as HTMLTextAreaElement).select()" />
          <div class="text-caption text-medium-emphasis mt-2">Clipboard blocked — select the link and copy.</div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="selectShareUrl">Select all</v-btn>
          <v-btn variant="text" @click="shareFallbackOpen = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <v-snackbar :model-value="!!linkSnack" timeout="3000" class="safe-snack" @update:model-value="(v: boolean) => { if (!v) linkSnack = '' }">{{ linkSnack }}</v-snackbar>
  </v-app>
</template>

<style scoped>
.unit-toggle .v-btn { min-height: 44px; }
.skip-link {
  position: absolute;
  left: 8px;
  top: 8px;
  z-index: 3000;
  padding: 8px 12px;
  border-radius: 4px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  transform: translateY(-200%);
}
.skip-link:focus-visible, .skip-link:focus { transform: none; }
#map-stage:focus { outline: none; }
#map-stage:focus-visible { outline-offset: -2px; }
.preset-chip-touch { min-height: 44px; }
/* Normal-flow stage inside v-main's padded box, so absolute map/overlays
   sit below the app bar instead of under it (#34). */
.main-stage {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
}
.hint {
  position: absolute;
  left: 12px;
  /* .main-stage already starts below the app bar (v-main padding). */
  top: 12px;
  z-index: 2;
}
.overview-strip {
  position: absolute;
  top: 8px;
  left: 8px;
  right: 8px;
  z-index: 2;
}
.overview-action { min-height: 44px; }
.overview-icon { min-width: 44px; min-height: 44px; }
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
.app-root {
  overflow-x: hidden;
}
.map-legend-box {
  position: absolute;
  left: calc(8px + env(safe-area-inset-left, 0px));
  bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  /* stay clear of bottom-right CreditStrip (#42) */
  max-width: min(320px, 46vw);
  max-height: calc(60dvh - env(safe-area-inset-bottom, 0px));
  overflow-y: auto;
  z-index: 2;
}
.legend-toggle {
  min-height: 44px;
}
.shortcuts-list { display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; align-items: center; margin: 0; }
.shortcuts-list dd { margin: 0; }
.shortcuts-list kbd { display: inline-block; min-width: 2em; text-align: center; padding: 2px 6px; border-radius: 4px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.3); font-family: ui-monospace, monospace; font-size: 0.85em; }
.bottom-drawer {
  max-height: min(85vh, calc(100dvh - var(--v-layout-top, 0px))) !important;
  height: auto !important;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.about-sources { padding-left: 1.1rem; }
.about-sources li { margin-bottom: 4px; }
</style>

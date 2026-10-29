<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useDisplay } from 'vuetify'
import { VBottomSheet, VMenu } from 'vuetify/components'
import MapView from '@/components/MapView.vue'
import MapLegend from '@/components/MapLegend.vue'
import TractDetails from '@/components/TractDetails.vue'
import PlacePicker from '@/components/PlacePicker.vue'
import CompareCities from '@/components/CompareCities.vue'
import TractFinder from '@/components/TractFinder.vue'
import { useData } from '@/composables/useData'
import { useCityStore } from '@/stores/city'
import { ACRES_PER_KM2, useUiStore } from '@/stores/ui'
import { readDeepLink, writeDeepLink, type LayerFlags } from '@/composables/useDeepLink'
import { isReady, type NearbyPark } from '@/types'
import { useOverlayFocus, firstFocusableIn, focusSoon } from '@/composables/useOverlayFocus'

const { meta, tracts, parks, roads, loading, error, load } = useData()
const ISSUE_URL = 'https://github.com/Zevl411/street-tree-equity/issues/new'

const cityStore = useCityStore()
const { cities, city, selectedGeoid } = storeToRefs(cityStore)
const ui = useUiStore()
const { theme, isDark, basemap, themeAnnounce, showTrees, showParks, showRoads, highlightBottomQuartile, aboutOpen, densityUnit } = storeToRefs(ui)

const loadingName = computed(() => city.value?.cityName ?? meta.value?.cityName ?? 'this place')
const { mdAndUp } = useDisplay()
const themeLabel = computed(() => (isDark.value ? 'Switch to light mode' : 'Switch to dark mode'))
const resetLabel = computed(() => `Show all of ${meta.value?.subtitle || meta.value?.cityName || 'the map'}`)
const layersOpen = ref(false)
const finderOpen = ref(false)
const legendExpanded = ref(false)
const mapRef = ref<InstanceType<typeof MapView> | null>(null)

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

async function selectCity(id: string) {
  const res = cityStore.setCity(id)
  if (!res) return
  if (res.changed || !meta.value) await load(res.entry.dataPath)
  mapRef.value?.fitData()
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
  await selectCity(cityStore.initialCityId())
  if (link.geoid && tracts.value?.features.some((f) => f.properties.geoid === link.geoid)) cityStore.select(link.geoid)
  syncUrl()
  openCompareFromUrl()
  // Keep the address bar shareable as the view changes.
  watch([() => cityStore.cityId, selectedGeoid, basemap, theme, showTrees, showParks, showRoads, highlightBottomQuartile, densityUnit], syncUrl)
}

function currentLayers(): LayerFlags {
  return { trees: showTrees.value, parks: showParks.value, roads: showRoads.value, bq: highlightBottomQuartile.value }
}
function applyLayers(f: LayerFlags) {
  showTrees.value = f.trees
  showParks.value = f.parks
  showRoads.value = f.roads
  highlightBottomQuartile.value = f.bq
}

/** One-tap layer presets (#37). They only set the four switches; switches stay the source of truth. */
const LAYER_PRESETS: { id: string; label: string; flags: LayerFlags }[] = [
  { id: 'equity', label: 'Equity', flags: { trees: true, parks: true, roads: false, bq: true } },
  { id: 'plant', label: 'Plant-here', flags: { trees: true, parks: false, roads: true, bq: false } },
  { id: 'parks', label: 'Parks', flags: { trees: true, parks: true, roads: false, bq: false } },
]
const activePreset = computed(() => {
  const c = currentLayers()
  return LAYER_PRESETS.find((p) => (Object.keys(c) as (keyof LayerFlags)[]).every((k) => p.flags[k] === c[k]))?.id ?? null
})

function syncUrl() {
  writeDeepLink({ city: cityStore.cityId, geoid: selectedGeoid.value, basemap: basemap.value, theme: theme.value, layers: currentLayers(), unit: densityUnit.value })
}

const compareOpen = ref(false)
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

const linkSnack = ref('')
async function copyLink() {
  syncUrl()
  try {
    await navigator.clipboard.writeText(window.location.href)
    linkSnack.value = 'Link copied'
  } catch {
    linkSnack.value = 'Couldn’t copy link — copy it from the address bar.'
  }
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
useOverlayFocus(compareOpen, '#compare-panel .compare-close', () => '#city-picker-btn')
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

      <v-sheet v-if="meta && mdAndUp" class="px-3 py-1 mr-2" rounded color="surface">
        <MapLegend :meta="meta" dense />
      </v-sheet>

      <component :is="mdAndUp ? VMenu : VBottomSheet" v-model="layersOpen" v-bind="mdAndUp ? { closeOnContentClick: false, location: 'bottom end' } : {}">
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
            <v-switch v-model="showTrees" label="Individual trees (visible when zoomed in)" color="primary" hide-details density="compact" />
            <v-switch v-model="showParks" label="Parks" color="primary" hide-details density="compact" />
            <v-switch v-model="showRoads" label="Plant-here streets (orange)" color="orange-darken-2" hide-details density="compact" />
            <v-switch v-model="highlightBottomQuartile" label="Outline the 25% of tracts with the fewest trees" color="deep-orange" hide-details density="compact" />
          </v-card-text>
        </v-card>
      </component>
      <TractFinder v-model="finderOpen" :mobile="!mdAndUp" :tracts="tracts?.features ?? null" :loading="loading"
        :city-id="city?.id ?? null" @pick="pickFromFinder" />
      <template v-if="mdAndUp">
        <v-btn id="find-tract-btn" icon aria-label="Find tract" @click="finderOpen = true">
          <v-icon icon="mdi-magnify" />
          <v-tooltip activator="parent" location="bottom">Find tract</v-tooltip>
        </v-btn>
        <v-btn icon :aria-label="resetLabel" @click="mapRef?.fitData()">
          <v-icon icon="mdi-fit-to-screen-outline" />
          <v-tooltip activator="parent" location="bottom">{{ resetLabel }}</v-tooltip>
        </v-btn>
        <v-btn icon aria-label="Copy link to this view" @click="copyLink">
          <v-icon icon="mdi-link-variant" />
          <v-tooltip activator="parent" location="bottom">Copy link to this view</v-tooltip>
        </v-btn>
        <v-btn icon aria-label="About" @click="aboutOpen = true">
          <v-icon icon="mdi-information-outline" />
          <v-tooltip activator="parent" location="bottom">About</v-tooltip>
        </v-btn>
      </template>
      <v-btn icon :aria-label="themeLabel" @click="ui.toggleTheme()">
        <v-icon :icon="isDark ? 'mdi-white-balance-sunny' : 'mdi-weather-night'" />
        <v-tooltip activator="parent" location="bottom">{{ themeLabel }}</v-tooltip>
      </v-btn>
      <v-menu v-if="!mdAndUp" location="bottom end">
        <template #activator="{ props: act }">
          <v-btn id="more-actions-btn" v-bind="act" icon="mdi-dots-vertical" aria-label="More actions" />
        </template>
        <v-list density="comfortable">
          <v-list-item prepend-icon="mdi-magnify" title="Find tract" @click="finderOpen = true" />
          <v-list-item prepend-icon="mdi-fit-to-screen-outline" title="Fit map to city" @click="mapRef?.fitData()" />
          <v-list-item prepend-icon="mdi-link-variant" title="Copy link to this view" @click="copyLink" />
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
        @satellite-error="satFallback = true" v-if="city && meta && tracts && parks " :key="city.id" ref="mapRef" :mobile="!mdAndUp" :data-path="city.dataPath" :meta="meta" :tracts="tracts" :parks="parks" :roads="roads" />

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
      <v-sheet v-if="meta && !mdAndUp && !drawerOpen" class="mobile-legend pa-2" rounded elevation="2" color="surface">
        <MapLegend v-if="legendExpanded" :meta="meta" />
        <v-btn variant="text" size="small" density="comfortable" class="text-none legend-toggle"
          :prepend-icon="legendExpanded ? 'mdi-chevron-down' : 'mdi-palette-swatch-outline'"
          :aria-expanded="legendExpanded" @click="legendExpanded = !legendExpanded">
          {{ legendExpanded ? 'Hide legend' : 'Legend' }}
        </v-btn>
      </v-sheet>

      <v-sheet v-if="meta && !selectedTract && mdAndUp" class="hint pa-3" rounded elevation="2" color="surface" max-width="300">
        <div class="text-body-2">
          <strong>{{ meta.counts.trees.toLocaleString() }}</strong> mapped trees across
          <strong>{{ meta.counts.tracts }}</strong> census tracts
          (avg {{ ui.densityUnit === 'km2'
            ? `${(meta.overall.treesPerAcre * ACRES_PER_KM2).toLocaleString(undefined, { maximumFractionDigits: 1 })} / km²`
            : `${meta.overall.treesPerAcre.toFixed(2)} / acre` }}).
        </div>
        <div class="text-caption mt-1">Click a tract for details and nearby parks.</div>
      </v-sheet>
      </div>
    </v-main>

    <v-dialog v-model="aboutOpen" :max-width="mdAndUp ? 560 : '100%'" :fullscreen="!mdAndUp" scrollable>
      <v-card title="About this map">
        <v-card-text>
          <p class="mb-3">
            Trees per acre of land by U.S. Census tract, counted from trees mapped in OpenStreetMap
            (<code>natural=tree</code>). Low numbers can mean fewer trees <em>or</em> fewer trees mapped yet —
            treat this as a conversation starter, and consider adding trees to OSM.
          </p>
          <p class="mb-3">
            Orange streets have no mapped tree within {{ meta?.roadsBufferMeters ?? 20 }} m — candidate
            “plant here” spots. Parks come from OSM <code>leisure=park</code>.
          </p>
          <p class="mb-3">
            100% free: static data files shipped with the site, a no-key basemap, no database, no API keys.
          </p>
          <div class="text-caption">
            Data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors<span class="sr-only"> (opens in new tab)</span></a> (ODbL) ·
            Tracts: U.S. Census Bureau {{ meta?.censusVintage }} ·
            Basemap: <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap<span class="sr-only"> (opens in new tab)</span></a> / OpenMapTiles ·
            Satellite: <a href="https://cloudless.eox.at" target="_blank" rel="noopener noreferrer">EOxCloudless<span class="sr-only"> (opens in new tab)</span></a> by EOX — modified Copernicus Sentinel data 2025 · CC BY-NC-SA (non-commercial).
            <span v-if="updated"> OSM data as of {{ updated }}.</span>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn color="primary" variant="text" @click="aboutOpen = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <v-snackbar v-model="satFallback" timeout="5000" class="safe-snack">Satellite imagery unavailable — showing streets.</v-snackbar>
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
.mobile-legend {
  position: absolute;
  left: 8px;
  bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  max-width: calc(100vw - 120px);
  z-index: 2;
}
.legend-toggle {
  min-height: 44px;
}
.bottom-drawer {
  max-height: min(85vh, calc(100dvh - var(--v-layout-top, 0px))) !important;
  height: auto !important;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
</style>

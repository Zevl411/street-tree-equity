<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useDisplay } from 'vuetify'
import MapView from '@/components/MapView.vue'
import MapLegend from '@/components/MapLegend.vue'
import TractDetails from '@/components/TractDetails.vue'
import PlacePicker from '@/components/PlacePicker.vue'
import { useData } from '@/composables/useData'
import { useCityStore } from '@/stores/city'
import { useUiStore } from '@/stores/ui'
import { readDeepLink, writeDeepLink } from '@/composables/useDeepLink'
import type { NearbyPark } from '@/types'

const { meta, tracts, parks, roads, loading, error, load } = useData()
const ISSUE_URL = 'https://github.com/Zevl411/street-tree-equity/issues/new'

const cityStore = useCityStore()
const { cities, city, selectedGeoid } = storeToRefs(cityStore)
const ui = useUiStore()
const { theme, isDark, basemap, themeAnnounce, showTrees, showParks, showRoads, highlightBottomQuartile, aboutOpen } = storeToRefs(ui)

const loadingName = computed(() => city.value?.cityName ?? meta.value?.cityName ?? 'this place')
const { mdAndUp } = useDisplay()
const themeLabel = computed(() => (isDark.value ? 'Switch to light mode' : 'Switch to dark mode'))
const resetLabel = computed(() => `Show all of ${meta.value?.subtitle || meta.value?.cityName || 'the map'}`)
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
  await cityStore.loadManifest()
  await selectCity(cityStore.initialCityId())
  if (link.geoid && tracts.value?.features.some((f) => f.properties.geoid === link.geoid)) cityStore.select(link.geoid)
  syncUrl()
  // Keep the address bar shareable as the view changes.
  watch([() => cityStore.cityId, selectedGeoid, basemap, theme], syncUrl)
}

function syncUrl() {
  writeDeepLink({ city: cityStore.cityId, geoid: selectedGeoid.value, basemap: basemap.value, theme: theme.value })
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
</script>

<template>
  <v-app>
    <v-app-bar color="primary" density="comfortable" flat>
      <template #prepend>
        <v-icon icon="mdi-tree" class="ml-2" />
      </template>
      <v-app-bar-title>
        <span class="font-weight-bold">Street Tree Equity</span>
        <span v-if="meta" class="text-body-2 ml-2 opacity-80">{{ meta.cityName }}<span v-if="mdAndUp && meta.subtitle"> · {{ meta.subtitle }}</span></span>
      </v-app-bar-title>

      <PlacePicker v-if="cities.length" :label="meta?.cityName ?? ''" :mobile="!mdAndUp"
        @select="selectCity" />

      <v-sheet v-if="meta && mdAndUp" class="px-3 py-1 mr-2" rounded color="surface">
        <MapLegend :meta="meta" dense />
      </v-sheet>

      <v-menu :close-on-content-click="false" location="bottom end">
        <template #activator="{ props: act }">
          <v-btn v-bind="act" icon aria-label="Layers">
            <v-icon icon="mdi-layers-outline" />
            <v-tooltip activator="parent" location="bottom">Basemap and layers</v-tooltip>
          </v-btn>
        </template>
        <v-card min-width="260">
          <v-card-title class="text-subtitle-1">Layers</v-card-title>
          <v-card-text class="pt-0">
            <div class="text-caption mb-1">Basemap</div>
            <v-btn-toggle
              :model-value="basemap"
              mandatory divided density="compact" variant="outlined" aria-label="Basemap"
              @update:model-value="(v: 'streets' | 'satellite') => ui.setBasemap(v)"
            >
              <v-btn value="streets">Streets</v-btn>
              <v-btn value="satellite">Satellite</v-btn>
            </v-btn-toggle>
            <v-divider class="my-3" />
            <v-switch v-model="showTrees" label="Individual trees (visible when zoomed in)" color="primary" hide-details density="compact" />
            <v-switch v-model="showParks" label="Parks" color="primary" hide-details density="compact" />
            <v-switch v-model="showRoads" label="Plant-here streets (orange)" color="orange-darken-2" hide-details density="compact" />
            <v-switch v-model="highlightBottomQuartile" label="Outline the 25% of tracts with the fewest trees" color="deep-orange" hide-details density="compact" />
          </v-card-text>
        </v-card>
      </v-menu>
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
      <v-btn icon :aria-label="themeLabel" @click="ui.toggleTheme()">
        <v-icon :icon="isDark ? 'mdi-white-balance-sunny' : 'mdi-weather-night'" />
        <v-tooltip activator="parent" location="bottom">{{ themeLabel }}</v-tooltip>
      </v-btn>
      <span class="sr-only" aria-live="polite">{{ themeAnnounce }}</span>
    </v-app-bar>

    <v-navigation-drawer v-model="drawerOpen" :location="mdAndUp ? 'right' : 'bottom'" :width="380" temporary
      :scrim="false" :class="{ 'bottom-drawer': !mdAndUp }">
      <TractDetails v-if="selectedTract && meta" :tract="selectedTract" :meta="meta"
        :total="tracts?.features.length ?? 0" @close="cityStore.select(null)" @fly-to-park="flyToPark" />
    </v-navigation-drawer>

    <v-main class="position-relative">
      <MapView
        @satellite-error="satFallback = true" v-if="city && meta && tracts && parks " :key="city.id" ref="mapRef" :data-path="city.dataPath" :meta="meta" :tracts="tracts" :parks="parks" :roads="roads" />

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
      <v-sheet v-if="meta && !mdAndUp" class="mobile-legend pa-2" rounded elevation="2" color="surface">
        <MapLegend :meta="meta" />
      </v-sheet>

      <v-sheet v-if="meta && !selectedTract && mdAndUp" class="hint pa-3" rounded elevation="2" color="surface" max-width="300">
        <div class="text-body-2">
          <strong>{{ meta.counts.trees.toLocaleString() }}</strong> mapped trees across
          <strong>{{ meta.counts.tracts }}</strong> census tracts
          (avg {{ meta.overall.treesPerAcre.toFixed(2) }} / acre).
        </div>
        <div class="text-caption mt-1">Click a tract for details and nearby parks.</div>
      </v-sheet>
    </v-main>

    <v-dialog v-model="aboutOpen" max-width="560">
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
    <v-snackbar v-model="satFallback" timeout="5000">Satellite imagery unavailable — showing streets.</v-snackbar>
    <v-snackbar :model-value="!!linkSnack" timeout="3000" @update:model-value="(v: boolean) => { if (!v) linkSnack = '' }">{{ linkSnack }}</v-snackbar>
  </v-app>
</template>

<style scoped>
.hint {
  position: absolute;
  left: 12px;
  /* Clear the app bar on live Pages (16px still clipped): bar height + gap. */
  top: calc(var(--v-layout-top, 0px) + 56px);
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
.mobile-legend {
  position: absolute;
  left: 8px;
  bottom: 36px;
  z-index: 2;
}
.bottom-drawer {
  max-height: 60vh !important;
  height: auto !important;
  overflow-y: auto;
}
</style>

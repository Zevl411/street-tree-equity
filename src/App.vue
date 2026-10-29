<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useDisplay } from 'vuetify'
import MapView from '@/components/MapView.vue'
import MapLegend from '@/components/MapLegend.vue'
import TractDetails from '@/components/TractDetails.vue'
import { useData } from '@/composables/useData'
import type { NearbyPark } from '@/types'

const { meta, tracts, parks, roads, loading, error, load } = useData()
const { mdAndUp } = useDisplay()

const selectedGeoid = ref<string | null>(null)
const showTrees = ref(true)
const showParks = ref(true)
const showRoads = ref(true)
const highlightBottomQuartile = ref(false)
const aboutOpen = ref(false)
const mapRef = ref<InstanceType<typeof MapView> | null>(null)

const selectedTract = computed(() =>
  tracts.value?.features.find((f) => f.properties.geoid === selectedGeoid.value)?.properties ?? null,
)
const drawerOpen = computed({
  get: () => selectedTract.value !== null,
  set: (v: boolean) => { if (!v) selectedGeoid.value = null },
})

function flyToPark(p: NearbyPark) {
  const park = parks.value?.features.find((f) => f.properties.id === p.id)
  if (park) mapRef.value?.flyTo(park.properties.lon, park.properties.lat, 15)
}

const updated = computed(() => (meta.value?.osmTimestamp ? new Date(meta.value.osmTimestamp).toLocaleDateString() : ''))

onMounted(load)
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

      <v-sheet v-if="meta && mdAndUp" class="px-3 py-1 mr-2" rounded color="white">
        <MapLegend :meta="meta" dense />
      </v-sheet>

      <v-menu :close-on-content-click="false" location="bottom end">
        <template #activator="{ props: act }">
          <v-btn v-bind="act" icon="mdi-layers-outline" aria-label="Layers" />
        </template>
        <v-card min-width="260">
          <v-card-title class="text-subtitle-1">Layers</v-card-title>
          <v-card-text class="pt-0">
            <v-switch v-model="showTrees" label="Tree points (zoom in)" color="primary" hide-details density="compact" />
            <v-switch v-model="showParks" label="Parks (OSM)" color="primary" hide-details density="compact" />
            <v-switch v-model="showRoads" label="Streets with no tree nearby" color="orange-darken-2" hide-details density="compact" />
            <v-switch v-model="highlightBottomQuartile" label="Outline bottom-quartile tracts" color="deep-orange" hide-details density="compact" />
          </v-card-text>
        </v-card>
      </v-menu>
      <v-btn icon="mdi-crosshairs-gps" aria-label="Reset view" @click="mapRef?.fitData()" />
      <v-btn icon="mdi-information-outline" aria-label="About" @click="aboutOpen = true" />
    </v-app-bar>

    <v-navigation-drawer v-model="drawerOpen" :location="mdAndUp ? 'right' : 'bottom'" :width="380" temporary
      :scrim="false" :class="{ 'bottom-drawer': !mdAndUp }">
      <TractDetails v-if="selectedTract && meta" :tract="selectedTract" :meta="meta"
        :total="tracts?.features.length ?? 0" @close="selectedGeoid = null" @fly-to-park="flyToPark" />
    </v-navigation-drawer>

    <v-main class="position-relative">
      <MapView v-if="meta && tracts && parks" ref="mapRef" :meta="meta" :tracts="tracts" :parks="parks" :roads="roads"
        :selected-geoid="selectedGeoid" :show-trees="showTrees" :show-parks="showParks" :show-roads="showRoads"
        :highlight-bottom-quartile="highlightBottomQuartile" @select="selectedGeoid = $event" />

      <div v-if="loading" class="d-flex fill-height align-center justify-center">
        <v-progress-circular indeterminate color="primary" size="48" />
      </div>
      <v-alert v-if="error" type="error" class="ma-4" :text="error" title="Could not load data" />

      <v-sheet v-if="meta && !mdAndUp" class="mobile-legend pa-2" rounded elevation="2">
        <MapLegend :meta="meta" />
      </v-sheet>

      <v-sheet v-if="meta && !selectedTract && mdAndUp" class="hint pa-3" rounded elevation="2" max-width="300">
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
            Data © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a> (ODbL) ·
            Tracts: U.S. Census Bureau {{ meta?.censusVintage }} ·
            Basemap: <a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> / OpenMapTiles.
            <span v-if="updated"> OSM data as of {{ updated }}.</span>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn color="primary" variant="text" @click="aboutOpen = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-app>
</template>

<style scoped>
.hint {
  position: absolute;
  left: 12px;
  top: 12px;
  z-index: 2;
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

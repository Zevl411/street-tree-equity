<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Feature, FeatureCollection } from 'geojson'
import type { Meta, NearbyPark, TractProps } from '@/types'
import { useCityStore } from '@/stores/city'
import { ACRES_PER_KM2, useUiStore } from '@/stores/ui'
import { useOverlayFocus } from '@/composables/useOverlayFocus'
import { useFavorites } from '@/composables/useFavorites'
import { copyText, tractShareUrl } from '@/utils/clipboard'
import { ODBL_NOTICE, downloadBlob, exportFilename, fetchTracts, toCsv, toGeoJson } from '@/utils/exportData'

const props = defineProps<{ tract: TractProps; meta: Meta; total: number; roads?: FeatureCollection | null; cityMedianAcre?: number | null }>()
const emit = defineEmits<{ close: []; flyToPark: [park: NearbyPark]; flyToRoad: [road: Feature] }>()

const vsCity = computed(() => {
  const city = props.meta.overall.treesPerAcre
  if (!city) return null
  return Math.round((props.tract.treesPerAcre / city) * 100)
})
const ui = useUiStore()
const isKm2 = computed(() => ui.densityUnit === 'km2')
// #69 tract vs city median (same median as #59)
const MINUS = '\u2212'
const signed = (n: number, s: string) => (n > 0 ? '+' : n < 0 ? MINUS : '') + s
const vsMedian = computed(() => {
  const m = props.cityMedianAcre
  const t = props.tract.treesPerAcre
  if (m == null || !Number.isFinite(m) || !Number.isFinite(t)) return null
  const deltaAcre = t - m
  const pct = m === 0 ? null : Math.round((deltaAcre / m) * 100)
  const at = Math.abs(deltaAcre) < 0.0005 || pct === 0
  const below = !at && deltaAcre < 0
  const deltaShow = isKm2.value ? deltaAcre * ACRES_PER_KM2 : deltaAcre
  const dp = isKm2.value ? 1 : 2
  const mag = Math.abs(deltaShow).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })
  const unit = isKm2.value ? '/km²' : '/acre'
  const caption = `${at ? '0' : signed(deltaShow, mag)} ${unit} vs city median${pct === null ? '' : ` (${at ? '0' : signed(pct, String(Math.abs(pct)))}%)`}`
  const label = at ? 'At city median' : below ? 'Below city median' : 'Above city median'
  return { label, caption, below, color: at ? 'secondary' : below ? 'warning' : 'success', aria: `${label}: ${caption.replace(MINUS, 'minus ')}` }
})
const fmtKm2 = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 })
const tractKm2 = computed(() => props.tract.treesPerKm2 ?? props.tract.treesPerAcre * ACRES_PER_KM2)
const cityAvgLabel = computed(() => isKm2.value
  ? `${fmtKm2(props.meta.overall.treesPerAcre * ACRES_PER_KM2)}/km²`
  : `${props.meta.overall.treesPerAcre.toFixed(2)}/acre`)
const relative = computed(() => {
  const v = vsCity.value
  if (v === null) return null
  if (v < 85) return { label: 'Below city average', color: 'warning' }
  if (v > 115) return { label: 'Above city average', color: 'success' }
  return { label: 'Near city average', color: 'secondary' }
})
const areaLabel = computed(() => props.meta.subtitle || props.meta.cityName)
const miles = (km: number) => (km * 0.621371).toFixed(2)
const bufferM = computed(() => props.meta.roadsBufferMeters ?? 20)
const bufferFt = computed(() => Math.round(bufferM.value * 3.28084))

const PLACEHOLDER_NAMES = new Set(['unnamed', 'unnamed park', 'null', 'undefined'])
const fmtAcres = (a: number) => String(Math.round(a * 100) / 100)
/** Designer rule (#18): real name → acreage → OSM id → generic. */
function parkTitle(p: NearbyPark): string {
  const name = (p.name ?? '').trim()
  if (name && !PLACEHOLDER_NAMES.has(name.toLowerCase())) return name
  if (Number.isFinite(p.areaAcres)) return `Unnamed park · ${fmtAcres(p.areaAcres)} acres`
  if (p.id !== undefined && p.id !== null) return `Unnamed park · OSM ${p.id}`
  return 'Unnamed park'
}

/** #17: parks inside the tract first, then by distance. */
const parkRows = computed(() =>
  props.tract.nearestParks
    .map((p) => ({ park: p, title: parkTitle(p), inside: p.inside === true }))
    .sort((a, b) => Number(b.inside) - Number(a.inside) || a.park.distanceKm - b.park.distanceKm),
)

// #36 Plant-here streets: low-tree road segments in this tract, longest first.
const ROAD_PLACEHOLDERS = new Set(['unnamed', 'null', 'undefined'])
function roadTitle(name: unknown): string {
  const n = typeof name === 'string' ? name.trim() : ''
  return n && !ROAD_PLACEHOLDERS.has(n.toLowerCase()) ? n : 'Unnamed street'
}
function humanizeHighway(h: unknown): string {
  if (typeof h !== 'string' || !h.trim()) return ''
  const t = h.trim().replace(/_/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}
const roadRows = computed(() => {
  const feats = props.roads?.features ?? []
  return feats
    .filter((f) => f.properties?.geoid === props.tract.geoid)
    .map((f, i) => {
      const lengthM = Number(f.properties?.lengthM) || 0
      const mi = (lengthM * 0.000621371).toFixed(2)
      const hw = humanizeHighway(f.properties?.highway)
      const title = roadTitle(f.properties?.name)
      return { key: `${i}`, feature: f as Feature, title, lengthM, mi,
        subtitle: `${mi} mi (${Math.round(lengthM)} m)${hw ? ` · ${hw}` : ''}` }
    })
    .sort((a, b) => b.lengthM - a.lengthM || a.title.localeCompare(b.title))
})
const showRoadSection = computed(() => props.tract.lowTreeRoadPct !== null && !!props.roads?.features?.length)
const ROAD_LIMIT = 8
const roadsExpanded = ref(false)
watch(() => props.tract.geoid, () => { roadsExpanded.value = false; fallbackOpen.value = false })
const visibleRoads = computed(() => (roadsExpanded.value ? roadRows.value : roadRows.value.slice(0, ROAD_LIMIT)))

// #39: Download menu lands on its first item; focus returns to the Download button on close.
const downloadOpen = ref(false)
useOverlayFocus(downloadOpen, '#download-menu .v-list-item')

const copied = ref(false)
async function copyGeoid() {
  try {
    await navigator.clipboard.writeText(props.tract.geoid)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch { /* clipboard unavailable */ }
}

// #23 export (Blob download only)
const cityStore = useCityStore()
// #45 star toggle (ste-favorites, per city).
const fav = useFavorites()
const favCity = computed(() => cityStore.city?.id ?? cityStore.cityId ?? null)
const starred = computed(() => fav.isStarred(favCity.value, props.tract.geoid))
const starAnnounce = ref('')
function toggleStar() {
  starAnnounce.value = fav.toggle(favCity.value, props.tract.geoid) ? 'Starred' : 'Star removed'
}
const snack = ref(false)
const snackText = ref('')
async function doExport(kind: 'tract' | 'all-csv' | 'all-geojson') {
  try {
    const cityId = cityStore.city?.id ?? cityStore.cityId ?? 'city'
    if (kind === 'tract') {
      downloadBlob(toCsv([props.tract], props.meta), exportFilename(cityId, props.tract.geoid, 'csv'), 'text/csv;charset=utf-8')
    } else {
      const fc = await fetchTracts(cityStore.city?.dataPath ?? 'data')
      if (kind === 'all-csv') downloadBlob(toCsv(fc.features.map((f) => f.properties), props.meta), exportFilename(cityId, 'all', 'csv'), 'text/csv;charset=utf-8')
      else downloadBlob(toGeoJson(fc, props.meta), exportFilename(cityId, 'all', 'geojson'), 'application/geo+json')
    }
    snackText.value = 'Download started'
  } catch {
    snackText.value = "Couldn't prepare the file. Try again."
  }
  snack.value = true
}

// #47 Copy summary / Copy link — plain text, robust fail path.
const summaryLine = computed(() => {
  const t = props.tract
  const density = isKm2.value ? `${fmtKm2(tractKm2.value)}/km²` : `${t.treesPerAcre.toFixed(2)}/acre`
  const parts = [t.name, areaLabel.value, `GEOID ${t.geoid}`, density]
  if (t.rank && props.total) parts.push(`#${t.rank} of ${props.total}`)
  return parts.filter(Boolean).join(' · ')
})
const fallbackOpen = ref(false)
const fallbackText = ref('')
const fallbackField = ref<{ $el?: HTMLElement } | null>(null)
function selectFallback() {
  const el = fallbackField.value?.$el?.querySelector('textarea')
  if (el) { el.focus(); el.select() }
}
watch(fallbackOpen, (o) => { if (o) setTimeout(selectFallback, 50) })
async function copyWithFallback(text: string, okMsg: string) {
  if (await copyText(text)) {
    snackText.value = okMsg
    snack.value = true
  } else {
    fallbackText.value = text
    fallbackOpen.value = true
  }
}
function copySummary() { void copyWithFallback(summaryLine.value, 'Summary copied') }
function copyLink() {
  let url = ''
  try {
    url = tractShareUrl({
      city: cityStore.cityId ?? cityStore.city?.id ?? null, geoid: props.tract.geoid,
      basemap: ui.basemap, theme: ui.theme, unit: ui.densityUnit,
      choroplethMode: ui.choroplethMode, legend: ui.legendExpandedPref, bin: ui.densityBinIndex,
      layers: { trees: ui.showTrees, parks: ui.showParks, roads: ui.showRoads, bq: ui.highlightBottomQuartile, bm: ui.belowMedian },
    })
  } catch { url = window.location.href }
  void copyWithFallback(url, 'Link copied')
}
</script>

<template>
  <v-card id="tract-details-panel" flat>
    <v-card-item>
      <template #prepend>
        <v-btn icon :color="starred ? 'warning' : undefined" variant="text"
          class="touch-44 tract-star" :aria-label="starred ? 'Remove star' : 'Star this tract'" :aria-pressed="starred" @click="toggleStar">
          <v-icon :icon="starred ? 'mdi-star' : 'mdi-star-outline'" />
          <v-tooltip activator="parent" location="bottom">{{ starred ? 'Starred' : 'Star' }}</v-tooltip>
        </v-btn>
        <span role="status" aria-live="polite" class="d-sr-only">{{ starAnnounce }}</span>
      </template>
      <template #append>
        <v-btn icon="mdi-close" variant="text" class="touch-44 tract-close" aria-label="Close" @click="emit('close')" />
      </template>
      <v-card-title class="text-wrap">{{ tract.name }}</v-card-title>
      <v-card-subtitle>{{ tract.county }}</v-card-subtitle>
    </v-card-item>

    <v-card-text>
      <v-alert v-if="tract.bottomQuartile" type="warning" variant="tonal" density="compact" class="mb-3"
        icon="mdi-tree-outline">
        Among the 25% of tracts with the fewest mapped trees per {{ isKm2 ? 'km²' : 'acre' }}.
      </v-alert>

      <div class="d-flex flex-wrap ga-2 mb-1">
        <v-chip v-if="tract.rank && total" color="primary" variant="tonal" size="small"
          :aria-label="`Density rank ${tract.rank} of ${total}, 1 is most trees per ${isKm2 ? 'km²' : 'acre'}`">
          #{{ tract.rank }} of {{ total }}
        </v-chip>
        <v-chip v-if="relative" :color="relative.color" variant="tonal" size="small">
          {{ relative.label }}
        </v-chip>
      </div>
      <div v-if="vsCity !== null" class="text-caption text-medium-emphasis mb-3">
        {{ vsCity }}% of the {{ areaLabel }} average ({{ cityAvgLabel }})
      </div>
      <template v-if="vsMedian">
        <div class="d-flex flex-wrap ga-2 mb-1">
          <v-chip :color="vsMedian.color" variant="tonal" size="small" :aria-label="vsMedian.aria"
            :prepend-icon="vsMedian.below ? 'mdi-arrow-down' : undefined"
            :class="{ 'font-weight-bold': vsMedian.below && ui.choroplethMode === 'contrast' }">
            {{ vsMedian.label }}
          </v-chip>
        </div>
        <div class="text-caption text-medium-emphasis mb-3" aria-hidden="true">{{ vsMedian.caption }}</div>
      </template>

      <v-row dense>
        <v-col cols="6">
          <div class="text-h5 font-weight-bold">{{ tract.treeCount.toLocaleString() }}</div>
          <div class="text-caption text-medium-emphasis">Mapped trees</div>
        </v-col>
        <v-col cols="6">
          <template v-if="isKm2">
            <div class="text-h5 font-weight-bold">{{ fmtKm2(tractKm2) }}</div>
            <div class="text-caption text-medium-emphasis">Trees per km²</div>
            <div class="text-caption text-medium-emphasis">Also {{ tract.treesPerAcre.toFixed(2) }} per acre</div>
          </template>
          <template v-else>
            <div class="text-h5 font-weight-bold">{{ tract.treesPerAcre.toFixed(2) }}</div>
            <div class="text-caption text-medium-emphasis">Trees per acre</div>
            <div class="text-caption text-medium-emphasis">Also {{ fmtKm2(tractKm2) }} per km²</div>
          </template>
        </v-col>
        <v-col cols="6">
          <div class="text-subtitle-1 font-weight-medium">{{ tract.areaAcres.toLocaleString() }} ac</div>
          <div class="text-caption text-medium-emphasis">Land area (water excluded)</div>
        </v-col>
        <v-col cols="6">
          <div class="text-subtitle-1 font-weight-medium">#{{ tract.rank }} of {{ total }}</div>
          <div class="text-caption text-medium-emphasis">Density rank</div>
        </v-col>
      </v-row>

      <div v-if="tract.lowTreeRoadPct !== null" class="mt-4" role="group"
        :aria-label="`${tract.lowTreeRoadPct}% of streets have no mapped tree within ${bufferM} m`">
        <div class="d-flex align-center justify-space-between mb-1">
          <span class="text-subtitle-2">Streets that could use a tree</span>
          <span class="text-body-2 font-weight-bold">{{ tract.lowTreeRoadPct }}%</span>
        </div>
        <v-progress-linear :model-value="tract.lowTreeRoadPct" color="#ef6c00" bg-color="surface-variant"
          bg-opacity="1" height="10" rounded aria-hidden="true" />
        <div class="text-caption text-medium-emphasis mt-1">
          {{ tract.lowTreeRoadKm }} of {{ tract.roadKm }} km of streets ({{ tract.lowTreeRoadPct }}%) have no mapped
          tree within {{ bufferM }} m ({{ bufferFt }} ft). They’re shown in orange on the map.
        </div>
      </div>
    </v-card-text>

    <v-divider />
    <v-list density="compact" lines="two">
      <v-list-subheader>Nearest parks · {{ tract.parksInside }} inside this tract</v-list-subheader>
      <v-list-item v-for="row in parkRows" :key="row.park.id" prepend-icon="mdi-pine-tree" :title="row.title"
        :subtitle="`${row.park.distanceKm} km (${miles(row.park.distanceKm)} mi) · ${row.park.areaAcres} acres`"
        class="touch-row" :aria-label="`Zoom to ${row.title}, ${miles(row.park.distanceKm)} mi away`" @click="emit('flyToPark', row.park)">
        <template v-if="row.inside" #append>
          <v-chip size="x-small" variant="tonal" color="success" density="compact">Inside tract</v-chip>
        </template>
      </v-list-item>
      <v-list-item v-if="!parkRows.length" title="No parks in our data near this tract." />
    </v-list>

    <template v-if="showRoadSection">
      <v-divider />
      <v-list density="compact" lines="two">
        <v-list-subheader>Plant-here streets · {{ roadRows.length }}</v-list-subheader>
        <div class="text-caption text-medium-emphasis px-4 pb-1">
          Longest stretches with no mapped tree within {{ bufferM }} m. Tap to zoom.
        </div>
        <v-list-item v-for="row in visibleRoads" :key="row.key" prepend-icon="mdi-road-variant" :title="row.title"
          :subtitle="row.subtitle" class="touch-row" :aria-label="`Zoom to ${row.title}, ${row.mi} miles`"
          @click="emit('flyToRoad', row.feature)" />
        <v-list-item v-if="!roadRows.length" title="No plant-here street segments in our data for this tract." />
        <div v-if="roadRows.length > ROAD_LIMIT" class="px-2 pb-1">
          <v-btn variant="text" class="touch-h44" @click="roadsExpanded = !roadsExpanded">
            {{ roadsExpanded ? 'Show fewer' : `Show all ${roadRows.length} streets` }}
          </v-btn>
        </div>
      </v-list>
    </template>

    <v-divider />
    <div class="d-flex align-center px-4 py-1 text-caption text-medium-emphasis">
      GEOID {{ tract.geoid }}
      <v-tooltip :text="copied ? 'Copied' : 'Copy GEOID'" location="top">
        <template #activator="{ props: tip }">
          <v-btn v-bind="tip" :icon="copied ? 'mdi-check' : 'mdi-content-copy'" variant="text" size="small"
            class="ml-1 touch-44" aria-label="Copy GEOID" @click="copyGeoid" />
        </template>
      </v-tooltip>
    </div>
    <div class="px-4 pb-1">
      <div class="d-flex flex-wrap align-center ga-2">
      <v-menu v-model="downloadOpen" location="top" attach="body" :contained="false">
        <template #activator="{ props: menu }">
          <v-tooltip text="Download data" location="top">
            <template #activator="{ props: tip }">
              <v-btn v-bind="{ ...menu, ...tip }" prepend-icon="mdi-download" variant="tonal" class="touch-h44">Download…</v-btn>
            </template>
          </v-tooltip>
        </template>
        <v-list id="download-menu" density="compact">
          <v-list-item title="This tract (CSV)" :aria-label="`Download CSV for ${tract.name}`" @click="doExport('tract')" />
          <v-list-item title="All tracts in this city (CSV)" @click="doExport('all-csv')" />
          <v-list-item title="All tracts (GeoJSON)" @click="doExport('all-geojson')" />
        </v-list>
      </v-menu>
      <v-btn prepend-icon="mdi-text-box-outline" variant="tonal" class="touch-h44" aria-label="Copy tract summary"
        @click="copySummary">Copy summary</v-btn>
      <v-btn prepend-icon="mdi-link-variant" variant="text" class="touch-h44" aria-label="Copy link to this tract"
        @click="copyLink">Copy link</v-btn>
      </div>
      <div v-if="fallbackOpen" class="mt-2" role="group" aria-label="Copy manually">
        <v-textarea ref="fallbackField" :model-value="fallbackText" readonly autofocus auto-grow rows="1"
          density="compact" variant="outlined" hide-details aria-label="Text to copy" @focus="selectFallback" />
        <div class="text-caption text-medium-emphasis mt-1">Clipboard blocked — select the text and copy.</div>
        <div class="d-flex ga-2 mt-1">
          <v-btn variant="text" class="touch-h44" @click="selectFallback">Select all</v-btn>
          <v-btn variant="text" class="touch-h44" @click="fallbackOpen = false">Close</v-btn>
        </div>
      </div>
      <div class="text-caption text-medium-emphasis mt-1">{{ ODBL_NOTICE }}</div>
    </div>
    <v-snackbar v-model="snack" :timeout="2000" class="safe-snack">{{ snackText }}</v-snackbar>
    <div class="text-caption text-medium-emphasis px-4 pb-3 credit-strip">
      Tracts: <a href="https://www.census.gov/geographies/mapping-files/time-series/geo/cartographic-boundary.html" target="_blank" rel="noopener noreferrer">U.S. Census Bureau<span class="d-sr-only"> (opens in new tab)</span></a>
      · Trees, parks &amp; streets: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap (ODbL)<span class="d-sr-only"> (opens in new tab)</span></a>
      · Basemap: <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap<span class="d-sr-only"> (opens in new tab)</span></a> / OpenMapTiles
    </div>
  </v-card>
</template>

<style scoped>
.touch-44 { min-width: 44px !important; min-height: 44px !important; }
.touch-h44 { min-height: 44px; }
.touch-row { min-height: 48px; }
.credit-strip a { color: inherit; text-decoration: underline; }
</style>

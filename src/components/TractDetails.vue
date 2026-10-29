<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Meta, NearbyPark, TractProps } from '@/types'

const props = defineProps<{ tract: TractProps; meta: Meta; total: number }>()
const emit = defineEmits<{ close: []; flyToPark: [park: NearbyPark] }>()

const vsCity = computed(() => {
  const city = props.meta.overall.treesPerAcre
  if (!city) return null
  return Math.round((props.tract.treesPerAcre / city) * 100)
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

const copied = ref(false)
async function copyGeoid() {
  try {
    await navigator.clipboard.writeText(props.tract.geoid)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch { /* clipboard unavailable */ }
}
</script>

<template>
  <v-card flat>
    <v-card-item>
      <template #append>
        <v-btn icon="mdi-close" variant="text" size="small" aria-label="Close" @click="emit('close')" />
      </template>
      <v-card-title class="text-wrap">{{ tract.name }}</v-card-title>
      <v-card-subtitle>{{ tract.county }}</v-card-subtitle>
    </v-card-item>

    <v-card-text>
      <v-alert v-if="tract.bottomQuartile" type="warning" variant="tonal" density="compact" class="mb-3"
        icon="mdi-tree-outline">
        Among the 25% of tracts with the fewest mapped trees per acre.
      </v-alert>

      <v-chip v-if="vsCity !== null" :color="vsCity < 100 ? 'warning' : 'success'" variant="tonal" size="small"
        class="mb-3 stat-lead">
        {{ vsCity }}% of the {{ areaLabel }} average ({{ meta.overall.treesPerAcre.toFixed(2) }}/acre)
      </v-chip>

      <v-row dense>
        <v-col cols="6">
          <div class="text-h5 font-weight-bold">{{ tract.treeCount.toLocaleString() }}</div>
          <div class="text-caption text-medium-emphasis">Mapped trees</div>
        </v-col>
        <v-col cols="6">
          <div class="text-h5 font-weight-bold">{{ tract.treesPerAcre.toFixed(2) }}</div>
          <div class="text-caption text-medium-emphasis">Trees per acre</div>
          <div class="text-caption text-medium-emphasis">{{ tract.treesPerKm2 }} per km²</div>
        </v-col>
        <v-col cols="6">
          <div class="text-subtitle-1 font-weight-medium">{{ tract.areaAcres.toLocaleString() }} ac</div>
          <div class="text-caption text-medium-emphasis">Land area (water excluded)</div>
        </v-col>
        <v-col cols="6">
          <div class="text-subtitle-1 font-weight-medium">#{{ tract.rank }} of {{ total }}</div>
          <div class="text-caption text-medium-emphasis">Ranked density (1 = most trees per acre)</div>
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
        :aria-label="`Zoom to ${row.title}, ${miles(row.park.distanceKm)} mi away`" @click="emit('flyToPark', row.park)">
        <template v-if="row.inside" #append>
          <v-chip size="x-small" variant="tonal" color="success" density="compact">Inside tract</v-chip>
        </template>
      </v-list-item>
      <v-list-item v-if="!parkRows.length" title="No parks in our data near this tract." />
    </v-list>

    <v-divider />
    <div class="d-flex align-center px-4 py-1 text-caption text-medium-emphasis">
      GEOID {{ tract.geoid }}
      <v-tooltip :text="copied ? 'Copied' : 'Copy GEOID'" location="top">
        <template #activator="{ props: tip }">
          <v-btn v-bind="tip" :icon="copied ? 'mdi-check' : 'mdi-content-copy'" variant="text" size="x-small"
            class="ml-1" aria-label="Copy GEOID" @click="copyGeoid" />
        </template>
      </v-tooltip>
    </div>
  </v-card>
</template>

<style scoped>
.stat-lead { height: auto !important; white-space: normal; padding-block: 4px; }
</style>

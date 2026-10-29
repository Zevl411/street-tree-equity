<script setup lang="ts">
import { computed } from 'vue'
import type { Meta, NearbyPark, TractProps } from '@/types'

const props = defineProps<{ tract: TractProps; meta: Meta; total: number }>()
const emit = defineEmits<{ close: []; flyToPark: [park: NearbyPark] }>()

const vsCity = computed(() => {
  const city = props.meta.overall.treesPerAcre
  if (!city) return null
  return Math.round((props.tract.treesPerAcre / city) * 100)
})
const miles = (km: number) => (km * 0.621371).toFixed(2)
</script>

<template>
  <v-card flat>
    <v-card-item>
      <template #append>
        <v-btn icon="mdi-close" variant="text" size="small" aria-label="Close" @click="emit('close')" />
      </template>
      <v-card-title class="text-wrap">{{ tract.name }}</v-card-title>
      <v-card-subtitle>{{ tract.county }} · GEOID {{ tract.geoid }}</v-card-subtitle>
    </v-card-item>

    <v-card-text>
      <v-alert v-if="tract.bottomQuartile" type="warning" variant="tonal" density="compact" class="mb-3"
        icon="mdi-weather-sunny-alert">
        Bottom quartile for mapped tree density in this area.
      </v-alert>

      <v-row dense>
        <v-col cols="6">
          <div class="text-h5 font-weight-bold">{{ tract.treeCount.toLocaleString() }}</div>
          <div class="text-caption">mapped trees</div>
        </v-col>
        <v-col cols="6">
          <div class="text-h5 font-weight-bold">{{ tract.treesPerAcre.toFixed(2) }}</div>
          <div class="text-caption">trees / acre ({{ tract.treesPerKm2 }} / km²)</div>
        </v-col>
        <v-col cols="6">
          <div class="text-subtitle-1 font-weight-medium">{{ tract.areaAcres.toLocaleString() }} ac</div>
          <div class="text-caption">land area</div>
        </v-col>
        <v-col cols="6">
          <div class="text-subtitle-1 font-weight-medium">#{{ tract.rank }} of {{ total }}</div>
          <div class="text-caption">density rank<span v-if="vsCity !== null"> · {{ vsCity }}% of area avg</span></div>
        </v-col>
      </v-row>

      <template v-if="tract.lowTreeRoadPct !== null">
        <div class="text-subtitle-2 mt-4 mb-1">Streets with no mapped tree within {{ meta.roadsBufferMeters }} m</div>
        <v-progress-linear :model-value="tract.lowTreeRoadPct" color="orange-darken-2" height="18" rounded>
          <span class="text-caption font-weight-bold">{{ tract.lowTreeRoadPct }}%</span>
        </v-progress-linear>
        <div class="text-caption mt-1">
          {{ tract.lowTreeRoadKm }} of {{ tract.roadKm }} km of streets — shown in orange on the map as “plant here” candidates.
        </div>
      </template>
    </v-card-text>

    <v-divider />
    <v-list density="compact" lines="two">
      <v-list-subheader>Nearest parks ({{ tract.parksInside }} inside this tract)</v-list-subheader>
      <v-list-item v-for="p in tract.nearestParks" :key="p.id" prepend-icon="mdi-pine-tree" :title="p.name"
        :subtitle="`${p.distanceKm} km (${miles(p.distanceKm)} mi) · ${p.areaAcres} acres`" @click="emit('flyToPark', p)" />
      <v-list-item v-if="!tract.nearestParks.length" title="No parks found in the data extent" />
    </v-list>
  </v-card>
</template>

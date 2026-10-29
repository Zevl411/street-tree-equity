<script setup lang="ts">
import { computed } from 'vue'
import type { Meta, TractCollection } from '@/types'
import { ACRES_PER_KM2, useUiStore } from '@/stores/ui'
import { choroplethColors } from '@/utils/choropleth'
import { binCounts, binRows } from '@/utils/densityBins'

const props = defineProps<{ meta: Meta; dense?: boolean; treesAvailable?: boolean; belowMedian?: boolean; tracts?: TractCollection | null }>()

const ui = useUiStore()
const isKm2 = computed(() => ui.densityUnit === 'km2')

// Display-only: breaks stay trees/acre in data and paint.
const rows = computed(() =>
  binRows(props.meta.breaks, choroplethColors(props.meta, ui.choroplethMode, ui.choroplethPalette), isKm2.value, isKm2.value ? ACRES_PER_KM2 : 1),
)
const counts = computed(() => binCounts(props.tracts, props.meta.breaks))
</script>

<template>
  <div class="legend" :class="{ dense }">
    <div class="text-caption font-weight-medium mb-1">{{ ui.metric.legendTitle(ui.densityUnit) }}<template v-if="ui.metric.id === 'trees'"> (OSM-mapped)</template></div>
    <div class="d-flex" :class="dense ? 'flex-row align-center ga-2' : 'flex-column ga-1'">
      <div v-for="(r, i) in rows" :key="r.label" class="d-flex align-center ga-1">
        <span class="swatch" :style="{ background: r.color }" />
        <span class="text-caption" :aria-label="`${r.label}, ${(counts[i] ?? 0).toLocaleString()} tracts`">{{ r.label }} <span class="text-medium-emphasis">· {{ (counts[i] ?? 0).toLocaleString() }}</span></span>
      </div>
      <div class="d-flex align-center ga-1">
        <span class="swatch line" style="background: #ef6c00" />
        <span class="text-caption">No mapped tree within 20 m (plant-here)</span>
      </div>
      <div v-if="treesAvailable" class="d-flex align-center ga-1">
        <span class="swatch dot" />
        <span class="text-caption">Mapped tree</span>
      </div>
    </div>
    <div v-if="belowMedian" class="text-caption text-medium-emphasis mt-1">Dimmed = above city median</div>
  </div>
</template>

<style scoped>
.swatch {
  display: inline-block;
  width: 16px;
  height: 12px;
  border-radius: 2px;
  border: 1px solid rgba(0, 0, 0, 0.2);
}
.swatch.line {
  height: 4px;
  border: 0;
}
.swatch.dot {
  width: 8px;
  height: 8px;
  margin: 0 4px;
  border-radius: 50%;
  background: #2e7d32;
  border: 1px solid #ffffff;
}
.legend.dense .text-caption {
  line-height: 1.1;
}
</style>

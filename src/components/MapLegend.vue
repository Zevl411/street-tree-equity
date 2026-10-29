<script setup lang="ts">
import { computed } from 'vue'
import type { Meta } from '@/types'
import { ACRES_PER_KM2, useUiStore } from '@/stores/ui'
import { choroplethColors } from '@/utils/choropleth'

const props = defineProps<{ meta: Meta; dense?: boolean; treesAvailable?: boolean }>()

const ui = useUiStore()
const isKm2 = computed(() => ui.densityUnit === 'km2')

// Display-only: breaks stay trees/acre in data and paint.
const rows = computed(() => {
  const colors = choroplethColors(props.meta, ui.choroplethMode)
  const k = isKm2.value ? ACRES_PER_KM2 : 1
  const breaks = props.meta.breaks.map((b) => b * k)
  return colors.map((color, i) => {
    const lo = i === 0 ? 0 : breaks[i - 1]
    const hi = breaks[i]
    const label = hi === undefined ? `≥ ${fmt(lo)}` : lo === hi ? `≈ ${fmt(lo)}` : `${fmt(lo)} – ${fmt(hi)}`
    return { color, label }
  })
})

function fmt(n: number) {
  if (n === 0) return '0'
  if (isKm2.value) return n.toLocaleString(undefined, { maximumFractionDigits: n < 10 ? 1 : 0 })
  if (n < 0.1) return n.toFixed(3)
  return n < 1 ? n.toFixed(2) : n.toFixed(1)
}
</script>

<template>
  <div class="legend" :class="{ dense }">
    <div class="text-caption font-weight-medium mb-1">{{ isKm2 ? 'Trees / km²' : 'Trees / acre' }} (OSM-mapped)</div>
    <div class="d-flex" :class="dense ? 'flex-row align-center ga-2' : 'flex-column ga-1'">
      <div v-for="r in rows" :key="r.label" class="d-flex align-center ga-1">
        <span class="swatch" :style="{ background: r.color }" />
        <span class="text-caption">{{ r.label }}</span>
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

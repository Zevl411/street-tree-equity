<script setup lang="ts">
import { computed } from 'vue'
import type { Meta } from '@/types'

const props = defineProps<{ meta: Meta; dense?: boolean }>()

const rows = computed(() => {
  const { breaks, colors } = props.meta
  return colors.map((color, i) => {
    const lo = i === 0 ? 0 : breaks[i - 1]
    const hi = breaks[i]
    const label = hi === undefined ? `≥ ${fmt(lo)}` : `${fmt(lo)} – ${fmt(hi)}`
    return { color, label }
  })
})

function fmt(n: number) {
  return n < 1 ? n.toFixed(2) : n.toFixed(1)
}
</script>

<template>
  <div class="legend" :class="{ dense }">
    <div class="text-caption font-weight-medium mb-1">Trees / acre (OSM-mapped)</div>
    <div class="d-flex" :class="dense ? 'flex-row align-center ga-2' : 'flex-column ga-1'">
      <div v-for="r in rows" :key="r.label" class="d-flex align-center ga-1">
        <span class="swatch" :style="{ background: r.color }" />
        <span class="text-caption">{{ r.label }}</span>
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
.legend.dense .text-caption {
  line-height: 1.1;
}
</style>

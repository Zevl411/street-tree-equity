<script setup lang="ts">
import { computed } from 'vue'
import type { Meta, TractCollection } from '@/types'
import { ACRES_PER_KM2, useUiStore } from '@/stores/ui'
import { choroplethColors } from '@/utils/choropleth'
import { binIndex, binRows, cityMedian } from '@/utils/densityBins'

/** #63: city-level histogram of tracts per legend break. Non-interactive (tap-a-bar stretch deferred). */
const props = defineProps<{ meta: Meta; tracts: TractCollection | null; dense?: boolean; belowMedian?: boolean }>()

const ui = useUiStore()

const median = computed(() => (props.belowMedian ? cityMedian(props.tracts) : null))

const bins = computed(() => {
  const isKm2 = ui.densityUnit === 'km2'
  const rows = binRows(props.meta.breaks, choroplethColors(props.meta, ui.choroplethMode), isKm2, isKm2 ? ACRES_PER_KM2 : 1)
  const counts = rows.map(() => 0)
  for (const f of props.tracts?.features ?? []) {
    const v = f.properties.treesPerAcre
    if (!Number.isFinite(v)) continue
    counts[Math.min(binIndex(v, props.meta.breaks), counts.length - 1)]++
  }
  const max = Math.max(1, ...counts)
  const m = median.value
  return rows.map((r, i) => ({
    ...r,
    count: counts[i],
    pct: (counts[i] / max) * 100,
    // Entire bin above median: lower bound (inclusive) strictly above median.
    dimmed: m !== null && r.lo > m,
  }))
})
const total = computed(() => bins.value.reduce((s, b) => s + b.count, 0))
</script>

<template>
  <div v-if="total > 0" class="density-hist" :class="{ dense }">
    <div v-if="!dense" class="d-flex align-baseline justify-space-between mt-2 mb-1">
      <div class="text-caption font-weight-medium">Density across tracts</div>
      <div class="text-caption text-medium-emphasis">{{ total }} tracts</div>
    </div>
    <div class="chart" role="img" aria-label="Histogram of tracts by tree density">
      <div v-for="b in bins" :key="b.label" class="track" :title="`${b.label}: ${b.count} tracts`">
        <div class="bar" :style="{ background: b.color, height: `max(4px, ${b.pct}%)`, opacity: b.dimmed ? 0.35 : 1 }" />
      </div>
    </div>
    <ul class="sr-only">
      <li v-for="b in bins" :key="b.label">{{ b.label }}: {{ b.count }} tracts{{ b.dimmed ? ' (above city median)' : '' }}</li>
    </ul>
    <div v-if="!dense && median !== null" class="text-caption text-medium-emphasis mt-1">Dimmed bins are above the city median</div>
  </div>
</template>

<style scoped>
.chart { display: flex; gap: 2px; height: 72px; align-items: stretch; }
.density-hist.dense .chart { height: 36px; max-height: 36px; }
.density-hist.dense { margin-top: 4px; }
.track { flex: 1; min-width: 0; display: flex; align-items: flex-end; background: rgba(var(--v-theme-on-surface), 0.08); border-radius: 2px 2px 0 0; }
.bar { width: 100%; border-radius: 2px 2px 0 0; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; margin: 0; padding: 0; }
</style>

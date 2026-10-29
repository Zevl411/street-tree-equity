<script setup lang="ts">
import { computed } from 'vue'
import type { Meta, TractCollection } from '@/types'
import { ACRES_PER_KM2, useUiStore } from '@/stores/ui'
import { choroplethColors } from '@/utils/choropleth'
import { binIndex, binRows, cityMedian } from '@/utils/densityBins'

/** #63: city-level histogram of tracts per legend break.
 *  #73: bars are toggle buttons that isolate one bin on the map (ui.densityBinIndex; bin wins over #59). */
const props = defineProps<{ meta: Meta; tracts: TractCollection | null; dense?: boolean; belowMedian?: boolean }>()

const ui = useUiStore()

const median = computed(() => (props.belowMedian ? cityMedian(props.tracts) : null))

const bins = computed(() => {
  const isKm2 = ui.densityUnit === 'km2'
  const rows = binRows(props.meta.breaks, choroplethColors(props.meta, ui.choroplethMode, ui.choroplethPalette), isKm2, isKm2 ? ACRES_PER_KM2 : 1)
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
const selected = computed(() => {
  const i = ui.densityBinIndex
  return i !== null && i < bins.value.length ? i : null
})
const status = computed(() => (selected.value === null ? 'All density bins' : `Showing density bin ${bins.value[selected.value].label}`))
function toggle(i: number) {
  if (bins.value[i]?.count === 0) return
  ui.setDensityBin(selected.value === i ? null : i, bins.value.length)
}
const total = computed(() => bins.value.reduce((s, b) => s + b.count, 0))
</script>

<template>
  <div v-if="total > 0" class="density-hist" :class="{ dense }">
    <div v-if="!dense" class="d-flex align-baseline justify-space-between mt-2 mb-1">
      <div class="text-caption font-weight-medium">Density across tracts</div>
      <div class="text-caption text-medium-emphasis">{{ total }} tracts</div>
    </div>
    <div class="chart" role="group" aria-label="Filter map by tree density bin">
      <button
        v-for="(b, i) in bins" :key="b.label" type="button" class="track"
        :class="{ selected: selected === i, faded: selected !== null && selected !== i }"
        :title="`${b.label}: ${b.count} tracts`"
        :aria-pressed="selected === i ? 'true' : 'false'"
        :aria-label="`Filter map to ${b.label}, ${b.count} tracts`"
        :disabled="b.count === 0" :aria-disabled="b.count === 0 ? 'true' : undefined"
        @click="toggle(i)"
      >
        <span class="bar" :style="{ background: b.color, height: `max(4px, ${b.pct}%)`, opacity: selected === i ? 1 : b.dimmed && selected === null ? 0.35 : 1 }" />
      </button>
    </div>
    <div class="sr-only" role="status" aria-live="polite">{{ status }}</div>
    <ul class="sr-only">
      <li v-for="b in bins" :key="b.label">{{ b.label }}: {{ b.count }} tracts{{ b.dimmed ? ' (above city median)' : '' }}</li>
    </ul>
    <div v-if="selected !== null" class="d-flex align-center mt-1">
      <v-btn v-if="!dense" variant="text" size="small" prepend-icon="mdi-filter-off" @click="ui.setDensityBin(null)">Clear bin filter</v-btn>
      <v-btn v-else variant="text" size="x-small" icon="mdi-filter-off" aria-label="Clear bin filter" class="clear-dense" @click="ui.setDensityBin(null)" />
      <span v-if="!dense" class="text-caption text-medium-emphasis ml-1">Map filtered to one density bin</span>
    </div>
    <div v-if="!dense && median !== null && selected === null" class="text-caption text-medium-emphasis mt-1">Dimmed bins are above the city median</div>
  </div>
</template>

<style scoped>
.chart { display: flex; gap: 2px; height: 72px; align-items: stretch; }
.density-hist.dense { margin-top: 4px; }
.track { flex: 1; min-width: 0; display: flex; align-items: flex-end; background: rgba(var(--v-theme-on-surface), 0.08); border-radius: 2px 2px 0 0; border: 0; padding: 0; cursor: pointer; transition: opacity 0.15s; }
.track:disabled { cursor: default; }
.track.faded { opacity: 0.45; }
.track.selected { outline: 2px solid rgb(var(--v-theme-on-surface)); outline-offset: 1px; }
.track:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 1px; }
/* #73: 44px min touch target on the dense sparkline via padding around the 36px bars. */
.density-hist.dense .track { min-height: 44px; padding-top: 8px; background-clip: content-box; }
.density-hist.dense .chart { height: 44px; max-height: 44px; }
.clear-dense { min-width: 44px; min-height: 44px; }
.bar { width: 100%; border-radius: 2px 2px 0 0; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; margin: 0; padding: 0; }
</style>

<script setup lang="ts">
import { gapTargetLine } from '@/utils/canopyGap'
import { fmtUnitless, METRICS, type MetricId } from '@/utils/metrics'
import { computed } from 'vue'
import type { Meta, TractCollection } from '@/types'
import { ACRES_PER_KM2, useUiStore } from '@/stores/ui'
import { choroplethColors } from '@/utils/choropleth'
import { binCounts, binRows } from '@/utils/densityBins'

const props = defineProps<{ meta: Meta; dense?: boolean; treesAvailable?: boolean; belowMedian?: boolean; tracts?: TractCollection | null; metricId?: MetricId }>()
const lm = computed(() => (props.metricId ? METRICS[props.metricId] : useUiStore().metric))
const lunit = computed(() => (lm.value.usesDensityUnit ? useUiStore().densityUnit : 'acre'))

const ui = useUiStore()
const isKm2 = computed(() => lunit.value === 'km2')

// Display-only: breaks stay trees/acre in data and paint.
const rows = computed(() =>
  binRows(props.meta.breaks, choroplethColors(props.meta, ui.choroplethMode, ui.choroplethPalette), isKm2.value, isKm2.value ? ACRES_PER_KM2 : 1, (lm.value.id === 'canopyGap' || lm.value.currency || lm.value.percent || lm.value.percentPoints) ? (n: number) => fmtUnitless(lm.value, n) : undefined),
)
const missingCanopy = computed(() => lm.value.id === 'canopy' && props.tracts?.features.some(f => typeof f.properties.canopyPct !== 'number' || !Number.isFinite(f.properties.canopyPct)))
const missingGap = computed(() => lm.value.id === 'canopyGap' && props.tracts?.features.some(f => typeof f.properties.canopyGapAcres !== 'number' || !Number.isFinite(f.properties.canopyGapAcres)))
const counts = computed(() => binCounts(props.tracts, props.meta.breaks, lm.value.valueKey))
</script>

<template>
  <div class="legend" :class="{ dense }">
    <div class="text-caption font-weight-medium mb-1">{{ lm.legendTitle(lunit) }}<template v-if="lm.id === 'trees'"> (OSM-mapped)</template></div>
    <template v-if="lm.id === 'canopyGap'">
      <p class="text-caption mb-1">{{ gapTargetLine(ui.canopyGapTarget, meta.canopyGapTarget?.target ?? null, true) }}</p>
      <p class="text-caption mb-2">More acres means a larger gap. Larger tracts can have larger gaps. 0 acres = At or above target.</p>
    </template>
    <div class="d-flex" :class="dense ? 'flex-row flex-wrap align-center ga-2' : 'flex-column ga-1'">
      <div v-for="(r, i) in rows" :key="r.label" class="d-flex align-center ga-1">
        <span class="swatch" :style="{ background: r.color }" />
        <span class="text-caption" :aria-label="`${r.label}${lm.id === 'canopyGap' ? ' acres' : ''}, ${(counts[i] ?? 0).toLocaleString()} tracts`">{{ r.label }}<template v-if="lm.id === 'canopyGap'"> acres</template> <span class="text-medium-emphasis">· {{ (counts[i] ?? 0).toLocaleString() }}</span></span>
      </div>
      <div v-if="missingGap" class="d-flex align-center ga-1">
        <span class="swatch" :style="{ background: ui.isDark ? '#666666' : '#b8b8b8' }" />
        <span class="text-caption">No canopy-gap estimate</span>
      </div>
      <div v-if="missingCanopy" class="d-flex align-center ga-1">
        <span class="swatch" :style="{ background: ui.isDark ? '#666666' : '#b8b8b8' }" />
        <span class="text-caption">No canopy estimate (missing or mostly water)</span>
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
    <div v-if="belowMedian" class="text-caption text-medium-emphasis mt-1">{{ lm.id === 'canopyGap' ? lm.bmCaption : 'Dimmed = above city median' }}</div>
  </div>
</template>

<style scoped>
.swatch {
  display: inline-block;
  width: 16px;
  height: 12px;
  border-radius: 2px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.65);
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

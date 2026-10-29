<script setup lang="ts">
import { computed } from 'vue'
import type { TractCollection } from '@/types'
import { useUiStore } from '@/stores/ui'

/** #86: decorative CSS scatter — tree density (Y) vs tract area (X), full pack, theme primary. No chart lib. */
const props = defineProps<{ tracts: TractCollection | null; loading?: boolean }>()
const ui = useUiStore()

const plot = computed(() => {
  if (props.loading) return null
  const km2 = ui.densityUnit === 'km2'
  const pts: { x: number; y: number }[] = []
  for (const f of props.tracts?.features ?? []) {
    const p = f.properties
    const y = km2 ? p.treesPerKm2 : p.treesPerAcre
    const x = km2 ? p.areaKm2 : p.areaAcres
    if (Number.isFinite(y) && Number.isFinite(x) && x > 0) pts.push({ x, y })
  }
  if (pts.length < 2) return null
  let xMax = 0
  let yMax = 0
  for (const p of pts) { if (p.x > xMax) xMax = p.x; if (p.y > yMax) yMax = p.y }
  if (!(xMax > 0) || !(yMax > 0)) return null
  return {
    dots: pts.map((p) => ({ left: (p.x / xMax) * 100, bottom: (p.y / yMax) * 100 })),
    aria: `Scatter plot of tree density versus tract area for ${pts.length} tracts`,
    unit: km2 ? 'km²' : 'acre',
    zeros: pts.filter((p) => p.y === 0).length,
  }
})
</script>

<template>
  <div v-if="plot" class="das mt-2">
    <div class="text-caption" aria-hidden="true">Density vs area</div>
    <div class="das-box" role="img" :aria-label="plot.aria">
      <span class="das-grid das-grid--h" aria-hidden="true" />
      <span class="das-grid das-grid--v" aria-hidden="true" />
      <span v-for="(d, i) in plot.dots" :key="i" class="das-dot" aria-hidden="true" :style="{ left: d.left + '%', bottom: d.bottom + '%' }" />
    </div>
    <div class="text-caption text-medium-emphasis" aria-hidden="true">trees/{{ plot.unit }} ↑ vs area ({{ plot.unit }}) →</div>
    <div v-if="plot.zeros > 0" class="text-caption text-medium-emphasis">Including {{ plot.zeros }} with no mapped trees</div>
  </div>
</template>

<style scoped>
.das-box { position: relative; width: 100%; height: 120px; border-radius: 4px; background: rgba(var(--v-theme-on-surface), 0.08); overflow: hidden; }
.das-grid { position: absolute; background: rgba(var(--v-theme-on-surface), 0.08); }
.das-grid--h { left: 0; right: 0; top: 50%; height: 1px; }
.das-grid--v { top: 0; bottom: 0; left: 50%; width: 1px; }
.das-dot { position: absolute; width: 6px; height: 6px; border-radius: 50%; transform: translate(-50%, 50%); background: rgba(var(--v-theme-primary), 0.55); border: 1px solid rgba(var(--v-theme-surface), 0.9); box-sizing: border-box; }
</style>

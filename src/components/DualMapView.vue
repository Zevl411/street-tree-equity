<script setup lang="ts">
/** #105: same-city two-metric view — Trees | Risk panes, synced cameras, one selection. */
import { computed, nextTick, ref, watch } from 'vue'
import type { FeatureCollection } from 'geojson'
import type { Meta, ParkCollection, TractCollection } from '@/types'
import type { SessionView } from '@/composables/useSessionView'
import MapView, { type CameraState } from '@/components/MapView.vue'
import MapLegend from '@/components/MapLegend.vue'
import { METRICS, metricMeta, type MetricId } from '@/utils/metrics'

const props = defineProps<{
  mobile?: boolean
  dataPath: string
  meta: Meta
  tracts: TractCollection
  initialView?: SessionView | null
  parks: ParkCollection
  roads: FeatureCollection | null
  bike?: FeatureCollection | null
  transit?: FeatureCollection | null
  trees?: FeatureCollection | null
  schools?: FeatureCollection | null
  focusMode?: boolean
  hotspotsOpen?: boolean
  hotspotGeoids?: string[]
  belowMedian?: boolean
}>()
const emit = defineEmits<{ satelliteError: [] }>()

const PANES: MetricId[] = ['trees', 'risk']
const metas = computed(() => Object.fromEntries(PANES.map((id) => [id, metricMeta(props.meta, id)])) as Record<MetricId, Meta>)
const title = (id: MetricId) => (id === 'trees' ? 'Street trees' : 'Risk (NRI)')

// Mobile: segmented primary pane + ≥96px peek of the other.
const mobilePrimary = ref<MetricId>('trees')
const panes = ref<Record<string, InstanceType<typeof MapView> | null>>({})
const setPane = (id: MetricId) => (el: unknown) => { panes.value[id] = el as InstanceType<typeof MapView> | null }
function onCamera(from: MetricId, c: CameraState) {
  for (const id of PANES) if (id !== from) panes.value[id]?.syncCamera(c)
}
watch([mobilePrimary, () => props.mobile], () => nextTick(() => PANES.forEach((id) => panes.value[id]?.resize())))

// Camera commands drive the Trees pane; the Risk pane follows via sync.
type PaneApi = InstanceType<typeof MapView>
defineExpose({
  flyTo: (...a: Parameters<PaneApi['flyTo']>) => panes.value.trees?.flyTo(...a),
  fitData: () => panes.value.trees?.fitData(),
  fitRoad: (...a: Parameters<PaneApi['fitRoad']>) => panes.value.trees?.fitRoad(...a),
  resize: () => PANES.forEach((id) => panes.value[id]?.resize()),
})
</script>

<template>
  <div class="dual" :class="mobile ? 'dual-mobile' : 'dual-desktop'" role="region" aria-label="Dual map view, street trees and risk">
    <div v-if="mobile" class="dual-seg">
      <v-btn-toggle v-model="mobilePrimary" mandatory divided variant="outlined" density="comfortable" color="primary" class="w-100" aria-label="Primary dual pane">
        <v-btn v-for="id in PANES" :key="id" :value="id" class="flex-grow-1" min-height="44">{{ METRICS[id].shortLabel }}</v-btn>
      </v-btn-toggle>
    </div>
    <section v-for="id in PANES" :key="id" class="pane" role="region" :aria-label="`${title(id)} map`"
      :class="mobile ? (mobilePrimary === id ? 'pane-main' : 'pane-peek') : ''">
      <MapView :ref="setPane(id)" :metric-id="id" :secondary="id !== 'trees'" :mobile="mobile" :initial-view="initialView"
        :data-path="dataPath" :meta="metas[id]" :tracts="tracts" :parks="parks" :roads="roads" :bike="bike" :transit="transit"
        :trees="trees" :schools="schools" :focus-mode="focusMode" :hotspots-open="hotspotsOpen" :hotspot-geoids="hotspotGeoids"
        @camera="(c: CameraState) => onCamera(id, c)" @satellite-error="emit('satelliteError')" />
      <v-sheet v-if="!mobile || mobilePrimary === id" class="pane-legend pa-2" rounded elevation="2" color="surface">
        <div class="text-subtitle-2">{{ title(id) }}</div>
        <MapLegend :meta="metas[id]" :metric-id="id" :tracts="tracts" :below-median="belowMedian" dense />
      </v-sheet>
      <div v-else class="peek-label text-caption">{{ title(id) }}</div>
    </section>
  </div>
</template>

<style scoped>
.dual { position: absolute; inset: 0; display: flex; }
.dual-desktop .pane { position: relative; flex: 1 1 0; min-width: 0; }
.dual-desktop .pane + .pane { border-left: 2px solid rgb(var(--v-theme-surface)); }
.dual-mobile { flex-direction: column; }
.dual-seg { padding: 4px; background: rgb(var(--v-theme-surface)); z-index: 2; }
.dual-mobile .pane { position: relative; }
.dual-mobile .pane-main { flex: 1 1 auto; order: 1; }
.dual-mobile .pane-peek { flex: 0 0 104px; min-height: 96px; order: 2; border-top: 2px solid rgb(var(--v-theme-surface)); }
.pane-legend { position: absolute; left: 8px; bottom: 28px; z-index: 1; max-width: calc(100% - 16px); }
.peek-label { position: absolute; left: 8px; top: 4px; z-index: 1; padding: 2px 6px; border-radius: 4px; background: rgb(var(--v-theme-surface)); }
</style>

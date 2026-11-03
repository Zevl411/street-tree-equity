<script setup lang="ts">
/** #105/#113: same-city two-metric view — any two MetricId panes, synced cameras, one selection. */
import { computed, nextTick, ref, watch } from 'vue'
import type { FeatureCollection } from 'geojson'
import type { Meta, ParkCollection, TractCollection } from '@/types'
import type { SessionView } from '@/composables/useSessionView'
import MapView, { type CameraState } from '@/components/MapView.vue'
import MapLegend from '@/components/MapLegend.vue'
import { METRICS, metricMeta, type MetricId } from '@/utils/metrics'

const props = defineProps<{
  leftMetric: MetricId
  rightMetric: MetricId
  mobile?: boolean
  dataPath: string
  meta: Meta
  tracts: TractCollection
  initialView?: SessionView | null
  parks: ParkCollection
  roads: FeatureCollection | null
  bike?: FeatureCollection | null
  transit?: FeatureCollection | null
  sidewalks?: FeatureCollection | null
  trees?: FeatureCollection | null
  schools?: FeatureCollection | null
  libraries?: FeatureCollection | null
  gardens?: FeatureCollection | null
  fountains?: FeatureCollection | null
  postOffices?: FeatureCollection | null
  clinics?: FeatureCollection | null
  emergency?: FeatureCollection | null
  focusMode?: boolean
  hotspotsOpen?: boolean
  hotspotGeoids?: string[]
  belowMedian?: boolean
}>()
const emit = defineEmits<{ satelliteError: [] }>()

type Side = 'left' | 'right'
const PANES: Side[] = ['left', 'right']
const metricOf = (s: Side): MetricId => (s === 'left' ? props.leftMetric : props.rightMetric)
const metas = computed(() => ({ left: metricMeta(props.meta, props.leftMetric), right: metricMeta(props.meta, props.rightMetric) }) as Record<Side, Meta>)
const title = (s: Side) => METRICS[metricOf(s)].shortLabel
const regionLabel = computed(() => `Dual map view, ${title('left')} and ${title('right')}`)

// Mobile: segmented primary pane + ≥96px peek of the other.
const mobilePrimary = ref<Side>('left')
const panes = ref<Record<string, InstanceType<typeof MapView> | null>>({})
const setPane = (id: Side) => (el: unknown) => { panes.value[id] = el as InstanceType<typeof MapView> | null }
function onCamera(from: Side, c: CameraState) {
  for (const id of PANES) if (id !== from) panes.value[id]?.syncCamera(c)
}
watch([mobilePrimary, () => props.mobile], () => nextTick(() => PANES.forEach((id) => panes.value[id]?.resize())))

// Camera commands drive the left pane; the right pane follows via sync.
type PaneApi = InstanceType<typeof MapView>
defineExpose({
  flyTo: (...a: Parameters<PaneApi['flyTo']>) => panes.value.left?.flyTo(...a),
  fitData: () => panes.value.left?.fitData(),
  fitRoad: (...a: Parameters<PaneApi['fitRoad']>) => panes.value.left?.fitRoad(...a),
  resize: () => PANES.forEach((id) => panes.value[id]?.resize()),
})
</script>

<template>
  <div class="dual" :class="mobile ? 'dual-mobile' : 'dual-desktop'" role="region" :aria-label="regionLabel">
    <div v-if="mobile" class="dual-seg">
      <v-btn-toggle v-model="mobilePrimary" mandatory divided variant="outlined" density="comfortable" color="primary" class="w-100" aria-label="Primary dual pane">
        <v-btn v-for="id in PANES" :key="id" :value="id" class="flex-grow-1" min-height="44">{{ title(id) }}</v-btn>
      </v-btn-toggle>
    </div>
    <section v-for="id in PANES" :key="id" class="pane" role="region" :aria-label="`${title(id)} map`"
      :class="mobile ? (mobilePrimary === id ? 'pane-main' : 'pane-peek') : ''">
      <MapView :ref="setPane(id)" :metric-id="metricOf(id)" :secondary="id !== 'left'" :mobile="mobile" :initial-view="initialView"
        :data-path="dataPath" :meta="metas[id]" :tracts="tracts" :parks="parks" :roads="roads" :bike="bike" :transit="transit"
        :trees="trees" :schools="schools" :libraries="libraries" :gardens="gardens" :fountains="fountains" :post-offices="postOffices" :clinics="clinics" :emergency="emergency" :sidewalks="sidewalks" :focus-mode="focusMode" :hotspots-open="hotspotsOpen" :hotspot-geoids="hotspotGeoids"
        @camera="(c: CameraState) => onCamera(id, c)" @satellite-error="emit('satelliteError')" />
      <v-sheet v-if="!mobile || mobilePrimary === id" class="pane-legend pa-2" rounded elevation="2" color="surface">
        <div class="text-subtitle-2">{{ title(id) }}</div>
        <MapLegend :meta="metas[id]" :metric-id="metricOf(id)" :tracts="tracts" :below-median="belowMedian" dense />
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

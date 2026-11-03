<script setup lang="ts">
import { computed } from 'vue'
import { VBottomSheet, VDialog } from 'vuetify/components'
import type { TractFeature } from '@/types'
import { ACRES_PER_KM2, useUiStore } from '@/stores/ui'
import { fmtUnitless, metricValue } from '@/utils/metrics'
import { hotspotTracts } from '@/utils/hotspots'
import { hotspotAscending } from '@/utils/metrics'
import { downloadBlob, exportFilename, toHotspotsCsv } from '@/utils/exportData'

/** #43 Low-canopy hotspots: the 10 lowest-density tracts from already-loaded GeoJSON. */
const props = defineProps<{
  mobile: boolean
  tracts: TractFeature[] | null
  loading: boolean
  cityName: string
  unit: 'acre' | 'km2'
  cityId: string | null
  /** #102: pack ships schools.geojson + schoolsInside; false → omit school caption. */
  hasSchools?: boolean
  /** #108: pack ships libraries.geojson + civicInside; false → omit civic caption. */
  hasLibraries?: boolean
  /** #122: pack ships gardens.geojson + gardensInside; false → omit gardens caption. */
  hasGardens?: boolean
  /** #113: dual view on → [left, right] labels for the primary-pane segmented control. */
  dualLabels?: [string, string] | null
}>()
const open = defineModel<boolean>({ default: false })
const emit = defineEmits<{ pick: [geoid: string]; exported: [] }>()

const total = computed(() => props.tracts?.length ?? 0)
const ui = useUiStore()
/** #98/#99: amenity metrics → metric-def title, sorted by active valueKey. */
const isParks = computed(() => ui.metric.fine)
const items = computed(() => hotspotTracts(props.tracts, ui.metric.valueKey, hotspotAscending(ui.metric)))
const val = (p: object) => metricValue(p, ui.metric.valueKey)
const unitless = computed(() => !ui.metric.usesDensityUnit)
const unitLabel = computed(() => (props.unit === 'km2' ? 'km²' : 'acre'))
function density(tpa: number) {
  if (unitless.value) return fmtUnitless(ui.metric, tpa)
  return props.unit === 'km2'
    ? (tpa * ACRES_PER_KM2).toLocaleString(undefined, { maximumFractionDigits: 1 })
    : tpa.toFixed(isParks.value ? 4 : 2)
}
/** #102: sum pack-joined schoolsInside over the current hotspot set (any active metric). */
const schoolCaption = computed(() => {
  if (!props.hasSchools || props.loading || !items.value.length) return ''
  if (!items.value.some((f) => Number.isFinite((f.properties as { schoolsInside?: number }).schoolsInside))) return ''
  const n = items.value.reduce((a, f) => a + ((f.properties as { schoolsInside?: number }).schoolsInside ?? 0), 0)
  return n ? `${n} ${n === 1 ? 'school' : 'schools'} in these hotspots` : 'No schools in these hotspots'
})
// #108 soft: libraries + community centres in hotspots (sum civicInside).
const civicCaption = computed(() => {
  if (!props.hasLibraries || props.loading || !items.value.length) return ''
  const v = items.value.map((f) => (f.properties as { civicInside?: number }).civicInside).filter((n): n is number => typeof n === 'number')
  if (!v.length) return ''
  const n = v.reduce((a, b) => a + b, 0)
  return n ? `${n} ${n === 1 ? 'library or community centre' : 'libraries & community centres'} in these hotspots` : 'None in these hotspots'
})
// #122 soft: gardens + allotments in hotspots (sum gardensInside + allotmentsInside).
const gardensCaption = computed(() => {
  if (!props.hasGardens || props.loading || !items.value.length) return ''
  const v = items.value.map((f) => f.properties as { gardensInside?: number; allotmentsInside?: number }).filter((p) => typeof p.gardensInside === 'number' || typeof p.allotmentsInside === 'number')
  if (!v.length) return ''
  const n = v.reduce((a, p) => a + (p.gardensInside ?? 0) + (p.allotmentsInside ?? 0), 0)
  return n ? `${n} ${n === 1 ? 'garden or allotment' : 'gardens & allotments'} in these hotspots` : 'None in these hotspots'
})
// #104 soft: transit stop caption; '' when pack has no transit data.
const transitCaption = computed(() => {
  if (props.loading || !items.value.length) return ''
  const v = items.value.map((f) => f.properties.transitStopsInside).filter((n): n is number => typeof n === 'number')
  if (!v.length) return ''
  const n = v.reduce((a, b) => a + b, 0)
  return n ? `${n} ${n === 1 ? 'transit stop' : 'transit stops'} in these hotspots` : 'No transit stops in these hotspots'
})
const noTracts = computed(() => !props.loading && total.value === 0)
const status = computed(() => (props.loading || !items.value.length ? '' : `${items.value.length} ${ui.metric.hotspotNoun ? ui.metric.hotspotNoun[1] : 'low-canopy tracts'}`))

const canExport = computed(() => !props.loading && items.value.length > 0 && !!props.cityId)
function exportCsv() {
  if (!canExport.value || !props.cityId) return
  downloadBlob(toHotspotsCsv(items.value.map((f) => f.properties), props.cityId, props.unit),
    exportFilename(props.cityId, 'hotspots', 'csv'), 'text/csv;charset=utf-8')
  emit('exported')
}

function pick(geoid: string) {
  open.value = false
  emit('pick', geoid)
}
</script>

<template>
  <component :is="mobile ? VBottomSheet : VDialog" v-model="open" :max-width="mobile ? undefined : 380" scrollable>
    <v-card id="hotspots-panel" :density="mobile ? 'comfortable' : 'compact'">
      <v-card-title class="d-flex align-center text-subtitle-1">
        {{ ui.metric.hotspotTitle }}
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" size="small" aria-label="Close" class="hotspots-close" @click="open = false" />
      </v-card-title>
      <v-card-text class="pb-2">
        <div v-if="dualLabels" class="d-flex align-center ga-2 mb-2 hotspots-dual">
          <span class="text-caption">Hotspots for:</span>
          <v-btn-toggle :model-value="ui.dualPrimary" mandatory divided density="compact" variant="outlined" color="primary"
            aria-label="Hotspots for" @update:model-value="(v: 'left' | 'right') => (ui.dualPrimary = v)">
            <v-btn value="left" size="small" min-height="44">{{ dualLabels[0] }}</v-btn>
            <v-btn value="right" size="small" min-height="44">{{ dualLabels[1] }}</v-btn>
          </v-btn-toggle>
        </div>
        <p class="text-caption text-medium-emphasis mb-1">
          {{ loading ? 'Loading tracts…' : `${hotspotAscending(ui.metric) ? 'Lowest' : 'Highest'} ${ui.metric.unitNoun} in ${cityName} · tap to open` }}
        </p>
        <p v-if="schoolCaption" class="text-caption text-medium-emphasis mb-1 hotspots-schools">{{ schoolCaption }}</p>
        <p v-if="civicCaption" class="text-caption text-medium-emphasis mb-1 hotspots-civic">{{ civicCaption }}</p>
        <p v-if="gardensCaption" class="text-caption text-medium-emphasis mb-1 hotspots-gardens">{{ gardensCaption }}</p>
        <p v-if="transitCaption" class="text-caption text-medium-emphasis mb-1">{{ transitCaption }}</p>
        <div role="status" aria-live="polite" class="sr-only">{{ status }}</div>
        <p v-if="noTracts" class="text-body-2 mt-2">No tract data for this city yet.</p>
        <p v-else-if="!loading && !items.length" class="text-body-2 mt-2">No hotspots to show.</p>
        <v-list v-else :density="mobile ? 'comfortable' : 'compact'" :disabled="loading" class="mt-1"
          style="max-height: 60vh; overflow-y: auto">
          <v-list-item v-for="f in items" :key="f.properties.geoid" min-height="48" :title="f.properties.name"
            :subtitle="`${density(val(f.properties))}${unitless ? '' : ` /${unitLabel}`} · #${f.properties.rank} of ${total}`"
            :aria-label="`Open ${f.properties.name}, ${density(val(f.properties))} ${unitless ? ui.metric.unitNoun : `per ${unitLabel}`}, rank ${f.properties.rank} of ${total}`"
            @click="pick(f.properties.geoid)">
            <template v-if="f.properties.bottomQuartile" #append>
              <v-chip size="x-small" variant="tonal" color="warning">Bottom 25%</v-chip>
            </template>
          </v-list-item>
        </v-list>
      </v-card-text>
      <v-card-actions class="flex-column align-start px-4 pt-0 pb-3">
        <v-btn variant="text" size="small" prepend-icon="mdi-download" :disabled="!canExport"
          aria-label="Export hotspots CSV" class="hotspots-export" @click="exportCsv">Export CSV</v-btn>
        <span class="text-caption text-medium-emphasis">Includes OSM-derived values (ODbL).</span>
      </v-card-actions>
    </v-card>
  </component>
</template>

<style scoped>
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>

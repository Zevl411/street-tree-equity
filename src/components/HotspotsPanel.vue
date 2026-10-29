<script setup lang="ts">
import { computed } from 'vue'
import { VBottomSheet, VDialog } from 'vuetify/components'
import type { TractFeature } from '@/types'
import { ACRES_PER_KM2 } from '@/stores/ui'

/** #43 Low-canopy hotspots: the 10 lowest-density tracts from already-loaded GeoJSON. */
const props = defineProps<{
  mobile: boolean
  tracts: TractFeature[] | null
  loading: boolean
  cityName: string
  unit: 'acre' | 'km2'
}>()
const open = defineModel<boolean>({ default: false })
const emit = defineEmits<{ pick: [geoid: string] }>()

const MAX = 10
const total = computed(() => props.tracts?.length ?? 0)
const items = computed(() =>
  [...(props.tracts ?? [])]
    .filter((f) => Number.isFinite(f.properties.treesPerAcre))
    .sort((a, b) => {
      const pa = a.properties, pb = b.properties
      return pa.treesPerAcre - pb.treesPerAcre
        || (pb.rank ?? 0) - (pa.rank ?? 0)
        || (pa.name ?? '').localeCompare(pb.name ?? '', undefined, { numeric: true })
    })
    .slice(0, MAX),
)
const unitLabel = computed(() => (props.unit === 'km2' ? 'km²' : 'acre'))
function density(tpa: number) {
  return props.unit === 'km2'
    ? (tpa * ACRES_PER_KM2).toLocaleString(undefined, { maximumFractionDigits: 1 })
    : tpa.toFixed(2)
}
const noTracts = computed(() => !props.loading && total.value === 0)
const status = computed(() => (props.loading || !items.value.length ? '' : `${items.value.length} low-canopy tracts`))

function pick(geoid: string) {
  open.value = false
  emit('pick', geoid)
}
</script>

<template>
  <component :is="mobile ? VBottomSheet : VDialog" v-model="open" :max-width="mobile ? undefined : 380" scrollable>
    <v-card id="hotspots-panel" :density="mobile ? 'comfortable' : 'compact'">
      <v-card-title class="d-flex align-center text-subtitle-1">
        Low-canopy hotspots
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" size="small" aria-label="Close" class="hotspots-close" @click="open = false" />
      </v-card-title>
      <v-card-text class="pb-2">
        <p class="text-caption text-medium-emphasis mb-1">
          {{ loading ? 'Loading tracts…' : `Lowest tree density in ${cityName} · tap to open` }}
        </p>
        <div role="status" aria-live="polite" class="sr-only">{{ status }}</div>
        <p v-if="noTracts" class="text-body-2 mt-2">No tract data for this city yet.</p>
        <p v-else-if="!loading && !items.length" class="text-body-2 mt-2">No hotspots to show.</p>
        <v-list v-else :density="mobile ? 'comfortable' : 'compact'" :disabled="loading" class="mt-1"
          style="max-height: 60vh; overflow-y: auto">
          <v-list-item v-for="f in items" :key="f.properties.geoid" min-height="48" :title="f.properties.name"
            :subtitle="`${density(f.properties.treesPerAcre)} /${unitLabel} · #${f.properties.rank} of ${total}`"
            :aria-label="`Open ${f.properties.name}, ${density(f.properties.treesPerAcre)} per ${unitLabel}, rank ${f.properties.rank} of ${total}`"
            @click="pick(f.properties.geoid)">
            <template v-if="f.properties.bottomQuartile" #append>
              <v-chip size="x-small" variant="tonal" color="warning">Bottom 25%</v-chip>
            </template>
          </v-list-item>
        </v-list>
      </v-card-text>
    </v-card>
  </component>
</template>

<style scoped>
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>

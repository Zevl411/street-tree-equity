<script setup lang="ts">
import { computed, watch } from 'vue'
import { VBottomSheet, VDialog } from 'vuetify/components'
import type { TractFeature } from '@/types'
import { ACRES_PER_KM2 } from '@/stores/ui'
import { useFavorites } from '@/composables/useFavorites'

/** #45 Starred tracts for the active city (storage order, pruned to the loaded pack). */
const props = defineProps<{
  mobile: boolean
  tracts: TractFeature[] | null
  loading: boolean
  cityName: string
  unit: 'acre' | 'km2'
  cityId: string | null
}>()
const open = defineModel<boolean>({ default: false })
const emit = defineEmits<{ pick: [geoid: string] }>()

const fav = useFavorites()
const total = computed(() => props.tracts?.length ?? 0)
const byGeoid = computed(() => new Map((props.tracts ?? []).map((f) => [f.properties.geoid, f])))
// Prune foreign GEOIDs whenever the list opens or the pack changes.
watch([open, byGeoid, () => props.cityId], () => {
  if (open.value && byGeoid.value.size) fav.prune(props.cityId, byGeoid.value.keys())
}, { immediate: true })
const items = computed(() =>
  fav.list(props.cityId).map((g) => byGeoid.value.get(g)).filter((f): f is TractFeature => !!f),
)
const unitLabel = computed(() => (props.unit === 'km2' ? 'km²' : 'acre'))
function density(tpa: number) {
  return props.unit === 'km2'
    ? (tpa * ACRES_PER_KM2).toLocaleString(undefined, { maximumFractionDigits: 1 })
    : tpa.toFixed(2)
}
const noTracts = computed(() => !props.loading && total.value === 0)
const status = computed(() => (props.loading || !items.value.length ? '' : `${items.value.length} starred tracts`))

function pick(geoid: string) {
  open.value = false
  emit('pick', geoid)
}
</script>

<template>
  <component :is="mobile ? VBottomSheet : VDialog" v-model="open" :max-width="mobile ? undefined : 380" scrollable>
    <v-card id="favorites-panel" :density="mobile ? 'comfortable' : 'compact'">
      <v-card-title class="d-flex align-center text-subtitle-1">
        Starred tracts
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" size="small" aria-label="Close" class="favorites-close" @click="open = false" />
      </v-card-title>
      <v-card-text class="pb-2">
        <p class="text-caption text-medium-emphasis mb-1">
          {{ loading ? 'Loading tracts…' : `Saved for ${cityName} · tap to open` }}
        </p>
        <div role="status" aria-live="polite" class="sr-only">{{ status }}</div>
        <p v-if="noTracts" class="text-body-2 mt-2">No tract data for this city yet.</p>
        <p v-else-if="!loading && !items.length" class="text-body-2 mt-2">No starred tracts yet. Open a tract and tap the star to save it here.</p>
        <v-list v-else :density="mobile ? 'comfortable' : 'compact'" :disabled="loading" class="mt-1"
          style="max-height: 60vh; overflow-y: auto">
          <v-list-item v-for="f in items" :key="f.properties.geoid" min-height="48" :title="f.properties.name"
            :subtitle="`#${f.properties.rank} of ${total} · ${density(f.properties.treesPerAcre)} /${unitLabel}`"
            :aria-label="`Open ${f.properties.name}`"
            @click="pick(f.properties.geoid)">
            <template #append>
              <v-btn icon="mdi-star" color="warning" variant="text" size="small" aria-label="Remove star"
                @click.stop="fav.toggle(cityId, f.properties.geoid)" @keydown.enter.stop @keydown.space.stop />
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

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { VBottomSheet, VDialog } from 'vuetify/components'
import type { TractFeature } from '@/types'

const props = defineProps<{
  mobile: boolean
  tracts: TractFeature[] | null
  loading: boolean
  cityId: string | null
}>()
const open = defineModel<boolean>({ default: false })
const emit = defineEmits<{ pick: [geoid: string] }>()

const MAX = 25
const query = ref('')
const q = computed(() => query.value?.trim().toLowerCase() ?? '')

const results = computed(() => {
  const list = props.tracts ?? []
  if (!q.value) return { items: [] as TractFeature[], truncated: false }
  const byName: TractFeature[] = []
  const byGeoid: TractFeature[] = []
  for (const f of list) {
    const p = f.properties
    if ((p.name ?? '').toLowerCase().includes(q.value)) byName.push(f)
    else if ((p.geoid ?? '').toLowerCase().includes(q.value)) byGeoid.push(f)
  }
  byName.sort((a, b) => a.properties.name.localeCompare(b.properties.name, undefined, { numeric: true }))
  const prefix = (f: TractFeature) => (f.properties.geoid.toLowerCase().startsWith(q.value) ? 0 : 1)
  byGeoid.sort((a, b) => prefix(a) - prefix(b) || a.properties.geoid.localeCompare(b.properties.geoid))
  const all = [...byName, ...byGeoid]
  return { items: all.slice(0, MAX), truncated: all.length > MAX }
})

const noTracts = computed(() => !props.loading && (props.tracts?.length ?? 0) === 0)
const status = computed(() => {
  if (!q.value || props.loading || noTracts.value) return ''
  const n = results.value.items.length
  return n ? `${n} tracts` : 'No tracts matched'
})

watch(open, (v) => { if (!v) query.value = '' })
watch(() => props.cityId, () => { query.value = '' })

function pick(geoid: string) {
  open.value = false
  emit('pick', geoid)
}
</script>

<template>
  <component :is="mobile ? VBottomSheet : VDialog" v-model="open" :max-width="mobile ? undefined : 360" scrollable>
    <v-card id="tract-finder-panel" :density="mobile ? 'comfortable' : 'compact'">
      <v-card-title class="d-flex align-center text-subtitle-1">
        Find a tract
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" size="small" aria-label="Close" @click="open = false" />
      </v-card-title>
      <v-card-text class="pb-2">
        <v-text-field v-model="query" label="Name or GEOID" prepend-inner-icon="mdi-magnify" autocomplete="off"
          clearable autofocus :density="mobile ? 'comfortable' : 'compact'" :disabled="loading || noTracts"
          :hint="loading ? 'Loading tracts…' : noTracts ? 'No tract data for this city yet.' : 'Search this city’s tracts by name or GEOID.'"
          persistent-hint @keydown.enter="results.items[0] && pick(results.items[0].properties.geoid)" />
        <div role="status" aria-live="polite" class="sr-only">{{ status }}</div>
        <p v-if="q && !loading && !noTracts && !results.items.length" class="text-body-2 mt-3">
          No tracts matched. Try another name or GEOID.
        </p>
        <v-list v-if="results.items.length" :density="mobile ? 'comfortable' : 'compact'" class="mt-2"
          style="max-height: 50vh; overflow-y: auto">
          <v-list-item v-for="f in results.items" :key="f.properties.geoid" :title="f.properties.name"
            :subtitle="`GEOID ${f.properties.geoid}${f.properties.county ? ' · ' + f.properties.county : ''}`"
            :aria-label="`Select ${f.properties.name}, GEOID ${f.properties.geoid}`"
            @click="pick(f.properties.geoid)" />
        </v-list>
        <p v-if="results.truncated" class="text-caption mt-1">Showing first 25 matches. Refine your search.</p>
      </v-card-text>
    </v-card>
  </component>
</template>

<style scoped>
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>

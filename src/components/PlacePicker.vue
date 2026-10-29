<script setup lang="ts">
import { ref, watch } from 'vue'
import { VBottomSheet, VMenu } from 'vuetify/components'
import { matchCity, useNominatim } from '@/composables/useNominatim'
import { storeToRefs } from 'pinia'
import { useCityStore } from '@/stores/city'
import type { PlaceResult } from '@/types'

defineProps<{ label: string; mobile?: boolean }>()
// App loads the city's data on select, so city switches still go through the emit.
const emit = defineEmits<{ select: [id: string] }>()
const cityStore = useCityStore()
const { cities, cityId: selectedId } = storeToRefs(cityStore)

const README_URL = 'https://github.com/Zevl411/street-tree-equity/blob/main/README.md#add-or-switch-cities'
const open = ref(false)
const query = ref('')
const notBuilt = ref<PlaceResult | null>(null)
const { searching, results, failed, now, reset } = useNominatim()

// Enter-to-search only (Nominatim usage policy: no autocomplete).
watch(open, (o) => { if (!o) { reset(); query.value = '' } })

function pickCity(id: string) {
  notBuilt.value = null
  open.value = false
  emit('select', id)
}
function pickResult(r: PlaceResult) {
  const c = matchCity(r, cities.value)
  if (c) return pickCity(c.id)
  notBuilt.value = r
  open.value = false
  cityStore.setNotBuilt(r)
}
</script>

<template>
  <component :is="mobile ? VBottomSheet : VMenu" v-model="open" :close-on-content-click="false"
    v-bind="mobile ? {} : { location: 'bottom start' }">
    <template #activator="{ props: act }">
      <v-btn v-if="mobile" v-bind="act" icon aria-label="Change place">
        <v-icon icon="mdi-map-search" />
        <v-tooltip activator="parent" location="bottom">Change place</v-tooltip>
      </v-btn>
      <v-btn v-else v-bind="act" variant="tonal" class="text-none mr-2" prepend-icon="mdi-map-marker"
        append-icon="mdi-menu-down" aria-label="Change place">{{ label || 'Choose place' }}
        <v-tooltip activator="parent" location="bottom">Change place</v-tooltip>
      </v-btn>
    </template>
    <v-card :width="mobile ? undefined : 320" title="Choose a place">
      <v-card-text class="pb-0">
        <v-text-field v-model="query" label="Search for a city" prepend-inner-icon="mdi-magnify" autocomplete="off"
          density="compact" variant="outlined" hide-details :loading="searching" @keydown.enter.prevent="now(query)" />
        <div v-if="searching" class="text-caption mt-1" role="status" aria-live="polite">Searching…</div>
        <div class="text-caption mt-1 opacity-70">Press Enter to search. Search uses OpenStreetMap Nominatim (free, no key).</div>
        <v-alert v-if="failed" type="warning" density="compact" class="mt-2"
          text="Place search is temporarily unavailable. Pick a listed city or try again in a minute." />
        <div v-else-if="results && !results.length && !searching" class="text-body-2 mt-2">
          No places matched. Try a city name (e.g. Portland, OR).
        </div>
      </v-card-text>
      <v-list density="compact">
        <template v-if="results?.length">
          <v-list-item v-for="r in results" :key="r.place_id" lines="two"
            prepend-icon="mdi-map-marker-outline" :aria-label="r.display_name" @click="pickResult(r)">
            <v-list-item-title class="text-wrap">{{ r.display_name.split(',')[0] }}</v-list-item-title>
            <v-list-item-subtitle class="text-wrap">{{ r.display_name.split(',').slice(1).join(',').trim() }}</v-list-item-subtitle>
            <v-tooltip activator="parent" location="end" open-delay="400">{{ r.display_name }}</v-tooltip>
          </v-list-item>
          <v-divider />
        </template>
        <v-list-subheader>Available demos</v-list-subheader>
        <v-list-item v-for="c in cities" :key="c.id" :title="c.cityName" :subtitle="c.subtitle"
          :active="c.id === selectedId" @click="pickCity(c.id)">
          <template #append><v-icon v-if="c.id === selectedId" icon="mdi-check" color="primary" /></template>
        </v-list-item>
        <template v-if="notBuilt">
          <v-list-subheader>Not built yet?</v-list-subheader>
          <v-list-item :title="notBuilt.display_name" lines="two" prepend-icon="mdi-help-circle-outline"
            :href="README_URL" target="_blank" rel="noopener noreferrer" />
        </template>
      </v-list>
      <v-card-text class="pt-0 text-caption opacity-70">
        Only built demos are listed. Want another city?
        <a :href="README_URL" target="_blank" rel="noopener noreferrer">See how to add one in the README<span class="sr-only"> (opens in new tab)</span></a>.
      </v-card-text>
    </v-card>
  </component>
</template>

<style scoped>
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>

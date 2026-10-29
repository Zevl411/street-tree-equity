<script setup lang="ts">
import { ref, watch } from 'vue'
import { VBottomSheet, VMenu } from 'vuetify/components'
import { matchCity, useNominatim } from '@/composables/useNominatim'
import type { CityEntry, PlaceResult } from '@/types'

const props = defineProps<{ cities: CityEntry[]; selectedId: string | null; label: string; mobile?: boolean }>()
const emit = defineEmits<{ select: [id: string]; notBuilt: [place: PlaceResult] }>()

const README_URL = 'https://github.com/Zevl411/street-tree-equity#add-or-switch-cities'
const open = ref(false)
const query = ref('')
const notBuilt = ref<PlaceResult | null>(null)
const { searching, results, failed, debounced, now, reset } = useNominatim()

watch(query, (q) => debounced(q ?? ''))
watch(open, (o) => { if (!o) { reset(); query.value = '' } })

function pickCity(id: string) {
  notBuilt.value = null
  open.value = false
  emit('select', id)
}
function pickResult(r: PlaceResult) {
  const c = matchCity(r, props.cities)
  if (c) return pickCity(c.id)
  notBuilt.value = r
  open.value = false
  emit('notBuilt', r)
}
</script>

<template>
  <component :is="mobile ? VBottomSheet : VMenu" v-model="open" :close-on-content-click="false"
    v-bind="mobile ? {} : { location: 'bottom start' }">
    <template #activator="{ props: act }">
      <v-btn v-if="mobile" v-bind="act" icon="mdi-map-search" aria-label="Change place" />
      <v-btn v-else v-bind="act" variant="tonal" class="text-none mr-2" prepend-icon="mdi-map-marker"
        append-icon="mdi-menu-down" aria-label="Change place">{{ label || 'Choose place' }}</v-btn>
    </template>
    <v-card :width="mobile ? undefined : 320" title="Choose a place">
      <v-card-text class="pb-0">
        <v-text-field v-model="query" label="Search for a city" prepend-inner-icon="mdi-magnify" autocomplete="off"
          density="compact" variant="outlined" hide-details :loading="searching" @keydown.enter.prevent="now(query)" />
        <div class="text-caption mt-1 opacity-70">Search uses OpenStreetMap Nominatim (free, no key).</div>
        <v-alert v-if="failed" type="warning" density="compact" class="mt-2"
          text="Place search is temporarily unavailable. Pick a listed city or try again in a minute." />
        <div v-else-if="results && !results.length && !searching" class="text-body-2 mt-2">
          No places matched. Try a city name (e.g. Portland, OR).
        </div>
      </v-card-text>
      <v-list density="compact">
        <template v-if="results?.length">
          <v-list-item v-for="r in results" :key="r.place_id" :title="r.display_name" lines="two"
            prepend-icon="mdi-map-marker-outline" @click="pickResult(r)" />
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
            :href="README_URL" target="_blank" rel="noopener" />
        </template>
      </v-list>
      <v-card-text class="pt-0 text-caption opacity-70">
        Demos ship static open data so the map stays free. Add a city via city.config.json — see README.
      </v-card-text>
    </v-card>
  </component>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useOverlayFocus } from '@/composables/useOverlayFocus'
import { VBottomSheet, VMenu } from 'vuetify/components'
import { storeToRefs } from 'pinia'
import { useCityStore } from '@/stores/city'
import { isReady, type CityEntry } from '@/types'

defineProps<{ label: string; mobile?: boolean }>()
// App loads the city's data on select, so city switches still go through the emit.
const emit = defineEmits<{ select: [id: string]; compare: [] }>()
const cityStore = useCityStore()
const { cities, cityId: selectedId, manifestError } = storeToRefs(cityStore)

const README_URL = 'https://github.com/Zevl411/street-tree-equity/blob/main/README.md#add-or-switch-cities'
const open = ref(false)
// #39: land on the first enabled city row; Vuetify/our helper returns focus to the activator.
useOverlayFocus(open, '#place-picker-panel .v-list-item:not(.v-list-item--disabled)')
const canCompare = computed(() => cities.value.filter(isReady).length >= 2)
function startCompare() {
  open.value = false
  emit('compare')
}

function pickCity(c: CityEntry) {
  if (!isReady(c)) return
  open.value = false
  emit('select', c.id)
}
</script>

<template>
  <component :is="mobile ? VBottomSheet : VMenu" v-model="open" v-bind="mobile ? {} : { location: 'bottom start' }">
    <template #activator="{ props: act }">
      <v-btn v-if="mobile" id="city-picker-btn" v-bind="act" icon aria-label="Change city">
        <v-icon icon="mdi-map-marker" />
        <v-tooltip activator="parent" location="bottom">Change city</v-tooltip>
      </v-btn>
      <v-btn v-else id="city-picker-btn" v-bind="act" variant="tonal" class="text-none mr-2" prepend-icon="mdi-map-marker"
        append-icon="mdi-menu-down" aria-label="Change city">{{ label || 'Choose city' }}
        <v-tooltip activator="parent" location="bottom">Change city</v-tooltip>
      </v-btn>
    </template>
    <v-card id="place-picker-panel" :width="mobile ? undefined : 320" title="Demo cities" :class="{ 'mobile-sheet': mobile }">
      <v-alert v-if="manifestError" type="warning" density="compact" class="mx-4 mb-2"
        text="Couldn't load the city list. Refresh and try again." />
      <v-card-text v-if="!cities.length" class="text-body-2">No demo cities are loaded yet.</v-card-text>
      <v-list v-else :density="mobile ? 'comfortable' : 'compact'" :class="{ 'mobile-list': mobile }">
        <template v-for="c in cities" :key="c.id">
          <v-list-item v-if="isReady(c)" :title="c.cityName" :subtitle="c.subtitle"
            :active="c.id === selectedId" @click="pickCity(c)">
            <template #append><v-icon v-if="c.id === selectedId" icon="mdi-check" color="primary" /></template>
          </v-list-item>
          <v-list-item v-else disabled lines="three" class="opacity-60" :aria-label="`${c.cityName} — Data pack not published yet`">
            <v-list-item-title>{{ c.cityName }}</v-list-item-title>
            <v-list-item-subtitle>{{ c.subtitle }}</v-list-item-subtitle>
            <div class="text-caption text-medium-emphasis">Data pack not published yet</div>
            <template #append><v-icon icon="mdi-clock-outline" color="disabled" /></template>
          </v-list-item>
        </template>
      </v-list>
      <div v-if="canCompare" class="px-2 pb-2">
        <v-btn variant="text" class="text-none" prepend-icon="mdi-compare" @click="startCompare">Compare two cities</v-btn>
      </div>
      <v-card-text class="pt-0 text-caption opacity-70" :class="{ 'safe-foot': mobile }">
        More cities coming. Packs are free open data —
        <a :href="README_URL" target="_blank" rel="noopener noreferrer">see how to add one in the README<span class="sr-only"> (opens in new tab)</span></a>.
      </v-card-text>
    </v-card>
  </component>
</template>

<style scoped>
.mobile-sheet { width: 100%; max-height: 85dvh; display: flex; flex-direction: column; }
.mobile-list { overflow-y: auto; flex: 1 1 auto; min-height: 0; }
.mobile-sheet :deep(.v-list-item-title), .mobile-sheet :deep(.v-list-item-subtitle) { white-space: normal; overflow-wrap: anywhere; }
.safe-foot { padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px)) !important; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>

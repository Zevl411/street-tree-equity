<script setup lang="ts">
// #88: offline banner + "Update available" snack. Registers the SW in production only.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRegisterSW } from 'virtual:pwa-register/vue'

const props = defineProps<{ cityName?: string; attempt?: unknown }>()

const offline = ref(false)
const dismissed = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
function sync() {
  clearTimeout(timer)
  // Debounce ~1s so brief blips don't flicker the banner.
  timer = setTimeout(() => {
    offline.value = !navigator.onLine
    if (!offline.value) dismissed.value = false
  }, 1000)
}
onMounted(() => {
  offline.value = !navigator.onLine
  window.addEventListener('online', sync)
  window.addEventListener('offline', sync)
})
onBeforeUnmount(() => {
  clearTimeout(timer)
  window.removeEventListener('online', sync)
  window.removeEventListener('offline', sync)
})
// Re-show on the next city attempt while still offline.
watch(() => props.attempt, () => { dismissed.value = false })

const { needRefresh, updateServiceWorker } = useRegisterSW({ immediate: import.meta.env.PROD })
</script>

<template>
  <v-banner v-if="offline && !dismissed" class="offline-banner" density="compact" color="warning" icon="mdi-cloud-off-outline"
    lines="one" role="status" aria-live="polite">
    <v-banner-text>
      <template v-if="cityName">You’re offline — showing saved data for {{ cityName }}. Map imagery may be missing.</template>
      <template v-else>You’re offline — showing saved app data. Map imagery may be missing.</template>
    </v-banner-text>
    <template #actions>
      <v-btn icon="mdi-close" variant="text" size="small" aria-label="Dismiss offline notice" @click="dismissed = true" />
    </template>
  </v-banner>
  <v-snackbar v-model="needRefresh" timeout="-1" location="bottom">
    Update available
    <template #actions>
      <v-btn color="primary" variant="flat" @click="updateServiceWorker(true)">Reload</v-btn>
      <v-btn variant="text" @click="needRefresh = false">Dismiss</v-btn>
    </template>
  </v-snackbar>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { VBottomSheet, VDialog } from 'vuetify/components'
import { storeToRefs } from 'pinia'
import { useCityStore } from '@/stores/city'
import { ACRES_PER_KM2, useUiStore } from '@/stores/ui'
import { dataUrl } from '@/composables/useData'
import { isReady, type Meta, type TractCollection } from '@/types'

const props = defineProps<{ mobile?: boolean; initial?: [string, string] | null }>()
const open = defineModel<boolean>({ default: false })
const emit = defineEmits<{ open: [id: string]; copied: [msg: string] }>()

const cityStore = useCityStore()
const ui = useUiStore()
const { cities, cityId } = storeToRefs(cityStore)
const ready = computed(() => cities.value.filter(isReady))
const items = computed(() => ready.value.map((c) => ({ title: c.cityName, value: c.id })))

const a = ref<string | null>(null)
const b = ref<string | null>(null)
const same = computed(() => !!a.value && a.value === b.value)
const canCompare = computed(() => !!a.value && !!b.value && !same.value)

interface Stats {
  tracts: number; median: number | null; mean: number | null
  medianKm2: number | null; meanKm2: number | null
  bq: number | null; parks: number | null; roadKm: number | null
}
const loading = ref(false)
const failed = ref(false)
const result = ref<{ a: { name: string; s: Stats }; b: { name: string; s: Stats } } | null>(null)

function defaults() {
  result.value = null
  failed.value = false
  if (props.initial) { [a.value, b.value] = props.initial; return }
  const ids = ready.value.map((c) => c.id)
  const first = cityId.value && ids.includes(cityId.value) ? cityId.value : ids[0] ?? null
  a.value = first
  b.value = ids.find((id) => id !== first) ?? null
}
watch(open, (v) => { if (v) { defaults(); if (props.initial && canCompare.value) compare() } }, { immediate: true })

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(String(r.status))
  return (await r.json()) as T
}

function medMean(xs: number[]): { median: number | null; mean: number | null } {
  const v = [...xs].sort((x, y) => x - y)
  if (!v.length) return { median: null, mean: null }
  const mid = v.length >> 1
  return { median: v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2, mean: v.reduce((s, n) => s + n, 0) / v.length }
}

async function stats(id: string): Promise<{ name: string; s: Stats }> {
  const c = ready.value.find((x) => x.id === id)
  if (!c) throw new Error('unknown city')
  const [meta, tracts] = await Promise.all([
    getJson<Meta>(dataUrl('meta.json', c.dataPath)),
    getJson<TractCollection>(dataUrl('tracts-equity.geojson', c.dataPath)),
  ])
  const props = tracts.features.map((f) => f.properties)
  const tpa = props.map((p) => p.treesPerAcre).filter((n): n is number => typeof n === 'number')
  const km2 = props.map((p) => p.treesPerKm2 ?? (typeof p.treesPerAcre === 'number' ? p.treesPerAcre * ACRES_PER_KM2 : null))
    .filter((n): n is number => typeof n === 'number')
  const { median, mean } = medMean(tpa)
  const { median: medianKm2, mean: meanKm2 } = medMean(km2)
  const hasBq = props.some((p) => typeof p.bottomQuartile === 'boolean')
  const roads = props.map((p) => p.roadKm).filter((n): n is number => typeof n === 'number')
  return {
    name: c.cityName,
    s: {
      tracts: meta.counts?.tracts ?? props.length,
      median, mean, medianKm2, meanKm2,
      bq: hasBq ? props.filter((p) => p.bottomQuartile).length : null,
      parks: meta.counts?.parks ?? null,
      roadKm: roads.length ? roads.reduce((s, n) => s + n, 0) : null,
    },
  }
}

async function compare() {
  if (!canCompare.value) return
  loading.value = true
  failed.value = false
  result.value = null
  try {
    const [ra, rb] = await Promise.all([stats(a.value!), stats(b.value!)])
    result.value = { a: ra, b: rb }
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
}

const fmt = (n: number | null, d = 3) => (n == null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: d }))
const rows = computed(() => {
  const r = result.value
  if (!r) return []
  const A = r.a.s, B = r.b.s
  const bq = (s: Stats) => (s.bq == null ? '—' : `${s.bq} (${s.tracts ? Math.round((s.bq / s.tracts) * 100) : 0}%)`)
  const out: { label: string; a: string; b: string }[] = [
    { label: 'Tracts', a: fmt(A.tracts, 0), b: fmt(B.tracts, 0) },
  ]
  // #38: both columns always share the active unit.
  const km = ui.densityUnit === 'km2'
  const [aMed, bMed, aMean, bMean] = km ? [A.medianKm2, B.medianKm2, A.meanKm2, B.meanKm2] : [A.median, B.median, A.mean, B.mean]
  const unit = km ? 'trees/km²' : 'trees/acre'
  const d = km ? 1 : 3
  if (aMed != null || bMed != null) out.push({ label: `Median ${unit}`, a: fmt(aMed, d), b: fmt(bMed, d) })
  if (aMean != null || bMean != null) out.push({ label: `Mean ${unit}`, a: fmt(aMean, d), b: fmt(bMean, d) })
  if (A.bq != null || B.bq != null) out.push({ label: 'Bottom-quartile tracts', a: bq(A), b: bq(B) })
  if (A.parks != null || B.parks != null) out.push({ label: 'Parks', a: fmt(A.parks, 0), b: fmt(B.parks, 0) })
  if (A.roadKm != null || B.roadKm != null) out.push({ label: 'Road km', a: fmt(A.roadKm, 1), b: fmt(B.roadKm, 1) })
  return out
})

function openSide(side: 'a' | 'b') {
  const id = side === 'a' ? a.value : b.value
  if (!id) return
  open.value = false
  emit('open', id)
}

async function copyLink() {
  if (!canCompare.value) return
  const url = new URL(window.location.href)
  url.searchParams.set('compare', `${a.value},${b.value}`)
  try {
    await navigator.clipboard.writeText(url.href)
    emit('copied', 'Comparison link copied')
  } catch {
    emit('copied', 'Couldn’t copy link — copy it from the address bar.')
  }
}
</script>

<template>
  <component :is="mobile ? VBottomSheet : VDialog" v-model="open" v-bind="mobile ? {} : { maxWidth: 720 }">
    <v-card id="compare-panel" title="Compare cities" :class="{ 'compare-sheet': mobile }">
      <template #append><v-btn icon="mdi-close" variant="text" class="compare-close" aria-label="Close" @click="open = false" /></template>
      <v-card-text>
        <v-row dense>
          <v-col cols="12" :sm="mobile ? 12 : 6"><v-select v-model="a" :items="items" label="City A" density="compact" hide-details="auto" /></v-col>
          <v-col cols="12" :sm="mobile ? 12 : 6"><v-select v-model="b" :items="items" label="City B" density="compact" hide-details="auto"
            :error-messages="same ? 'Pick two different cities.' : undefined" /></v-col>
        </v-row>
        <div v-if="loading" class="text-body-2 my-4" role="status">
          <v-progress-circular indeterminate size="18" class="mr-2" />Loading city stats…
        </div>
        <v-alert v-else-if="failed" type="error" density="compact" class="my-4" text="Couldn't load one of the cities. Try again." />
        <template v-else-if="result">
          <div v-if="mobile" class="my-3">
            <v-card v-for="side in (['a', 'b'] as const)" :key="side" variant="outlined" class="mb-2" :title="result[side].name">
              <v-list density="compact" class="py-0">
                <v-list-item v-for="r in rows" :key="r.label" :title="r[side]" :subtitle="r.label" />
              </v-list>
            </v-card>
          </div>
          <v-table v-else density="compact" class="my-3">
            <thead><tr><th scope="col"><span class="sr-only">Metric</span></th><th scope="col">{{ result.a.name }}</th><th scope="col">{{ result.b.name }}</th></tr></thead>
            <tbody><tr v-for="r in rows" :key="r.label"><th scope="row" class="font-weight-regular">{{ r.label }}</th><td>{{ r.a }}</td><td>{{ r.b }}</td></tr></tbody>
          </v-table>
          <div class="text-caption text-medium-emphasis">Stats are from each city’s packaged open data (OSM-derived where noted). Not a controlled study.</div>
        </template>
      </v-card-text>
      <v-card-actions class="flex-wrap compare-actions">
        <v-btn variant="text" prepend-icon="mdi-link-variant" :disabled="!canCompare" @click="copyLink">Copy comparison link</v-btn>
        <v-spacer />
        <v-btn v-if="result" variant="tonal" :aria-label="`Open ${result.a.name} on the map`" @click="openSide('a')">Open {{ result.a.name }}</v-btn>
        <v-btn v-if="result" variant="tonal" :aria-label="`Open ${result.b.name} on the map`" @click="openSide('b')">Open {{ result.b.name }}</v-btn>
        <v-btn color="primary" variant="flat" :disabled="!canCompare || loading" @click="compare">Compare</v-btn>
      </v-card-actions>
    </v-card>
  </component>
</template>

<style scoped>
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.compare-sheet { max-height: 90vh; overflow-y: auto; overflow-x: hidden; }
.compare-actions { position: sticky; bottom: 0; background: rgb(var(--v-theme-surface)); z-index: 1; }
</style>

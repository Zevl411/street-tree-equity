<script setup lang="ts">
import { downloadBlob, exportFilename, toAllTractsCsv, toBelowMedianCsv, toPlantHereCsv } from '@/utils/exportData'
import { useFavorites } from '@/composables/useFavorites'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useDisplay } from 'vuetify'
import { VBottomSheet, VMenu } from 'vuetify/components'
import MapView from '@/components/MapView.vue'
import DualMapView from '@/components/DualMapView.vue'
import CreditStrip from '@/components/CreditStrip.vue'
import MapLegend from '@/components/MapLegend.vue'
import DensityHistogram from '@/components/DensityHistogram.vue'
import DensityAreaScatter from '@/components/DensityAreaScatter.vue'
import TractDetails from '@/components/TractDetails.vue'
import { belowMedianOrder, binCounts, binRows, cityMedian, densityPercentile, fmtDensity, sortedDensities } from '@/utils/densityBins'
import OfflineStatus from '@/components/OfflineStatus.vue'
import PlacePicker from '@/components/PlacePicker.vue'
import CompareCities from '@/components/CompareCities.vue'
import TractFinder from '@/components/TractFinder.vue'
import HotspotsPanel from '@/components/HotspotsPanel.vue'
import FavoritesPanel from '@/components/FavoritesPanel.vue'
import { useData } from '@/composables/useData'
import { useCityStore } from '@/stores/city'
import { ACRES_PER_KM2, persistBin, storedBin, useUiStore } from '@/stores/ui'
import { readSessionView, writeSessionView, type SessionView } from '@/composables/useSessionView'
import { copyText } from '@/utils/clipboard'
import { choroplethColors } from '@/utils/choropleth'
import { readDeepLink, writeDeepLink, type LayerFlags } from '@/composables/useDeepLink'
import { dualPairAvailable } from '@/utils/dualParam'
import { isReady, type NearbyPark } from '@/types'
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts'
import { resetPrefsAndReload } from '@/utils/resetPrefs'
import { hotspotGeoids, hotspotTracts } from '@/utils/hotspots'
import { availableMetrics, defaultDualPair, fmtUnitless, hotspotAscending, metricAvailable, metricMeta, METRICS, METRIC_IDS, METRIC_SWITCH_ORDER, type MetricId } from '@/utils/metrics'
import { placesCitation } from '@/utils/placesCitation'
import { useOverlayFocus, firstFocusableIn, focusSoon } from '@/composables/useOverlayFocus'

const { meta, tracts, parks, roads, bike, transit, trees, schools, libraries, gardens, fountains, postOffices, playgrounds, toilets, benches, clinics, emergency, sidewalks, loading, error, load, loadTrees, treesLoading, treesDeferred } = useData()
/** #51: hide the trees switch when the pack ships no tree points. */
const treesAvailable = computed(() => !!trees.value?.features.length)
const ISSUE_URL = 'https://github.com/Zevl411/street-tree-equity/issues/new'

const cityStore = useCityStore()
const { cities, city, selectedGeoid, manifestVersion } = storeToRefs(cityStore)
const packRows = computed<{ label: string; value: string; mono?: boolean }[]>(() => {
  const m = meta.value
  if (!m) return []
  const rows: { label: string; value: string; mono?: boolean }[] = []
  if (city.value?.id) rows.push({ label: 'Pack', value: city.value.id, mono: true })
  const v = m.version ?? manifestVersion.value
  if (v != null && v !== '') rows.push({ label: 'Format', value: `v${v}` })
  if (Number.isFinite(m.counts?.tracts)) rows.push({ label: 'Tracts', value: m.counts.tracts.toLocaleString() })
  if (Number.isFinite(m.counts?.trees)) rows.push({ label: 'Trees', value: m.counts.trees.toLocaleString() })
  const bb = Array.isArray(m.dataBbox) && m.dataBbox.length === 4 ? m.dataBbox : m.bbox
  if (Array.isArray(bb) && bb.length === 4 && bb.every((n) => Number.isFinite(n))) rows.push({ label: 'Extent', value: bb.map((n) => n.toFixed(5)).join(', '), mono: true })
  if (m.generatedAt) { const d = new Date(m.generatedAt); if (!isNaN(d.getTime())) rows.push({ label: 'Built', value: d.toLocaleDateString() }) }
  return rows
})
const ui = useUiStore()
const { theme, isDark, basemap, fillOpacity, themeAnnounce, showTrees, showParks, showRoads, showSchools, showBike, showTransit, showLibraries, showGardens, showFountains, showPostOffices, showPlaygrounds, showToilets, showBenches, showSidewalks, showClinics, showEmergency, highlightBottomQuartile, belowMedian, aboutOpen, densityUnit, choroplethMode } = storeToRefs(ui)

// #88: offline hint on pack-error (checked when the error renders).
const isOffline = computed(() => !!error.value && typeof navigator !== 'undefined' && !navigator.onLine)
const loadingName = computed(() => city.value?.cityName ?? meta.value?.cityName ?? 'this place')
const { mdAndUp } = useDisplay()
const themeLabel = computed(() => (isDark.value ? 'Switch to light mode' : 'Switch to dark mode'))
const resetLabel = computed(() => `Show all of ${meta.value?.subtitle || meta.value?.cityName || 'the map'}`)
const layersOpen = ref(false)
const finderOpen = ref(false)
const hotspotsOpen = ref(false)
// #90: shared hotspot set for map dim (same helper as HotspotsPanel).
// #98: active choropleth metric value key + meta view (breaks/colors follow metric).
const vk = computed(() => ui.metric.valueKey)
const viewMeta = computed(() => (meta.value ? metricMeta(meta.value, ui.metric.id) : null))
// #99: per-metric availability (feature-detect pack fields); fall back to trees when missing.
const metricOk = computed(() => Object.fromEntries(METRIC_IDS.map((id) => [id, metricAvailable(id, meta.value, tracts.value)])) as Record<MetricId, boolean>)
watch([metricOk, loading], ([ok, busy]) => {
  if (!busy && meta.value && !ok[ui.activeMetric]) ui.setActiveMetric('trees')
})
const hotspotGeoidList = computed(() => (loading.value ? [] : hotspotGeoids(tracts.value?.features, vk.value, hotspotAscending(ui.metric))))
const favoritesOpen = ref(false)
const shortcutsOpen = ref(false)
const resetConfirmOpen = ref(false)
function confirmReset() {
  resetConfirmOpen.value = false
  aboutOpen.value = false
  resetPrefsAndReload()
}
// #53: collapsed by default on mobile, expanded on desktop; explicit choice persisted (ste-legend-open).
const legendExpanded = computed({
  get: () => ui.legendExpandedPref ?? mdAndUp.value,
  set: (v: boolean) => ui.setLegendExpanded(v),
})
/** #54 focus mode: layout-only chrome trim (no Fullscreen API, not persisted). */
const focusMode = ref(false)
const focusLabel = computed(() => (focusMode.value ? 'Exit focus' : 'Focus map'))
function setFocus(on: boolean) {
  if (on) {
    layersOpen.value = false; finderOpen.value = false; hotspotsOpen.value = false; favoritesOpen.value = false
    compareOpen.value = false; shortcutsOpen.value = false; aboutOpen.value = false
    cityStore.select(null)
  }
  focusMode.value = on
}
function toggleFocus() { setFocus(!focusMode.value) }
const mapRef = ref<Pick<InstanceType<typeof MapView>, 'flyTo' | 'fitData' | 'fitRoad' | 'resize'> | null>(null)
// #105/#113: dual view of any two available metrics (session only). Entry hidden unless ≥2 metrics.
const availMetrics = computed(() => availableMetrics(meta.value, tracts.value))
const dualAvailable = computed(() => availMetrics.value.length >= 2)
const dualAnnounce = ref('')
const dualOptions = computed(() => availMetrics.value.map((id) => ({ title: METRICS[id].shortLabel, value: id })))
const dualLabel = (id: MetricId) => METRICS[id].shortLabel
function setDual(on: boolean, reason?: string) {
  if (on && !dualAvailable.value) return
  if (ui.dualView === on) return
  if (on) {
    const avail = availMetrics.value
    if (!avail.includes(ui.dualLeft) || !avail.includes(ui.dualRight) || ui.dualLeft === ui.dualRight) {
      const pair = defaultDualPair(avail)!
      ui.dualLeft = pair[0]; ui.dualRight = pair[1]
    }
  }
  // Keep the camera across the single ↔ dual remount (session view is per-city).
  const v = readSessionView()
  if (v && v.cityId === cityStore.cityId) initialView.value = v
  ui.setDualView(on)
  dualAnnounce.value = on ? `Dual view on: ${dualLabel(ui.dualLeft)} and ${dualLabel(ui.dualRight)}` : (reason ?? 'Dual view off')
}
function setDualSide(side: 'left' | 'right', id: MetricId) {
  ui.setDualSide(side, id)
  const name = mdAndUp.value ? (side === 'left' ? 'Left' : 'Right') : (side === 'left' ? 'Top' : 'Bottom')
  dualAnnounce.value = `${name} map: ${dualLabel(id)}`
}
// Pack switch while dual: revalidate sides; <2 metrics → off.
watch([availMetrics, loading], ([avail, busy]) => {
  if (busy || !meta.value || !ui.dualView) return
  if (!ui.validateDual(avail)) setDual(false, 'Dual view off — this pack has fewer than two metrics')
})

// #65 fullscreen: real browser Fullscreen API on #map-stage (independent of #54 focus; not persisted).
type FsDoc = Document & { webkitFullscreenEnabled?: boolean; webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void }
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void }
const fsDoc = document as FsDoc
const fsSupported = !!(fsDoc.fullscreenEnabled || fsDoc.webkitFullscreenEnabled)
const isFullscreen = ref(false)
const fsLabel = computed(() => (isFullscreen.value ? 'Exit fullscreen' : 'Fullscreen'))
const fsElement = () => fsDoc.fullscreenElement ?? fsDoc.webkitFullscreenElement ?? null
async function enterFs() {
  const el = document.getElementById('map-stage') as FsEl | null
  if (!fsSupported || !el || fsElement()) return
  try { await (el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen?.()) } catch { /* denied */ }
}
async function exitFs() {
  if (!fsElement()) return
  try { await (fsDoc.exitFullscreen ? fsDoc.exitFullscreen() : fsDoc.webkitExitFullscreen?.()) } catch { /* ignore */ }
}
function toggleFs() { if (isFullscreen.value) exitFs(); else enterFs() }
function onFsChange() {
  isFullscreen.value = fsElement()?.id === 'map-stage'
  mapRef.value?.resize()
  requestAnimationFrame(() => mapRef.value?.resize())
}
document.addEventListener('fullscreenchange', onFsChange)
document.addEventListener('webkitfullscreenchange', onFsChange)
onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onFsChange)
  document.removeEventListener('webkitfullscreenchange', onFsChange)
})

// #55 print: expand legend for the page, restore prior pref after (doesn't write ste-legend-open).
const printing = ref(false)
let prePrintPref: boolean | null | undefined
function onBeforePrint() {
  if (printing.value) return
  printing.value = true
  prePrintPref = ui.legendExpandedPref
  ui.legendExpandedPref = true
}
function onAfterPrint() {
  if (!printing.value) return
  printing.value = false
  if (prePrintPref !== undefined) ui.legendExpandedPref = prePrintPref
  prePrintPref = undefined
  mapRef.value?.resize()
}
async function printMap() {
  onBeforePrint()
  await nextTick()
  mapRef.value?.resize()
  requestAnimationFrame(() => {
    window.print()
  })
}
const printMq = window.matchMedia('print')
const onPrintMq = (e: MediaQueryListEvent) => { if (!e.matches) onAfterPrint() }
window.addEventListener('beforeprint', onBeforePrint)
window.addEventListener('afterprint', onAfterPrint)
printMq.addEventListener('change', onPrintMq)
onBeforeUnmount(() => {
  window.removeEventListener('beforeprint', onBeforePrint)
  window.removeEventListener('afterprint', onAfterPrint)
  printMq.removeEventListener('change', onPrintMq)
})

const selectedTract = computed(() =>
  tracts.value?.features.find((f) => f.properties.geoid === selectedGeoid.value)?.properties ?? null,
)
const drawerOpen = computed({
  get: () => selectedTract.value !== null,
  set: (v: boolean) => { if (!v) cityStore.select(null) },
})

function flyToPark(p: NearbyPark) {
  const park = parks.value?.features.find((f) => f.properties.id === p.id)
  if (park) mapRef.value?.flyTo(park.properties.lon, park.properties.lat, 15)
}

// #100: FEMA NRI terms — citation + no-endorsement disclaimer (no FEMA/DHS seals).
const NRI_DISCLAIMER = 'This product uses FEMA’s National Risk Index downloadable datasets but is not endorsed by FEMA. The Federal Government or FEMA cannot vouch for data or analyses derived after download.'
// #117–#138: CDC PLACES citations — shared template; year from meta.cdcPlaces.years.<MEASURE> (omit clause if missing).
const placesYear = (measure: string) => meta.value?.cdcPlaces?.years?.[measure]
const hasPlacesAsthma = computed(() => !!meta.value?.cdcPlaces?.measures?.includes('CASTHMA'))
const PLACES_CITATION = computed(() => placesCitation('Current asthma among adults', 'current asthma', placesYear('CASTHMA')))
const hasPlacesDiabetes = computed(() => !!meta.value?.cdcPlaces?.measures?.includes('DIABETES'))
const PLACES_DIABETES_CITATION = computed(() => placesCitation('Diagnosed diabetes among adults', 'diagnosed diabetes', placesYear('DIABETES')))
const hasPlacesObesity = computed(() => !!meta.value?.cdcPlaces?.measures?.includes('OBESITY'))
const PLACES_OBESITY_CITATION = computed(() => placesCitation('Obesity among adults', 'obesity', placesYear('OBESITY')))
const hasPlacesMentalHealth = computed(() => !!meta.value?.cdcPlaces?.measures?.includes('MHLTH'))
const PLACES_MHLTH_CITATION = computed(() => placesCitation('Frequent mental distress among adults', 'frequent mental distress', placesYear('MHLTH')))
const hasPlacesPhysicalHealth = computed(() => !!meta.value?.cdcPlaces?.measures?.includes('PHLTH'))
const PLACES_PHLTH_CITATION = computed(() => placesCitation('Frequent physical distress among adults', 'frequent physical distress', placesYear('PHLTH')))
const hasPlacesChd = computed(() => !!meta.value?.cdcPlaces?.measures?.includes('CHD'))
const PLACES_CHD_CITATION = computed(() => placesCitation('Coronary heart disease among adults', 'coronary heart disease or angina', placesYear('CHD')))
const hasPlacesBpHigh = computed(() => !!meta.value?.cdcPlaces?.measures?.includes('BPHIGH'))
const PLACES_BPHIGH_CITATION = computed(() => placesCitation('High blood pressure among adults', 'high blood pressure', placesYear('BPHIGH')))
const hasPlacesInactivity = computed(() => !!meta.value?.cdcPlaces?.measures?.includes('LPA'))
const PLACES_LPA_CITATION = computed(() => placesCitation('No leisure-time physical activity among adults', 'activity', placesYear('LPA')))
const hasPlacesCopd = computed(() => !!meta.value?.cdcPlaces?.measures?.includes('COPD'))
const PLACES_COPD_CITATION = computed(() => placesCitation('Chronic obstructive pulmonary disease (COPD) among adults', 'COPD', placesYear('COPD')))
const hasPlacesSmoking = computed(() => !!meta.value?.cdcPlaces?.measures?.includes('CSMOKING'))
const PLACES_CSMOKING_CITATION = computed(() => placesCitation('Current cigarette smoking among adults', 'current cigarette smoking', placesYear('CSMOKING')))
const FARA_CITATION = 'Food Access Research Atlas (tract) — USDA ERS SNAP-authorized Retailer Access Map (SRAM) 2025. This product uses USDA Economic Research Service Food Access Research Atlas data but is not endorsed by USDA or ERS.'
const updated = computed(() => (meta.value?.osmTimestamp ? new Date(meta.value.osmTimestamp).toLocaleDateString() : ''))
// #56 Copy citations (plain text, reuses #47 copyText fallback).
const citationsText = computed(() => [
  'Street Tree Equity — data sources',
  `- Street trees, parks, groceries, schools, bike lanes & transit stops, libraries & community centres, community gardens & allotments, drinking fountains, post offices, playgrounds, public toilets, benches, mapped sidewalks & footpaths, pharmacies & clinics, hospitals & fire stations: © OpenStreetMap contributors (ODbL) https://www.openstreetmap.org/copyright${updated.value ? `; OSM data as of ${updated.value}` : ''}`,
  `- Tract boundaries: U.S. Census Bureau cartographic boundary files (public domain)${meta.value?.censusVintage ? `; vintage ${meta.value.censusVintage}` : ''}`,
  ...(meta.value?.acs ? [`- Median household income (tract) — U.S. Census Bureau American Community Survey (ACS) 5-year table ${meta.value.acs.table} (${meta.value.acs.vintage}). Retrieved ${meta.value.acs.retrievedAt} from ${meta.value.acs.sourceUrl}. Public domain.`] : []),
  ...(meta.value?.acsPoverty ? [`- Poverty rate (tract) — U.S. Census Bureau American Community Survey (ACS) 5-year table ${meta.value.acsPoverty.table}, Poverty Status in the Past 12 Months (${meta.value.acsPoverty.vintage}). Retrieved ${meta.value.acsPoverty.retrievedAt} from ${meta.value.acsPoverty.sourceUrl}. Public domain.`] : []),
  ...(meta.value?.acsNoVehicle ? [`- Households without a vehicle (tract) — U.S. Census Bureau American Community Survey (ACS) 5-year table ${meta.value.acsNoVehicle.table}, Household Size by Vehicles Available (${meta.value.acsNoVehicle.vintage}). Retrieved ${meta.value.acsNoVehicle.retrievedAt} from ${meta.value.acsNoVehicle.sourceUrl}. Public domain.`] : []),
  ...(meta.value?.acsRentBurden ? [`- Rent-burdened renter households (tract) — U.S. Census Bureau American Community Survey (ACS) 5-year table ${meta.value.acsRentBurden.table}, Gross Rent as a Percentage of Household Income in the Past 12 Months (${meta.value.acsRentBurden.vintage}). Retrieved ${meta.value.acsRentBurden.retrievedAt} from ${meta.value.acsRentBurden.sourceUrl}. Public domain.`] : []),
  ...(meta.value?.acsAge ? [`- Residents age 65 and over (tract) — U.S. Census Bureau American Community Survey (ACS) 5-year table ${meta.value.acsAge.table}, Sex by Age (${meta.value.acsAge.vintage}). Retrieved ${meta.value.acsAge.retrievedAt} from ${meta.value.acsAge.sourceUrl}. Public domain.`] : []),
  ...(meta.value?.acsUnder18 ? [`- Residents under 18 (tract) — U.S. Census Bureau American Community Survey (ACS) 5-year table ${meta.value.acsUnder18.table}, Sex by Age (${meta.value.acsUnder18.vintage}). Retrieved ${meta.value.acsUnder18.retrievedAt} from ${meta.value.acsUnder18.sourceUrl}. Public domain.`] : []),
  ...(meta.value?.cdcPlaces && hasPlacesAsthma.value ? [`- ${PLACES_CITATION.value} Retrieved ${meta.value.cdcPlaces.retrievedAt} from ${meta.value.cdcPlaces.sourceUrl}`] : []),
  ...(meta.value?.cdcPlaces && hasPlacesDiabetes.value ? [`- ${PLACES_DIABETES_CITATION.value} Retrieved ${meta.value.cdcPlaces.retrievedAt} from ${meta.value.cdcPlaces.sourceUrl}`] : []),
  ...(meta.value?.cdcPlaces && hasPlacesObesity.value ? [`- ${PLACES_OBESITY_CITATION.value} Retrieved ${meta.value.cdcPlaces.retrievedAt} from ${meta.value.cdcPlaces.sourceUrl}`] : []),
  ...(meta.value?.cdcPlaces && hasPlacesMentalHealth.value ? [`- ${PLACES_MHLTH_CITATION.value} Retrieved ${meta.value.cdcPlaces.retrievedAt} from ${meta.value.cdcPlaces.sourceUrl}`] : []),
  ...(meta.value?.cdcPlaces && hasPlacesPhysicalHealth.value ? [`- ${PLACES_PHLTH_CITATION.value} Retrieved ${meta.value.cdcPlaces.retrievedAt} from ${meta.value.cdcPlaces.sourceUrl}`] : []),
  ...(meta.value?.cdcPlaces && hasPlacesChd.value ? [`- ${PLACES_CHD_CITATION.value} Retrieved ${meta.value.cdcPlaces.retrievedAt} from ${meta.value.cdcPlaces.sourceUrl}`] : []),
  ...(meta.value?.cdcPlaces && hasPlacesBpHigh.value ? [`- ${PLACES_BPHIGH_CITATION.value} Retrieved ${meta.value.cdcPlaces.retrievedAt} from ${meta.value.cdcPlaces.sourceUrl}`] : []),
  ...(meta.value?.cdcPlaces && hasPlacesInactivity.value ? [`- ${PLACES_LPA_CITATION.value} Retrieved ${meta.value.cdcPlaces.retrievedAt} from ${meta.value.cdcPlaces.sourceUrl}`] : []),
  ...(meta.value?.cdcPlaces && hasPlacesCopd.value ? [`- ${PLACES_COPD_CITATION.value} Retrieved ${meta.value.cdcPlaces.retrievedAt} from ${meta.value.cdcPlaces.sourceUrl}`] : []),
  ...(meta.value?.cdcPlaces && hasPlacesSmoking.value ? [`- ${PLACES_CSMOKING_CITATION.value} Retrieved ${meta.value.cdcPlaces.retrievedAt} from ${meta.value.cdcPlaces.sourceUrl}`] : []),
  ...(meta.value?.acsLep ? [`- Limited English proficiency (tract) — U.S. Census Bureau American Community Survey (ACS) 5-year table ${meta.value.acsLep.table}, Age by Language Spoken at Home by Ability to Speak English for the Population 5 Years and Over (${meta.value.acsLep.vintage}). Retrieved ${meta.value.acsLep.retrievedAt} from ${meta.value.acsLep.sourceUrl}. Public domain. “Limited English” = speaks English less than “very well.”`] : []),
  ...(meta.value?.acsSnap ? [`- SNAP households (tract) — U.S. Census Bureau American Community Survey (ACS) 5-year table ${meta.value.acsSnap.table}, Receipt of Food Stamps/SNAP in the Past 12 Months by Presence of People 60 Years and Over for Households (${meta.value.acsSnap.vintage}). Retrieved ${meta.value.acsSnap.retrievedAt} from ${meta.value.acsSnap.sourceUrl}. Public domain. Share of households that received Food Stamps/SNAP in the past 12 months.`] : []),
  ...(meta.value?.plantNeed ? [`- Planting need (tract) — a 0–100 score computed by this app from data already shown: tree density (fewer trees per acre = more need), share of residents in poverty (ACS B17001), and, where available, adult asthma (CDC PLACES). Each is rescaled 0–100 within this city (lowest tract = 0, highest = 100), tree density is flipped so the sparsest tract scores 100, and the parts are averaged with equal weight. Higher = more need. Compares tracts within one city only; not an official index. Inherits the sources and licenses of its inputs.`] : []),
  ...(meta.value?.fara ? [`- ${FARA_CITATION} Retrieved ${meta.value.fara.retrievedAt} from ${meta.value.fara.sourceUrl}`] : []),
  ...(meta.value?.nri ? [`- National Risk Index (tract): FEMA NRI ${meta.value.nri.version}. ${NRI_DISCLAIMER} Retrieved ${meta.value.nri.retrievedAt} from ${meta.value.nri.sourceUrl}`] : []),
  '- Streets basemap: OpenFreeMap / OpenMapTiles / © OpenStreetMap contributors — https://openfreemap.org',
  '- Satellite: EOxCloudless 2025 by EOX IT Services GmbH — modified Copernicus Sentinel data 2025 — CC BY-NC-SA (non-commercial) — https://cloudless.eox.at',
  '- Code: https://github.com/Zevl411/street-tree-equity (MIT)',
].join('\n'))
const citationsSnack = ref(false)
const citationsFallbackOpen = ref(false)
function selectCitations() {
  const el = document.querySelector<HTMLTextAreaElement>('#citations-fallback textarea')
  el?.focus(); el?.select()
}
async function copyCitations() {
  if (await copyText(citationsText.value)) citationsSnack.value = true
  else citationsFallbackOpen.value = true
}

/** #44: stored camera for the first city shown (cleared after boot so city switches fit). */
const initialView = ref<SessionView | null>(null)

async function selectCity(id: string, restore: SessionView | null = null) {
  const res = cityStore.setCity(id)
  if (!res) return
  initialView.value = restore && restore.cityId === res.entry.id ? restore : null
  if (res.changed || !meta.value) {
    // #94: small viewports defer trees.geojson until Load / deep-link / resize to mdAndUp.
    const ok = await load(res.entry.dataPath, { deferTrees: !mdAndUp.value })
    if (ok && treesDeferred.value && wantTreesFromLink) { wantTreesFromLink = false; void loadTreePoints() }
    if (!ok || cityStore.city?.id !== res.entry.id) return
    await nextTick()
  }
  if (!initialView.value) mapRef.value?.fitData()
}

function retry() {
  if (city.value) load(city.value.dataPath, { deferTrees: !mdAndUp.value })
}

// #61: move focus to Try again once when the error alert appears.
watch(error, (e, prev) => {
  if (e && !prev) focusSoon('#pack-error .pack-retry')
})

async function init() {
  const link = readDeepLink()
  if (link.theme && link.theme !== ui.theme) ui.setTheme(link.theme)
  if (link.basemap) ui.setBasemap(link.basemap)
  if (link.layers) applyLayers(link.layers)
  // #94: a trees-on deep link auto-loads points once on mobile.
  wantTreesFromLink = !!link.layers?.trees
  ui.setActiveMetric(link.metric)
  if (link.unit) ui.setDensityUnit(link.unit)
  if (link.hc) ui.setChoroplethMode('contrast')
  if (link.legend !== null) ui.setLegendExpanded(link.legend)
  await cityStore.loadManifest()
  // #44 precedence per field: URL param > localStorage (ready packs only) > default.
  const stored = readSessionView()
  const bootCity = cityStore.initialCityId()
  const inPack = (g: string | null | undefined) => !!g && !!tracts.value?.features.some((f) => f.properties.geoid === g)
  // A URL geoid owns the camera; otherwise restore the stored camera only for the same city.
  await selectCity(bootCity, !link.geoid && stored?.cityId === bootCity ? stored : null)
  if (link.geoid && inPack(link.geoid)) cityStore.select(link.geoid)
  else if (!link.geoid && stored?.cityId === cityStore.cityId && inPack(stored.geoid)) cityStore.select(stored.geoid!)
  watch(selectedGeoid, (g) => { if (cityStore.cityId) writeSessionView({ cityId: cityStore.cityId, geoid: g }) }, { immediate: true })
  applyDualFromUrl(link)
  syncUrl()
  openCompareFromUrl()
  openHotspotsFromUrl()
  applyBelowMedianFromUrl()
  openFavoritesFromUrl()
  openFocusFromUrl()
  // #79 precedence: valid `?bin=` (explicit override, persisted) > ste-bin[city] > null. Clamped once meta is ready.
  const binCount = () => (meta.value ? choroplethColors(meta.value, ui.choroplethMode, ui.choroplethPalette).length : undefined)
  ui.setDensityBin(link.bin !== null ? link.bin : storedBin(cityStore.cityId), binCount())
  persistBin(cityStore.cityId, ui.densityBinIndex)
  // #79: on city change restore that city's stored bin (or null); no cross-pack bleed.
  watch(() => cityStore.cityId, (c) => ui.setDensityBin(storedBin(c), binCount()))
  // #79: mirror bin into ste-bin for the active city (clear / clamp→null deletes the key).
  watch(() => ui.densityBinIndex, (i) => persistBin(cityStore.cityId, i))
  // #73: re-clamp bin if the color ramp length changes (mode flip / new meta)
  watch(() => (meta.value ? choroplethColors(meta.value, ui.choroplethMode).length : 0), (n) => {
    if (ui.densityBinIndex !== null) ui.setDensityBin(ui.densityBinIndex, n)
  })
  // Keep the address bar shareable as the view changes.
  watch([() => cityStore.cityId, selectedGeoid, basemap, theme, showTrees, showParks, showRoads, showSchools, showBike, showTransit, showLibraries, showGardens, showFountains, showPostOffices, showPlaygrounds, showToilets, showBenches, showSidewalks, showClinics, showEmergency, highlightBottomQuartile, belowMedian, densityUnit, choroplethMode, () => ui.legendExpandedPref, () => ui.densityBinIndex, () => ui.dualView, () => ui.dualLeft, () => ui.dualRight], syncUrl)
}

/** #118: restore a valid `?dual=` pair once the first pack is loaded; invalid → ignored (single map). */
function applyDualFromUrl(link: ReturnType<typeof readDeepLink>) {
  if (!new URLSearchParams(window.location.search).has('dual')) return
  const avail = availMetrics.value
  if (!dualPairAvailable(link.dual, avail)) { console.debug('[dual] ignoring ?dual= (invalid or unavailable for this pack)'); return }
  ui.dualLeft = link.dual.left; ui.dualRight = link.dual.right
  const v = readSessionView()
  if (v && v.cityId === cityStore.cityId) initialView.value = v
  ui.setDualView(true)
  // Soft: metric= equal to the right side starts Hotspots primary = right.
  if (link.metric === link.dual.right) ui.dualPrimary = 'right'
  dualAnnounce.value = `Dual view on: ${dualLabel(link.dual.left)} and ${dualLabel(link.dual.right)}`
}

/** #94: one-shot auto-load for `?layers=` with trees (first pack only). */
let wantTreesFromLink = false
/** #94: fetch deferred tree points; turns overlay on; retryable snack on failure. */
async function loadTreePoints(silentFail = false) {
  const ok = await loadTrees()
  if (ok) showTrees.value = true
  else if (!silentFail && treesDeferred.value) linkSnack.value = 'Couldn’t load tree points'
}
// #94: crossing to desktop fetches once if still deferred (keeps the user's showTrees). Desktop→phone keeps trees.
watch(mdAndUp, (md) => { if (md && treesDeferred.value && !treesLoading.value) void loadTrees() })
// #94: re-encode layers when deferral flips.
watch(treesDeferred, () => syncUrl())

function currentLayers(): LayerFlags {
  // #94: don't advertise points that aren't loaded.
  return { trees: showTrees.value && !treesDeferred.value, parks: showParks.value, roads: showRoads.value, bq: highlightBottomQuartile.value, bm: belowMedian.value, schools: showSchools.value && !!schools.value, bike: showBike.value && !!bike.value, transit: showTransit.value && !!transit.value, libraries: showLibraries.value && !!libraries.value, gardens: showGardens.value && !!gardens.value, fountains: showFountains.value && !!fountains.value, postoffices: showPostOffices.value && !!postOffices.value, playgrounds: showPlaygrounds.value && !!playgrounds.value, toilets: showToilets.value && !!toilets.value, benches: showBenches.value && !!benches.value, clinics: showClinics.value && !!clinics.value, emergency: showEmergency.value && !!emergency.value, sidewalks: showSidewalks.value && !!sidewalks.value }
}
/** Presets omit `bm` (#59) so they leave the median dim as-is. */
function applyLayers(f: Omit<LayerFlags, 'bm' | 'schools' | 'bike' | 'transit' | 'libraries' | 'sidewalks' | 'gardens' | 'fountains' | 'postoffices' | 'playgrounds' | 'toilets' | 'benches' | 'clinics' | 'emergency'> & { bm?: boolean; schools?: boolean; bike?: boolean; transit?: boolean; libraries?: boolean; sidewalks?: boolean; gardens?: boolean; fountains?: boolean; postoffices?: boolean; playgrounds?: boolean; toilets?: boolean; benches?: boolean; clinics?: boolean; emergency?: boolean }) {
  showTrees.value = f.trees
  showParks.value = f.parks
  showRoads.value = f.roads
  // #104: presets leave mobility overlays alone; links set them explicitly.
  if (f.bike !== undefined) showBike.value = f.bike
  if (f.transit !== undefined) showTransit.value = f.transit
  if (f.sidewalks !== undefined) showSidewalks.value = f.sidewalks
  highlightBottomQuartile.value = f.bq
  if (f.bm !== undefined) belowMedian.value = f.bm
  if (f.schools !== undefined) showSchools.value = f.schools
  if (f.libraries !== undefined) showLibraries.value = f.libraries
  if (f.gardens !== undefined) showGardens.value = f.gardens
  if (f.fountains !== undefined) showFountains.value = f.fountains
  if (f.postoffices !== undefined) showPostOffices.value = f.postoffices
  if (f.playgrounds !== undefined) showPlaygrounds.value = f.playgrounds
  if (f.toilets !== undefined) showToilets.value = f.toilets
  if (f.benches !== undefined) showBenches.value = f.benches
  if (f.clinics !== undefined) showClinics.value = f.clinics
  if (f.emergency !== undefined) showEmergency.value = f.emergency
}

/** One-tap layer presets (#37). They only set the four switches; switches stay the source of truth. */
const LAYER_PRESETS: { id: string; label: string; flags: Omit<LayerFlags, 'bm' | 'schools' | 'bike' | 'transit' | 'libraries' | 'sidewalks' | 'gardens' | 'fountains' | 'postoffices' | 'playgrounds' | 'toilets' | 'benches' | 'clinics' | 'emergency'> }[] = [
  { id: 'equity', label: 'Equity', flags: { trees: true, parks: true, roads: false, bq: true } },
  { id: 'plant', label: 'Plant-here', flags: { trees: true, parks: false, roads: true, bq: false } },
  { id: 'parks', label: 'Parks', flags: { trees: true, parks: true, roads: false, bq: false } },
]
const activePreset = computed(() => {
  const c = currentLayers()
  return LAYER_PRESETS.find((p) => (Object.keys(p.flags) as (keyof typeof p.flags)[]).every((k) => p.flags[k] === c[k]))?.id ?? null
})

function syncUrl() {
  writeDeepLink({ city: cityStore.cityId, geoid: selectedGeoid.value, basemap: basemap.value, theme: theme.value, layers: currentLayers(), unit: densityUnit.value, metric: ui.activeMetric, dual: ui.dualView ? { left: ui.dualLeft, right: ui.dualRight } : null, choroplethMode: choroplethMode.value, legend: ui.legendExpandedPref, bin: ui.densityBinIndex })
}

const compareOpen = ref(false)

// #40 city overview strip — meta + already-loaded tracts only.
const overviewDensity = computed(() => {
  const m = meta.value
  if (!m) return ''
  const ov = m.overall[ui.metric.overallKey]
  const o = ov != null ? ov : m.overall.treesPerAcre
  if (!ui.metric.usesDensityUnit) return fmtUnitless(ui.metric, o)
  if (ui.metric.fine) {
    return densityUnit.value === 'km2'
      ? `${(o * ACRES_PER_KM2).toLocaleString(undefined, { maximumFractionDigits: 2 })} / km²`
      : `${o.toFixed(4)} / acre`
  }
  return densityUnit.value === 'km2'
    ? `${(m.overall.treesPerAcre * ACRES_PER_KM2).toLocaleString(undefined, { maximumFractionDigits: 1 })} / km²`
    : `${m.overall.treesPerAcre.toFixed(2)} / acre`
})
// #72 inequality snapshot — p10/median/p90 of loaded tracts (acre math, display scaled).
const spread = computed(() => {
  if (loading.value) return null
  const sorted = sortedDensities(tracts.value, vk.value)
  const med = cityMedian(tracts.value, vk.value)
  const p10 = densityPercentile(sorted, 0.1)
  const p90 = densityPercentile(sorted, 0.9)
  if (med == null || p10 == null || p90 == null) return null
  const km2 = ui.effectiveUnit === 'km2'
  const k = km2 ? ACRES_PER_KM2 : 1
  const f = (n: number) => (ui.metric.usesDensityUnit ? fmtDensity(n * k, km2) : fmtUnitless(ui.metric, n))
  const unit = !ui.metric.usesDensityUnit ? '' : km2 ? '/km²' : '/acre'
  const r = p10 > 0 ? p90 / p10 : NaN
  const ratio = Number.isFinite(r) ? `×${r.toFixed(1)}` : ''
  return {
    p10: f(p10), med: f(med), p90: f(p90), unit, ratio,
    // #83 numeric acre values for the CSS sparkline (null when nothing to scale)
    spark: p90 > 0 ? {
      left: Math.min(100, Math.max(0, (p10 / p90) * 100)),
      width: Math.min(100, Math.max(0, ((p90 - p10) / p90) * 100)),
      med: Math.min(100, Math.max(0, (med / p90) * 100)),
    } : null,
    aria: `Density spread: 10th percentile ${f(p10)}, median ${f(med)}, 90th percentile ${f(p90)} ${ui.metric.spreadUnit(ui.effectiveUnit).replace('/km²', ' per square kilometer').replace('/acre', ' per acre')}${ratio ? `; 90th to 10th percentile ratio about ${r.toFixed(1)}` : ''}`,
  }
})
const plantHere = computed<{ pct: number } | { segments: number } | null>(() => {
  let road = 0
  let low = 0
  for (const f of tracts.value?.features ?? []) {
    const { roadKm, lowTreeRoadKm } = f.properties
    if (roadKm != null && lowTreeRoadKm != null) { road += roadKm; low += lowTreeRoadKm }
  }
  if (road > 0) return { pct: Math.round((100 * low) / road) }
  const seg = meta.value?.counts.lowTreeRoadSegments ?? 0
  return seg > 0 ? { segments: seg } : null
})
const plantHereStat = computed(() => {
  const p = plantHere.value
  if (!p) return ''
  return 'pct' in p ? `${p.pct}% plant-here streets` : `${p.segments.toLocaleString()} plant-here segments`
})
const plantHereChip = computed(() => {
  const p = plantHere.value
  if (!p) return ''
  return 'pct' in p ? `${p.pct}% plant-here` : `${p.segments.toLocaleString()} segments`
})
const compareInitial = ref<[string, string] | null>(null)
function startCompare() {
  compareInitial.value = null
  compareOpen.value = true
}
/** ?compare=idA,idB with two different ready ids opens the dialog pre-filled; anything else is ignored. */
function openCompareFromUrl() {
  const raw = new URLSearchParams(window.location.search).get('compare')
  const ids = raw?.split(',').map((s) => s.trim()) ?? []
  const ok = (id: string) => cities.value.some((c) => c.id === id && isReady(c))
  if (ids.length === 2 && ids[0] !== ids[1] && ids.every(ok)) {
    compareInitial.value = [ids[0], ids[1]]
    compareOpen.value = true
  }
}

/** #59: need ≥2 finite densities in the loaded pack for a median. */
const medianAcre = computed(() => cityMedian(tracts.value))
/** #98: BM availability follows the active metric. */
const medianAvailable = computed(() => cityMedian(tracts.value, vk.value) != null)
/** #59 ?belowMedian=1: one-shot alias → turn the dim on, strip the param; `layers=…,bm` then owns it. */
function applyBelowMedianFromUrl() {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('belowMedian')) return
  if (url.searchParams.get('belowMedian') === '1' && medianAvailable.value) { quietFilters(); belowMedian.value = true }
  url.searchParams.delete('belowMedian')
  history.replaceState(history.state, '', url)
  syncUrl()
}

/** #43 ?hotspots=1 opens the panel once tracts are ready, then the flag is stripped from the URL. */
const pendingHotspotsFromUrl = ref(false)
function stripHotspotsParam() {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('hotspots')) return
  url.searchParams.delete('hotspots')
  history.replaceState(history.state, '', url)
}
function tryOpenHotspotsFromUrl() {
  if (!pendingHotspotsFromUrl.value) return
  if (!tracts.value?.features.length) return
  // Deep-link geoid wins; still strip the one-shot flag.
  if (selectedGeoid.value) {
    pendingHotspotsFromUrl.value = false
    stripHotspotsParam()
    return
  }
  pendingHotspotsFromUrl.value = false
  hotspotsOpen.value = true
  stripHotspotsParam()
}
function openHotspotsFromUrl() {
  if (new URLSearchParams(window.location.search).get('hotspots') !== '1') return
  pendingHotspotsFromUrl.value = true
  tryOpenHotspotsFromUrl()
  if (pendingHotspotsFromUrl.value) {
    const stop = watch([() => tracts.value?.features.length ?? 0, selectedGeoid, loading], () => {
      tryOpenHotspotsFromUrl()
      if (!pendingHotspotsFromUrl.value) stop()
    })
  }
}
/** #45 ?fav=1: same one-shot pending-flag pattern as #43 hotspots. */
const pendingFavFromUrl = ref(false)
function stripFavParam() {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('fav')) return
  url.searchParams.delete('fav')
  history.replaceState(history.state, '', url)
}
function tryOpenFavoritesFromUrl() {
  if (!pendingFavFromUrl.value) return
  if (!tracts.value?.features.length) return
  pendingFavFromUrl.value = false
  if (!selectedGeoid.value) favoritesOpen.value = true
  stripFavParam()
}
function openFavoritesFromUrl() {
  if (new URLSearchParams(window.location.search).get('fav') !== '1') return
  pendingFavFromUrl.value = true
  tryOpenFavoritesFromUrl()
  if (pendingFavFromUrl.value) {
    const stop = watch([() => tracts.value?.features.length ?? 0, selectedGeoid, loading], () => {
      tryOpenFavoritesFromUrl()
      if (!pendingFavFromUrl.value) stop()
    })
  }
}
/** #54 ?focus=1: one-shot, entered once data is ready, then stripped (never written by Share). */
const pendingFocusFromUrl = ref(false)
function stripFocusParam() {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('focus')) return
  url.searchParams.delete('focus')
  history.replaceState(history.state, '', url)
}
function tryFocusFromUrl() {
  if (!pendingFocusFromUrl.value || !meta.value || loading.value) return
  pendingFocusFromUrl.value = false
  setFocus(true)
  stripFocusParam()
}
function openFocusFromUrl() {
  if (new URLSearchParams(window.location.search).get('focus') !== '1') { stripFocusParam(); return }
  pendingFocusFromUrl.value = true
  tryFocusFromUrl()
  if (pendingFocusFromUrl.value) {
    const stop = watch([meta, loading], () => {
      tryFocusFromUrl()
      if (!pendingFocusFromUrl.value) stop()
    })
  }
}
function pickFromHotspots(geoid: string) {
  cityStore.select(geoid)
}

const linkSnack = ref('')

// #67: pack-bounded Locate me — Geolocation API only, single shot, never switches city.
const geoSupported = typeof navigator !== 'undefined' && !!navigator.geolocation
const locating = ref(false)
const locateLabel = computed(() => (locating.value ? 'Locating…' : 'Locate me'))
function nearestGeoid(lon: number, lat: number): string | null {
  let best: string | null = null
  let bestD = Infinity
  for (const f of tracts.value?.features ?? []) {
    const g = f.geometry as { type: string; coordinates: unknown }
    if (!g) continue
    let sx = 0, sy = 0, n = 0
    const walk = (c: unknown): void => {
      if (Array.isArray(c) && typeof c[0] === 'number') { sx += c[0] as number; sy += c[1] as number; n++ }
      else if (Array.isArray(c)) c.forEach(walk)
    }
    walk(g.coordinates)
    if (!n) continue
    const dx = (sx / n - lon) * Math.cos((lat * Math.PI) / 180)
    const dy = sy / n - lat
    const d = dx * dx + dy * dy
    if (d < bestD) { bestD = d; best = (f.properties as { geoid?: string })?.geoid ?? null }
  }
  return best
}
function locateMe() {
  if (!geoSupported || locating.value) return
  locating.value = true
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      locating.value = false
      const { longitude: lon, latitude: lat } = pos.coords
      const b = meta.value?.dataBbox
      if (!b || lon < b[0] || lat < b[1] || lon > b[2] || lat > b[3]) {
        linkSnack.value = 'You’re outside this city’s map area'
        return
      }
      mapRef.value?.flyTo(lon, lat, 15)
      const g = nearestGeoid(lon, lat)
      if (g) cityStore.select(g)
    },
    (err) => {
      locating.value = false
      linkSnack.value = err.code === 1
        ? 'Location permission blocked — allow it in your browser’s site settings'
        : 'Couldn’t get your location'
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
  )
}
/** #64: client-side below-median CSV (same median as #59; independent of the dim toggle). */
function exportBelowMedian(flagged: boolean) {
  const id = cityStore.cityId
  const feats = tracts.value?.features ?? []
  if (!id || !feats.length) return
  const csv = toBelowMedianCsv(feats.map((f) => f.properties), id, densityUnit.value === 'km2' ? 'km2' : 'acre', flagged)
  if (csv === null) return
  downloadBlob(csv, exportFilename(id, flagged ? 'below-median-flagged' : 'below-median', 'csv'), 'text/csv;charset=utf-8')
  linkSnack.value = flagged ? 'Below-median flagged CSV downloaded' : 'Below-median CSV downloaded'
}
/** #78: all pack tracts slim analysis CSV (favorites = active city only). */
function exportAllTracts() {
  const id = cityStore.cityId
  const feats = tracts.value?.features ?? []
  if (!id || !feats.length) return
  const csv = toAllTractsCsv(feats.map((f) => f.properties), id, densityUnit.value === 'km2' ? 'km2' : 'acre', allFavs.list(id))
  downloadBlob(csv, exportFilename(id, 'all-tracts', 'csv'), 'text/csv;charset=utf-8')
  linkSnack.value = 'All tracts CSV downloaded'
}
/** #92: all plant-here street segments in the loaded pack (independent of Roads toggle). */
function exportPlantHere() {
  const id = cityStore.cityId
  const fc = roads.value
  if (!id || !fc?.features.length) return
  try {
    downloadBlob(toPlantHereCsv(fc as never, id), exportFilename(id, 'plant-here', 'csv'), 'text/csv;charset=utf-8')
    linkSnack.value = 'Plant-here CSV downloaded'
  } catch {
    linkSnack.value = "Couldn't prepare the file. Try again."
  }
}
const allFavs = useFavorites()
async function copyLink() {
  syncUrl()
  const href = window.location.href
  if (await copyText(href)) { linkSnack.value = 'Map link copied'; return }
  shareFallbackUrl.value = href
  shareFallbackOpen.value = true
}
/** #50 fallback when both Clipboard API and execCommand fail. */
const shareFallbackOpen = ref(false)
const shareFallbackUrl = ref('')
function selectShareUrl() {
  const el = document.querySelector<HTMLTextAreaElement>('#share-fallback textarea')
  el?.focus(); el?.select()
}

onMounted(init)

const satFallback = ref(false)

// #39 a11y: skip link, overlay focus in/out.
function skipToMap() {
  document.getElementById('map-stage')?.focus()
}
const findControl = () => (mdAndUp.value ? '#find-tract-btn' : '#more-actions-btn')
useOverlayFocus(layersOpen, firstFocusableIn('#layers-panel'))
useOverlayFocus(finderOpen, '#tract-finder-panel input', findControl, () => !drawerOpen.value)
useOverlayFocus(hotspotsOpen, '#hotspots-panel .hotspots-close', () => '#map-stage', () => !drawerOpen.value)
useOverlayFocus(favoritesOpen, '#favorites-panel .favorites-close', () => '#map-stage', () => !drawerOpen.value)
useOverlayFocus(compareOpen, '#compare-panel .compare-close', () => '#city-picker-btn')
useOverlayFocus(shortcutsOpen, '#shortcuts-panel .shortcuts-close', () => '#map-stage')
useOverlayFocus(resetConfirmOpen, '#reset-confirm .reset-cancel', () => '#about-reset-btn')

// #46 keyboard shortcuts. Esc: open overlays (Vuetify dialog/menu/sheet + #39 focus restore) own their Esc;
// only when none is open do we close the tract drawer / clear selection.
const anyOverlayOpen = () => layersOpen.value || finderOpen.value || hotspotsOpen.value || favoritesOpen.value || compareOpen.value
  || aboutOpen.value || shortcutsOpen.value || document.querySelector('.v-overlay--active:not(.v-tooltip)') !== null
const hotspotsAvailable = () => !!(meta.value && tracts.value?.features.length)
useKeyboardShortcuts({
  find: () => { if (anyOverlayOpen()) return; finderOpen.value = true },
  // #54: overlays → tract drawer → exit focus → no-op.
  escape: () => {
    if (anyOverlayOpen()) return
    if (selectedGeoid.value && drawerOpen.value) drawerOpen.value = false
    else if (ui.dualView) setDual(false)
    else if (selectedGeoid.value) drawerOpen.value = false
    else if (focusMode.value) setFocus(false)
  },
  toggleFullscreen: () => { if (fsSupported && !anyOverlayOpen()) toggleFs() },
  toggleTheme: () => ui.toggleTheme(),
  toggleBasemap: () => ui.setBasemap(basemap.value === 'satellite' ? 'streets' : 'satellite'),
  toggleHotspots: () => {
    if (hotspotsOpen.value) { hotspotsOpen.value = false; return }
    if (!anyOverlayOpen() && hotspotsAvailable()) hotspotsOpen.value = true
  },
  help: () => { if (!anyOverlayOpen()) shortcutsOpen.value = true },
  jumpBelowMedian,
  toggleBelowMedian,
  toggleStar,
})
// #74: `b` toggles the city-median filter (same as Layers switch). #95 announce fires from the existing watcher.
function toggleBelowMedian() {
  if (anyOverlayOpen()) return
  if (!medianAvailable.value) {
    linkSnack.value = 'City-median filter needs at least 2 tracts with data'
    return
  }
  belowMedian.value = !belowMedian.value
}
// #84: `*` stars/unstars the selected tract (same toggle as TractDetails). Drawer/focus OK; overlays ignore.
const starAnnounce = ref('')
function toggleStar() {
  if (anyOverlayOpen()) return
  const id = city.value?.id ?? cityStore.cityId ?? null
  if (!selectedGeoid.value || !id) { linkSnack.value = 'Select a tract to star'; return }
  starAnnounce.value = allFavs.toggle(id, selectedGeoid.value) ? 'Starred' : 'Star removed'
}
// #77: n/p cycle the #59 below-median set (rank asc, geoid asc; wraps). Requires the toggle on; ignores #73 bin.
const jumpAnnounce = ref('')
function jumpBelowMedian(dir: 1 | -1) {
  if (anyOverlayOpen()) return
  if (!medianAvailable.value) return
  const set = belowMedianOrder(tracts.value, vk.value, hotspotAscending(ui.metric))
  if (!set.length) return
  if (!belowMedian.value) { linkSnack.value = `Turn on ${ui.metric.bmSwitchLabel} first`; return }
  const cur = set.findIndex((t) => t.geoid === selectedGeoid.value)
  const i = cur < 0 ? (dir === 1 ? 0 : set.length - 1) : (cur + dir + set.length) % set.length
  cityStore.select(set[i].geoid)
  jumpAnnounce.value = `${set[i].name} · ${i + 1} of ${set.length} ${ui.metric.higherIsBetter ? 'below' : 'above'} median`
}
// #95: one polite live region for filter changes (below-median / density bin / hotspots). Skips restores.
const filterAnnounce = ref('')
let filterQuiet = false
function quietFilters() {
  filterQuiet = true
  nextTick(() => nextTick(() => { filterQuiet = false }))
}
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
function announceFilter(text: string) {
  if (filterQuiet || loading.value || !tracts.value?.features.length) return
  if (filterAnnounce.value === text) {
    filterAnnounce.value = ''
    nextTick(() => { filterAnnounce.value = text })
  } else filterAnnounce.value = text
}
watch(() => cityStore.cityId, quietFilters, { flush: 'sync' })
watch(loading, quietFilters, { flush: 'sync' })
watch(belowMedian, (on) => {
  announceFilter(on ? `${ui.metric.bmSwitchLabel} on · ${plural(belowMedianOrder(tracts.value, vk.value, hotspotAscending(ui.metric)).length, 'tract', 'tracts')}` : `${ui.metric.bmSwitchLabel} off`)
})
watch(() => ui.densityBinIndex, (i) => {
  if (i === null) { announceFilter('All density bins'); return }
  const m = viewMeta.value
  if (!m) return
  const isKm2 = ui.effectiveUnit === 'km2'
  const rows = binRows(m.breaks, choroplethColors(m, ui.choroplethMode, ui.choroplethPalette), isKm2, isKm2 ? ACRES_PER_KM2 : 1)
  if (!rows[i]) return
  announceFilter(`Density bin ${rows[i].label} · ${plural(binCounts(tracts.value, m.breaks, vk.value)[i] ?? 0, 'tract', 'tracts')}`)
})
watch(hotspotsOpen, (open) => {
  if (!open) return
  const n = hotspotTracts(tracts.value?.features, vk.value, hotspotAscending(ui.metric)).length
  const hn = ui.metric.hotspotNoun
  if (hn) announceFilter(n ? plural(n, hn[0], hn[1]) : `No ${hn[1]}`)
  else announceFilter(n ? plural(n, 'low-canopy hotspot', 'low-canopy hotspots') : 'No low-canopy hotspots')
})
// #89 grouped cheat sheet — single source of truth for on-screen + print. Labels match useKeyboardShortcuts handlers.
type ShortcutGroup = { id: string; title: string; rows: [string, string][]; caption?: string }
const SHORTCUT_GROUPS: ShortcutGroup[] = [
  { id: 'map', title: 'Map', rows: [
    ['s', 'Toggle satellite basemap'], ['d', 'Toggle dark mode'],
    ...(fsSupported ? [['f', 'Fullscreen'] as [string, string]] : []),
    ['Esc', 'Close panel, clear selection, or exit focus'],
  ] },
  { id: 'filters', title: 'Filters', rows: [
    ['b', 'Toggle city-median filter'],
    ['h', 'Low-canopy hotspots'],
    ['n', 'Next below-median tract'],
    ['p', 'Previous below-median tract'],
  ], caption: 'n / p need the city-median filter on.' },
  { id: 'find', title: 'Find & export', rows: [['/', 'Find tract'], ['*', 'Star / unstar selected tract']] },
  { id: 'help', title: 'Help', rows: [['?', 'Keyboard shortcuts']] },
]
function printShortcuts() {
  const root = document.documentElement
  root.classList.add('print-shortcuts')
  const done = () => { root.classList.remove('print-shortcuts'); window.removeEventListener('afterprint', done) }
  window.addEventListener('afterprint', done)
  window.print()
  setTimeout(done, 1000)
}
const tractFromFinder = ref(false)
function pickFromFinder(geoid: string) {
  tractFromFinder.value = true
  cityStore.select(geoid)
}
watch(drawerOpen, async (open) => {
  if (open) {
    await focusSoon('#tract-details-panel .tract-close')
  } else {
    const target = tractFromFinder.value ? findControl() : '#map-stage'
    tractFromFinder.value = false
    await focusSoon(target)
  }
})
</script>

<template>
  <v-app class="app-root">
    <a href="#map-stage" class="skip-link" @click.prevent="skipToMap">Skip to map</a>
    <v-app-bar color="primary" density="comfortable" flat>
      <template #prepend>
        <v-icon icon="mdi-tree" class="ml-2" />
      </template>
      <v-app-bar-title>
        <span class="font-weight-bold">Street Tree Equity</span>
        <span v-if="meta" class="text-body-2 ml-2 opacity-80">{{ meta.cityName }}<span v-if="mdAndUp && meta.subtitle"> · {{ meta.subtitle }}</span></span>
      </v-app-bar-title>

      <PlacePicker v-if="cities.length" :label="meta?.cityName ?? ''" :mobile="!mdAndUp"
        @select="selectCity" @compare="startCompare" />
      <CompareCities v-model="compareOpen" :initial="compareInitial" :mobile="!mdAndUp"
        @open="selectCity" @copied="(m: string) => (linkSnack = m)" />


      <component v-if="!focusMode" :is="mdAndUp ? VMenu : VBottomSheet" v-model="layersOpen" v-bind="mdAndUp ? { closeOnContentClick: false, location: 'bottom end' } : {}">
        <template #activator="{ props: act }">
          <v-btn v-bind="act" icon aria-label="Layers">
            <v-icon icon="mdi-layers-outline" />
            <v-tooltip activator="parent" location="bottom">Basemap and layers</v-tooltip>
          </v-btn>
        </template>
        <v-card id="layers-panel" :min-width="mdAndUp ? 260 : undefined" :max-width="mdAndUp ? undefined : '100%'">
          <v-card-title class="text-subtitle-1">Layers</v-card-title>
          <v-card-text class="pt-0">
            <div class="text-caption mb-1">Basemap</div>
            <v-btn-toggle
              :model-value="basemap"
              mandatory divided :density="mdAndUp ? 'compact' : 'comfortable'" :class="{ 'd-flex w-100': !mdAndUp }" variant="outlined" aria-label="Basemap"
              @update:model-value="(v: 'streets' | 'satellite') => ui.setBasemap(v)"
            >
              <v-btn value="streets" :class="{ 'flex-grow-1': !mdAndUp }">Streets</v-btn>
              <v-btn value="satellite" :class="{ 'flex-grow-1': !mdAndUp }">Satellite</v-btn>
            </v-btn-toggle>
            <v-divider class="my-3" />
            <div class="text-caption mb-1">Presets</div>
            <div class="d-flex flex-wrap ga-2" role="group" aria-label="Layer presets">
              <v-chip
                v-for="p in LAYER_PRESETS" :key="p.id"
                :color="activePreset === p.id ? 'primary' : undefined"
                :variant="activePreset === p.id ? 'tonal' : 'outlined'"
                :aria-pressed="activePreset === p.id ? 'true' : 'false'"
                :size="mdAndUp ? 'default' : 'large'"
                :class="{ 'preset-chip-touch': !mdAndUp }"
                @click.stop="applyLayers(p.flags)"
              >{{ p.label }}</v-chip>
            </div>
            <div class="text-caption text-medium-emphasis mt-1 mb-2">One tap sets the switches below. You can still tweak them.</div>
            <div class="text-caption mb-1">Metric</div>
            <v-btn-toggle :model-value="ui.activeMetric" mandatory density="compact" variant="outlined" divided color="primary"
              class="mb-1 unit-toggle metric-toggle" aria-label="Choropleth metric" @click.stop
              @update:model-value="(v: MetricId) => ui.setActiveMetric(v)">
              <v-btn v-for="id in METRIC_SWITCH_ORDER" :key="id" :value="id" size="small" :disabled="!metricOk[id] || ui.dualView" :title="METRICS[id].tooltip">{{ METRICS[id].shortLabel }}</v-btn>
            </v-btn-toggle>
            <div v-if="ui.dualView" class="text-caption text-medium-emphasis mb-1">Exit dual view to change metric — use the Left/Right selects below</div>
            <v-switch v-if="dualAvailable" :model-value="ui.dualView" label="Dual view" color="primary" density="compact" hide-details inset
              class="dual-switch" :class="{ 'switch-touch': !mdAndUp }" @click.stop @update:model-value="(v) => setDual(!!v)" />
            <div v-else-if="meta && !loading" class="text-caption text-medium-emphasis mb-1">Needs two metrics in this pack</div>
            <div v-if="ui.dualView && dualAvailable" class="d-flex ga-2 mb-2 dual-selects" @click.stop>
              <v-select :model-value="ui.dualLeft" :items="dualOptions" :label="mdAndUp ? 'Left' : 'Top'" density="compact" variant="outlined" hide-details
                class="dual-left" @update:model-value="(v: MetricId) => setDualSide('left', v)" />
              <v-select :model-value="ui.dualRight" :items="dualOptions" :label="mdAndUp ? 'Right' : 'Bottom'" density="compact" variant="outlined" hide-details
                class="dual-right" @update:model-value="(v: MetricId) => setDualSide('right', v)" />
            </div>
            <div v-if="ui.activeMetric === 'foodAccess'" class="text-caption text-medium-emphasis mb-1">Share of residents &gt;½ mile from a SNAP-authorized store (USDA SRAM 2025). Complements grocery store counts.</div>
            <template v-if="meta && !loading">
              <div v-for="id in METRIC_IDS.filter((i) => !metricOk[i] && METRICS[i].missingCaption)" :key="`miss-${id}`" class="text-caption text-medium-emphasis mb-1">{{ METRICS[id].missingCaption }}</div>
            </template>
            <div class="mb-1" />
            <template v-if="ui.metric.usesDensityUnit">
            <div class="text-caption mb-1">Density unit</div>
            <v-btn-toggle :model-value="densityUnit" mandatory density="compact" variant="outlined" divided color="primary"
              class="mb-2 unit-toggle" :aria-label="`${ui.metric.unitNoun[0].toUpperCase()}${ui.metric.unitNoun.slice(1)} unit`" @click.stop
              @update:model-value="(v: 'acre' | 'km2') => ui.setDensityUnit(v)">
              <v-btn value="acre" size="small">Per acre</v-btn>
              <v-btn value="km2" size="small">Per km²</v-btn>
            </v-btn-toggle>
            </template>
            <div class="text-caption mb-n1">Tract fill</div>
            <v-slider :model-value="fillOpacity" :min="0.3" :max="1" :step="0.05" density="compact" color="primary"
              hide-details thumb-label class="fill-opacity-slider mb-1" aria-label="Tract fill opacity" @click.stop
              @update:model-value="(v: number) => ui.setFillOpacity(v)">
              <template #thumb-label="{ modelValue }">{{ Math.round(modelValue * 100) }}%</template>
              <template #prepend><span class="text-caption text-medium-emphasis">Fainter</span></template>
              <template #append><span class="text-caption text-medium-emphasis">Stronger</span></template>
            </v-slider>
            <div class="text-caption mb-1">Color ramp</div>
            <v-btn-toggle :model-value="choroplethMode" mandatory density="compact" variant="outlined" divided color="primary"
              class="unit-toggle" aria-label="Choropleth color ramp" @click.stop
              @update:model-value="(v: 'green' | 'contrast') => ui.setChoroplethMode(v)">
              <v-btn value="green" size="small">Green</v-btn>
              <v-btn value="contrast" size="small">High contrast</v-btn>
            </v-btn-toggle>
            <div class="text-caption text-medium-emphasis mt-1 mb-1">Same density bins — different colors.</div>
            <v-switch :model-value="ui.choroplethPalette === 'cb'" label="Colorblind-safe colors" aria-label="Colorblind-safe choropleth colors"
              color="primary" hide-details density="compact"
              @update:model-value="(v: boolean | null) => ui.setChoroplethPalette(v ? 'cb' : 'default')" />
            <div class="text-caption text-medium-emphasis ms-1 mb-1">Blues–greens ramp; High contrast still uses its own colors.</div>
            <div v-if="treesDeferred && !treesAvailable" class="mb-1">
              <v-btn variant="tonal" size="small" prepend-icon="mdi-pine-tree" aria-label="Load individual tree points"
                :disabled="treesLoading" :loading="treesLoading" @click="loadTreePoints()">
                {{ treesLoading ? 'Loading tree points…' : 'Load tree points' }}
              </v-btn>
              <div class="text-caption text-medium-emphasis ms-1 mt-1">Optional · can be a large file on cellular</div>
            </div>
            <v-switch v-if="treesAvailable" v-model="showTrees" label="Individual trees (visible when zoomed in)" color="primary" hide-details density="compact" />
            <v-switch v-model="showParks" label="Parks" color="primary" hide-details density="compact" />
            <template v-if="schools?.features.length">
              <v-switch v-model="showSchools" label="Schools" color="primary" hide-details density="compact" />
              <div class="text-caption text-medium-emphasis ms-1 mb-1">OSM amenity=school</div>
            </template>
            <template v-if="libraries?.features.length">
              <v-switch v-model="showLibraries" label="Libraries & community centres" color="teal-darken-1" hide-details density="compact" />
              <div class="text-caption text-medium-emphasis ms-1 mb-1">OSM amenity=library / community_centre</div>
            </template>
            <template v-if="clinics?.features.length">
              <v-switch v-model="showClinics" label="Pharmacies & clinics" color="blue-darken-1" hide-details density="compact" />
              <div class="text-caption text-medium-emphasis ms-1 mb-1">OSM amenity=pharmacy / clinic / doctors</div>
            </template>
            <!-- #116: directly after Pharmacies & clinics -->
            <template v-if="emergency?.features.length">
              <v-switch v-model="showEmergency" label="Hospitals & fire stations" color="red-darken-1" hide-details density="compact" />
              <div class="text-caption text-medium-emphasis ms-1 mb-1">OSM amenity=hospital / fire_station</div>
            </template>
            <!-- #122: after Pharmacies & clinics (#112) -->
            <template v-if="gardens?.features.length">
              <v-switch v-model="showGardens" label="Gardens & allotments" color="light-green-darken-1" hide-details density="compact" />
              <div class="text-caption text-medium-emphasis ms-1 mb-1">OSM leisure=garden / allotments</div>
            </template>
            <!-- #126: after Gardens & allotments -->
            <template v-if="fountains?.features.length">
              <v-switch v-model="showFountains" label="Drinking fountains" color="cyan-darken-1" hide-details density="compact" />
              <div class="text-caption text-medium-emphasis ms-1 mb-1">OSM amenity=drinking_water</div>
            </template>
            <!-- #128: after Drinking fountains -->
            <template v-if="postOffices?.features.length">
              <v-switch v-model="showPostOffices" label="Post offices" color="purple-darken-1" hide-details density="compact" />
              <div class="text-caption text-medium-emphasis ms-1 mb-1">OSM amenity=post_office</div>
            </template>
            <!-- #130: after Post offices -->
            <template v-if="playgrounds?.features.length">
              <v-switch v-model="showPlaygrounds" label="Playgrounds" color="pink-lighten-1" hide-details density="compact" />
              <div class="text-caption text-medium-emphasis ms-1 mb-1">OSM leisure=playground</div>
            </template>
            <!-- #132: after Playgrounds -->
            <template v-if="toilets?.features.length">
              <v-switch v-model="showToilets" label="Public toilets" color="blue-grey-darken-1" hide-details density="compact" />
              <div class="text-caption text-medium-emphasis ms-1 mb-1">OSM amenity=toilets</div>
            </template>
            <!-- #134: after Public toilets -->
            <template v-if="benches?.features.length">
              <v-switch v-model="showBenches" label="Benches" color="brown-darken-1" hide-details density="compact" />
              <div class="text-caption text-medium-emphasis ms-1 mb-1">OSM amenity=bench</div>
            </template>
            <v-switch v-model="showRoads" label="Plant-here streets (orange)" color="orange-darken-2" hide-details density="compact" />
            <template v-if="bike || transit || sidewalks">
              <div class="text-overline text-medium-emphasis ms-1 mt-1">Mobility</div>
              <template v-if="bike">
                <v-switch v-model="showBike" label="Bike lanes" color="light-blue-darken-3" hide-details density="compact" />
                <div class="text-caption text-medium-emphasis ms-1 mb-1">OSM cycleways</div>
              </template>
              <template v-if="transit">
                <v-switch v-model="showTransit" label="Transit" color="pink-darken-2" hide-details density="compact" />
                <div class="text-caption text-medium-emphasis ms-1 mb-1">OSM stops &amp; stations</div>
              </template>
              <template v-if="sidewalks">
                <v-switch v-model="showSidewalks" label="Sidewalks" color="amber-darken-2" hide-details density="compact" />
                <div class="text-caption text-medium-emphasis ms-1 mb-1">OSM mapped walkways</div>
              </template>
            </template>
            <v-switch v-model="highlightBottomQuartile" label="Outline the 25% of tracts with the fewest trees" color="deep-orange" hide-details density="compact" />
            <v-switch v-model="belowMedian" :label="ui.metric.bmSwitchLabel" color="primary" hide-details density="compact" :disabled="!medianAvailable" />
            <div class="text-caption text-medium-emphasis ms-1 mb-1">{{ medianAvailable ? ui.metric.bmCaption : 'Needs at least 2 tracts with density data' }}</div>
            <v-btn variant="text" size="small" prepend-icon="mdi-download" class="align-self-start" :disabled="!medianAvailable" @click="exportBelowMedian(false)">Export below-median CSV</v-btn>
            <v-btn variant="text" size="small" prepend-icon="mdi-table-check" class="align-self-start" :disabled="!medianAvailable" @click="exportBelowMedian(true)">All tracts + below_median flag</v-btn>
            <v-btn variant="text" size="small" prepend-icon="mdi-download" class="align-self-start" aria-label="Export all tracts CSV" :disabled="loading || !cityStore.cityId || !(tracts?.features.length)" @click="exportAllTracts">Export all tracts CSV</v-btn>
            <v-btn variant="text" size="small" prepend-icon="mdi-download" class="align-self-start" aria-label="Export plant-here streets CSV" :disabled="loading || !cityStore.cityId || !(roads?.features.length)" @click="exportPlantHere">Export plant-here CSV</v-btn>
            <div class="text-caption text-medium-emphasis ms-1 mb-1">Includes OSM-derived values (ODbL).</div>
          </v-card-text>
        </v-card>
      </component>
      <TractFinder v-model="finderOpen" :mobile="!mdAndUp" :tracts="tracts?.features ?? null" :loading="loading"
        :city-id="city?.id ?? null" @pick="pickFromFinder" />
      <HotspotsPanel v-model="hotspotsOpen" :mobile="!mdAndUp" :tracts="tracts?.features ?? null" :loading="loading"
        :city-name="meta?.cityName ?? ''" :unit="densityUnit" :city-id="city?.id ?? null" :has-schools="!!schools" :has-libraries="!!libraries" :has-gardens="!!gardens" :has-fountains="!!fountains" :has-post-offices="!!postOffices" :has-playgrounds="!!playgrounds" :has-toilets="!!toilets" :has-benches="!!benches" :has-clinics="!!clinics" :has-emergency="!!emergency" :dual-labels="ui.dualView ? [dualLabel(ui.dualLeft), dualLabel(ui.dualRight)] : null" @pick="pickFromHotspots"
        @exported="linkSnack = 'Hotspots CSV downloaded'" />
      <FavoritesPanel v-model="favoritesOpen" :mobile="!mdAndUp" :tracts="tracts?.features ?? null" :loading="loading"
        :city-name="meta?.cityName ?? ''" :unit="densityUnit" :city-id="city?.id ?? null" @pick="pickFromHotspots"
        @exported="linkSnack = 'Favorites CSV downloaded'" />
      <template v-if="mdAndUp">
        <v-btn v-if="!focusMode" id="find-tract-btn" icon aria-label="Find tract" @click="finderOpen = true">
          <v-icon icon="mdi-magnify" />
          <v-tooltip activator="parent" location="bottom">Find tract</v-tooltip>
        </v-btn>
        <v-btn icon :aria-label="resetLabel" @click="mapRef?.fitData()">
          <v-icon icon="mdi-fit-to-screen-outline" />
          <v-tooltip activator="parent" location="bottom">{{ resetLabel }}</v-tooltip>
        </v-btn>
        <v-btn v-if="geoSupported" id="locate-btn" icon :aria-label="locateLabel" :aria-busy="locating ? 'true' : 'false'" :disabled="locating || !meta" @click="locateMe">
          <v-icon icon="mdi-crosshairs-gps" />
          <v-tooltip activator="parent" location="bottom">Locate me</v-tooltip>
        </v-btn>
        <v-btn icon aria-label="Share map link" @click="copyLink">
          <v-icon icon="mdi-link-variant" />
          <v-tooltip activator="parent" location="bottom">Share map link</v-tooltip>
        </v-btn>
        <v-btn icon aria-label="Print map" @click="printMap">
          <v-icon icon="mdi-printer" />
          <v-tooltip activator="parent" location="bottom">Print map</v-tooltip>
        </v-btn>
        <v-btn icon :aria-label="focusLabel" :aria-pressed="focusMode ? 'true' : 'false'" @click="toggleFocus">
          <v-icon :icon="focusMode ? 'mdi-fullscreen-exit' : 'mdi-fullscreen'" />
          <v-tooltip activator="parent" location="bottom">{{ focusLabel }}</v-tooltip>
        </v-btn>
        <v-btn v-if="fsSupported" id="fullscreen-btn" icon :aria-label="fsLabel" :aria-pressed="isFullscreen ? 'true' : 'false'" @click="toggleFs">
          <v-icon :icon="isFullscreen ? 'mdi-arrow-collapse-all' : 'mdi-arrow-expand-all'" />
          <v-tooltip activator="parent" location="bottom">{{ fsLabel }}</v-tooltip>
        </v-btn>
        <v-btn v-if="!focusMode" icon aria-label="About" @click="aboutOpen = true">
          <v-icon icon="mdi-information-outline" />
          <v-tooltip activator="parent" location="bottom">About</v-tooltip>
        </v-btn>
      </template>
      <v-btn icon :aria-label="themeLabel" @click="ui.toggleTheme()">
        <v-icon :icon="isDark ? 'mdi-white-balance-sunny' : 'mdi-weather-night'" />
        <v-tooltip activator="parent" location="bottom">{{ themeLabel }}</v-tooltip>
      </v-btn>
      <template v-if="!mdAndUp && focusMode">
        <v-btn icon :aria-label="resetLabel" @click="mapRef?.fitData()"><v-icon icon="mdi-fit-to-screen-outline" /></v-btn>
        <v-btn v-if="geoSupported" icon :aria-label="locateLabel" :aria-busy="locating ? 'true' : 'false'" :disabled="locating || !meta" @click="locateMe"><v-icon icon="mdi-crosshairs-gps" /></v-btn>
        <v-btn icon aria-label="Share map link" @click="copyLink"><v-icon icon="mdi-link-variant" /></v-btn>
        <v-btn icon aria-label="Exit focus" aria-pressed="true" @click="setFocus(false)"><v-icon icon="mdi-fullscreen-exit" /></v-btn>
        <v-btn v-if="fsSupported" icon :aria-label="fsLabel" :aria-pressed="isFullscreen ? 'true' : 'false'" @click="toggleFs"><v-icon :icon="isFullscreen ? 'mdi-arrow-collapse-all' : 'mdi-arrow-expand-all'" /></v-btn>
      </template>
      <v-menu v-if="!mdAndUp && !focusMode" location="bottom end">
        <template #activator="{ props: act }">
          <v-btn id="more-actions-btn" v-bind="act" icon="mdi-dots-vertical" aria-label="More actions" />
        </template>
        <v-list density="comfortable">
          <v-list-item prepend-icon="mdi-magnify" title="Find tract" @click="finderOpen = true" />
          <v-list-item v-if="meta && tracts?.features.length" prepend-icon="mdi-tree-outline" title="Low-canopy hotspots" @click="hotspotsOpen = true" />
          <v-list-item v-if="meta" prepend-icon="mdi-star-outline" title="Starred tracts" @click="favoritesOpen = true" />
          <v-list-item prepend-icon="mdi-fit-to-screen-outline" :title="resetLabel" @click="mapRef?.fitData()" />
          <v-list-item v-if="geoSupported" prepend-icon="mdi-crosshairs-gps" :title="locateLabel" :disabled="locating || !meta" @click="locateMe" />
          <v-list-item prepend-icon="mdi-link-variant" title="Share map link" @click="copyLink" />
          <v-list-item prepend-icon="mdi-printer" title="Print map" @click="printMap" />
          <v-list-item prepend-icon="mdi-fullscreen" title="Focus map" @click="setFocus(true)" />
          <v-list-item v-if="fsSupported" prepend-icon="mdi-arrow-expand-all" title="Fullscreen" @click="enterFs" />
          <v-list-item prepend-icon="mdi-keyboard-outline" title="Keyboard shortcuts" @click="shortcutsOpen = true" />
          <v-list-item prepend-icon="mdi-information-outline" title="About" @click="aboutOpen = true" />
        </v-list>
      </v-menu>
      <span class="sr-only" aria-live="polite">{{ themeAnnounce }}</span>
      <span class="sr-only" aria-live="polite">{{ jumpAnnounce }}</span>
      <span class="sr-only" aria-live="polite" aria-atomic="true">{{ dualAnnounce }}</span>
      <span class="sr-only" aria-live="polite">{{ starAnnounce }}</span>
      <span class="sr-only" aria-live="polite" aria-atomic="true">{{ filterAnnounce }}</span>
    </v-app-bar>

    <v-navigation-drawer v-model="drawerOpen" :location="mdAndUp ? 'right' : 'bottom'" :width="380" temporary
      :scrim="false" :class="{ 'bottom-drawer': !mdAndUp }">
      <TractDetails v-if="selectedTract && meta" :tract="selectedTract" :meta="meta" :city-median-acre="medianAcre"
        :roads="roads" :total="tracts?.features.length ?? 0" @fly-to-road="(f) => mapRef?.fitRoad(f)" @close="cityStore.select(null)" @fly-to-park="flyToPark" />
    </v-navigation-drawer>

    <v-main class="d-flex flex-column">
      <OfflineStatus :city-name="meta?.cityName ?? city?.cityName ?? ''" :attempt="city?.id" />
      <div id="map-stage" class="main-stage" tabindex="-1" role="region" aria-label="Map">
        <!-- #65: app bar is outside the FS element, so keep Exit reachable inside map-stage (all sizes). -->
        <v-btn v-if="isFullscreen" class="fs-exit-btn" icon size="small" variant="elevated" aria-label="Exit fullscreen" aria-pressed="true" @click="exitFs">
          <v-icon icon="mdi-arrow-collapse-all" />
          <v-tooltip activator="parent" location="right">Exit fullscreen</v-tooltip>
        </v-btn>
      <DualMapView v-if="ui.dualView && dualAvailable && city && meta && tracts && parks" :key="`dual-${city.id}`" ref="mapRef" :left-metric="ui.dualLeft" :right-metric="ui.dualRight"
        @satellite-error="satFallback = true" :initial-view="initialView" :mobile="!mdAndUp" :data-path="city.dataPath" :meta="meta" :tracts="tracts" :parks="parks" :roads="roads" :bike="bike" :transit="transit" :trees="trees" :schools="schools" :libraries="libraries" :gardens="gardens" :fountains="fountains" :post-offices="postOffices" :playgrounds="playgrounds" :toilets="toilets" :benches="benches" :clinics="clinics" :emergency="emergency" :sidewalks="sidewalks" :focus-mode="focusMode" :hotspots-open="hotspotsOpen" :hotspot-geoids="hotspotGeoidList" :below-median="belowMedian && medianAvailable" />
      <MapView
        @satellite-error="satFallback = true" v-else-if="city && meta && tracts && parks " :key="city.id" ref="mapRef" :initial-view="initialView" :mobile="!mdAndUp" :data-path="city.dataPath" :meta="viewMeta!" :tracts="tracts" :parks="parks" :roads="roads" :bike="bike" :transit="transit" :trees="trees" :schools="schools" :libraries="libraries" :gardens="gardens" :fountains="fountains" :post-offices="postOffices" :playgrounds="playgrounds" :toilets="toilets" :benches="benches" :clinics="clinics" :emergency="emergency" :sidewalks="sidewalks" :focus-mode="focusMode" :hotspots-open="hotspotsOpen" :hotspot-geoids="hotspotGeoidList" />

      <div v-if="loading" class="d-flex flex-column fill-height align-center justify-center" role="status" aria-live="polite">
        <v-progress-circular indeterminate color="primary" size="48" aria-label="Loading map data" />
        <div class="text-body-2 mt-3">Loading tree data for {{ loadingName }}…</div>
        <div class="text-caption mt-1 opacity-80">Census tracts and map layers</div>
      </div>
      <v-alert v-if="error && !loading" id="pack-error" type="error" class="ma-4" title="Couldn’t load this city’s data">
        <p>{{ loadingName }} didn’t load. Check your connection, then try again. Packaged files may also be missing or updating.</p>
        <p v-if="isOffline" class="mt-1">This city isn’t saved on this device yet. Connect once to download it.</p>
        <div class="d-flex flex-wrap ga-2 mt-3">
          <v-btn class="pack-retry" variant="flat" color="white" @click="retry">Try again</v-btn>
          <v-btn variant="outlined" :href="ISSUE_URL" target="_blank" rel="noopener noreferrer">Open a GitHub issue<span class="sr-only"> (opens in new tab)</span></v-btn>
        </div>
        <v-expansion-panels class="mt-3" variant="accordion">
          <v-expansion-panel title="Details" :text="error" />
        </v-expansion-panels>
        <div class="text-body-2 mt-2">Or pick another city from the place menu above.</div>
      </v-alert>
      <CreditStrip v-if="city && meta" />
      <v-sheet v-if="meta && !ui.dualView && (mdAndUp || !drawerOpen || printing)" class="map-legend-box pa-2" rounded elevation="2" color="surface">
        <div v-if="legendExpanded" id="legend-panel">
          <div class="d-flex align-center justify-space-between mb-1">
            <span class="text-subtitle-2">Legend</span>
            <v-btn v-if="mdAndUp" icon="mdi-chevron-down" variant="text" size="small" aria-label="Hide legend" title="Hide legend"
              :aria-expanded="true" aria-controls="legend-panel" @click="legendExpanded = false" />
            <v-btn v-else variant="text" size="small" class="text-none legend-toggle" prepend-icon="mdi-chevron-down"
              :aria-expanded="true" aria-controls="legend-panel" @click="legendExpanded = false">Hide legend</v-btn>
          </div>
          <MapLegend :tracts="loading ? null : tracts" :below-median="belowMedian && medianAvailable" :meta="viewMeta!" :trees-available="treesAvailable" :dense="mdAndUp" />
        </div>
        <v-btn v-else variant="tonal" size="small" class="text-none legend-toggle" prepend-icon="mdi-palette-swatch-outline"
          :aria-expanded="false" aria-controls="legend-panel" @click="legendExpanded = true">Legend</v-btn>
      </v-sheet>

      <v-sheet v-if="meta && !selectedTract && mdAndUp && !focusMode" class="hint no-print pa-3" rounded elevation="2" color="surface" max-width="320"
        role="region" :aria-label="`${meta.cityName} overview`">
        <div class="text-subtitle-2">{{ meta.cityName }}</div>
        <div v-if="meta.subtitle" class="text-caption text-medium-emphasis">{{ meta.subtitle }}</div>
        <div class="text-body-2 mt-1">
          <div><strong>{{ meta.counts.trees.toLocaleString() }}</strong> mapped trees · <strong>{{ meta.counts.tracts }}</strong> tracts</div>
          <div>Avg <strong>{{ overviewDensity }}</strong></div>
          <div v-if="spread" class="text-caption text-medium-emphasis" role="group" :aria-label="spread.aria">
            <span aria-hidden="true">Spread&nbsp; p10 <strong>{{ spread.p10 }}</strong> · median <strong>{{ spread.med }}</strong> · p90 <strong>{{ spread.p90 }}</strong>&nbsp; {{ spread.unit }}<template v-if="spread.ratio"> · p90÷p10 ≈ {{ spread.ratio }}</template></span>
          </div>
          <div v-if="spread?.spark" class="spread-spark" role="img" :aria-label="spread.aria">
            <span class="spread-spark-range" aria-hidden="true" :style="{ left: spread.spark.left + '%', width: `max(${spread.spark.width}%, 2px)` }" />
            <span class="spread-spark-tick" aria-hidden="true" :style="{ left: spread.spark.med + '%' }" />
          </div>
          <div v-if="plantHereStat">{{ plantHereStat }}</div>
        </div>
        <DensityAreaScatter :tracts="tracts" :loading="loading" />
        <DensityHistogram :meta="viewMeta!" :tracts="tracts" :below-median="belowMedian && medianAvailable" />
        <div class="text-caption mt-1">Click a tract for details.</div>
        <div class="d-flex ga-1 mt-1">
          <v-btn variant="tonal" size="small" class="overview-action" color="primary" @click="startCompare">Compare cities</v-btn>
          <v-btn v-if="tracts?.features.length" variant="text" size="small" class="overview-action" @click="hotspotsOpen = true">Hotspots</v-btn>
          <v-btn variant="text" size="small" class="overview-action" @click="favoritesOpen = true">Starred</v-btn>
          <v-btn variant="text" size="small" class="overview-action" @click="aboutOpen = true">About</v-btn>
        </div>
      </v-sheet>
      <v-sheet v-if="meta && !selectedTract && !drawerOpen && !mdAndUp && !focusMode" class="overview-strip no-print pa-2 d-flex align-center" rounded elevation="2" color="surface"
        role="region" :aria-label="`${meta.cityName} overview`">
        <div class="flex-grow-1" style="min-width: 0">
        <div class="d-flex flex-wrap ga-1 text-caption">
          <v-chip size="small" variant="tonal">{{ meta.counts.trees.toLocaleString() }} trees</v-chip>
          <v-chip size="small" variant="tonal">{{ meta.counts.tracts }} tracts</v-chip>
          <v-chip size="small" variant="tonal">avg {{ overviewDensity.replace(' / ', '/') }}</v-chip>
          <v-chip v-if="spread" size="small" variant="tonal" class="spread-chip" :aria-label="spread.aria"><span class="text-truncate">p10 {{ spread.p10 }} · med {{ spread.med }} · p90 {{ spread.p90 }}{{ spread.unit }}<template v-if="spread.ratio"> {{ spread.ratio }}</template></span></v-chip>
          <v-chip v-if="plantHereChip" size="small" variant="tonal" color="deep-orange">{{ plantHereChip }}</v-chip>
        </div>
        <div v-if="spread?.spark" class="spread-spark spread-spark--dense" role="img" :aria-label="spread.aria">
            <span class="spread-spark-range" aria-hidden="true" :style="{ left: spread.spark.left + '%', width: `max(${spread.spark.width}%, 2px)` }" />
            <span class="spread-spark-tick" aria-hidden="true" :style="{ left: spread.spark.med + '%' }" />
          </div>
        <DensityHistogram :meta="viewMeta!" :tracts="tracts" :below-median="belowMedian && medianAvailable" dense />
        </div>
        <v-btn icon="mdi-compare" variant="text" size="small" class="overview-icon" aria-label="Compare cities" @click="startCompare" />
        <v-btn v-if="tracts?.features.length" icon="mdi-tree-outline" variant="text" size="small" class="overview-icon" aria-label="Low-canopy hotspots" @click="hotspotsOpen = true" />
        <v-btn icon="mdi-star-outline" variant="text" size="small" class="overview-icon" aria-label="Starred tracts" @click="favoritesOpen = true" />
        <v-btn icon="mdi-information-outline" variant="text" size="small" class="overview-icon" aria-label="About" @click="aboutOpen = true" />
      </v-sheet>
      </div>
    </v-main>

    <v-dialog v-model="shortcutsOpen" max-width="420">
      <v-card id="shortcuts-panel" title="Keyboard shortcuts">
        <v-card-text>
          <p class="shortcuts-print-title">Street Tree Equity — Keyboard shortcuts</p>
          <section v-for="g in SHORTCUT_GROUPS" :key="g.id" class="shortcuts-group" role="group" :aria-labelledby="`shortcuts-h-${g.id}`">
            <h3 :id="`shortcuts-h-${g.id}`" class="text-subtitle-2 font-weight-bold mb-1">{{ g.title }}</h3>
            <dl class="shortcuts-list">
              <template v-for="[k, label] in g.rows" :key="k">
                <dt><kbd>{{ k }}</kbd></dt><dd>{{ label }}</dd>
              </template>
            </dl>
            <p v-if="g.caption" class="text-caption mt-1 text-medium-emphasis"><kbd>n</kbd> / <kbd>p</kbd> need <strong>Below city median</strong> on.</p>
            <p v-if="g.id === 'find'" class="text-caption mt-1 text-medium-emphasis"><strong>Export:</strong> CSV from <strong>Layers → Export all tracts</strong>, or export from a selected tract. No keyboard shortcut.</p>
          </section>
          <p class="text-caption mt-3 text-medium-emphasis">Shortcuts are off while typing in a field.</p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn class="shortcuts-print" variant="text" prepend-icon="mdi-printer" @click="printShortcuts">Print</v-btn>
          <v-btn class="shortcuts-close" color="primary" variant="text" @click="shortcutsOpen = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="aboutOpen" :max-width="mdAndUp ? 560 : '100%'" :fullscreen="!mdAndUp" scrollable>
      <v-card title="About this map">
        <v-card-text>
          <h3 class="text-subtitle-1 font-weight-bold mb-1">What it is</h3>
          <p class="text-body-2 mb-2">Trees per acre of land by U.S. Census tract, counted from OpenStreetMap <code>natural=tree</code>.</p>
          <p class="text-body-2 mb-2">Low counts can mean fewer trees <em>or</em> fewer trees mapped — treat it as a conversation starter, and consider adding trees on OSM.</p>
          <p class="text-body-2 mb-2">Orange streets have no mapped tree within {{ meta?.roadsBufferMeters ?? 20 }} m. Parks come from OSM <code>leisure=park</code>.</p>
          <p class="text-body-2 mb-4">Static data files and no-key basemaps — no database, no API keys.</p>

          <h3 class="text-subtitle-1 font-weight-bold mb-1">Data sources</h3>
          <ul class="about-sources text-body-2 mb-4">
            <li><strong>Street trees, parks, groceries, schools, bike lanes &amp; transit stops, libraries &amp; community centres, community gardens &amp; allotments, drinking fountains, post offices, playgrounds, public toilets, benches, mapped sidewalks &amp; footpaths, pharmacies &amp; clinics, hospitals &amp; fire stations</strong> — © OpenStreetMap contributors · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">ODbL<span class="sr-only"> (opens in new tab)</span></a><span v-if="updated"> · OSM data as of {{ updated }}</span>. Sidewalk coverage reflects OpenStreetMap mapping and may be incomplete. OSM coverage of drinking fountains, post offices, playgrounds, public toilets and benches is uneven — absence on the map ≠ absence on the ground.</li>
            <li><strong>Tract boundaries</strong> — U.S. Census Bureau cartographic boundaries (public domain)<span v-if="meta?.censusVintage"> · {{ meta.censusVintage }}</span></li>
            <li v-if="meta?.acs"><strong>Median household income (tract)</strong> — U.S. Census Bureau American Community Survey (ACS) 5-year table {{ meta.acs.table }} ({{ meta.acs.vintage }}). Retrieved {{ meta.acs.retrievedAt }} from <a :href="meta.acs.sourceUrl" target="_blank" rel="noopener noreferrer">{{ meta.acs.sourceUrl }}<span class="sr-only"> (opens in new tab)</span></a>. Public domain.</li>
            <li v-if="meta?.acsPoverty"><strong>Poverty rate (tract)</strong> — U.S. Census Bureau American Community Survey (ACS) 5-year table {{ meta.acsPoverty.table }}, Poverty Status in the Past 12 Months ({{ meta.acsPoverty.vintage }}). Retrieved {{ meta.acsPoverty.retrievedAt }} from <a :href="meta.acsPoverty.sourceUrl" target="_blank" rel="noopener noreferrer">{{ meta.acsPoverty.sourceUrl }}<span class="sr-only"> (opens in new tab)</span></a>. Public domain.</li>
            <li v-if="meta?.acsNoVehicle"><strong>Households without a vehicle (tract)</strong> — U.S. Census Bureau American Community Survey (ACS) 5-year table {{ meta.acsNoVehicle.table }}, Household Size by Vehicles Available ({{ meta.acsNoVehicle.vintage }}). Retrieved {{ meta.acsNoVehicle.retrievedAt }} from <a :href="meta.acsNoVehicle.sourceUrl" target="_blank" rel="noopener noreferrer">{{ meta.acsNoVehicle.sourceUrl }}<span class="sr-only"> (opens in new tab)</span></a>. Public domain.</li>
            <li v-if="meta?.acsRentBurden"><strong>Rent-burdened renter households (tract)</strong> — U.S. Census Bureau American Community Survey (ACS) 5-year table {{ meta.acsRentBurden.table }}, Gross Rent as a Percentage of Household Income in the Past 12 Months ({{ meta.acsRentBurden.vintage }}). Retrieved {{ meta.acsRentBurden.retrievedAt }} from <a :href="meta.acsRentBurden.sourceUrl" target="_blank" rel="noopener noreferrer">{{ meta.acsRentBurden.sourceUrl }}<span class="sr-only"> (opens in new tab)</span></a>. Public domain.</li>
            <li v-if="meta?.acsAge"><strong>Residents age 65 and over (tract)</strong> — U.S. Census Bureau American Community Survey (ACS) 5-year table {{ meta.acsAge.table }}, Sex by Age ({{ meta.acsAge.vintage }}). Retrieved {{ meta.acsAge.retrievedAt }} from <a :href="meta.acsAge.sourceUrl" target="_blank" rel="noopener noreferrer">{{ meta.acsAge.sourceUrl }}<span class="sr-only"> (opens in new tab)</span></a>. Public domain.</li>
            <li v-if="meta?.acsUnder18"><strong>Residents under 18 (tract)</strong> — U.S. Census Bureau American Community Survey (ACS) 5-year table {{ meta.acsUnder18.table }}, Sex by Age ({{ meta.acsUnder18.vintage }}). Retrieved {{ meta.acsUnder18.retrievedAt }} from <a :href="meta.acsUnder18.sourceUrl" target="_blank" rel="noopener noreferrer">{{ meta.acsUnder18.sourceUrl }}<span class="sr-only"> (opens in new tab)</span></a>. Public domain.</li>
            <li v-if="meta?.cdcPlaces && hasPlacesAsthma">{{ PLACES_CITATION }} Retrieved {{ meta.cdcPlaces.retrievedAt }} from <a :href="meta.cdcPlaces.sourceUrl" target="_blank" rel="noopener noreferrer">{{ meta.cdcPlaces.sourceUrl }}<span class="sr-only"> (opens in new tab)</span></a></li>
            <li v-if="meta?.cdcPlaces && hasPlacesDiabetes">{{ PLACES_DIABETES_CITATION }} Retrieved {{ meta.cdcPlaces.retrievedAt }} from <a :href="meta.cdcPlaces.sourceUrl" target="_blank" rel="noopener noreferrer">{{ meta.cdcPlaces.sourceUrl }}<span class="sr-only"> (opens in new tab)</span></a></li>
            <li v-if="meta?.cdcPlaces && hasPlacesObesity">{{ PLACES_OBESITY_CITATION }} Retrieved {{ meta.cdcPlaces.retrievedAt }} from <a :href="meta.cdcPlaces.sourceUrl" target="_blank" rel="noopener noreferrer">{{ meta.cdcPlaces.sourceUrl }}<span class="sr-only"> (opens in new tab)</span></a></li>
            <li v-if="meta?.cdcPlaces && hasPlacesMentalHealth">{{ PLACES_MHLTH_CITATION }} Retrieved {{ meta.cdcPlaces.retrievedAt }} from <a :href="meta.cdcPlaces.sourceUrl" target="_blank" rel="noopener noreferrer">{{ meta.cdcPlaces.sourceUrl }}<span class="sr-only"> (opens in new tab)</span></a></li>
            <li v-if="meta?.cdcPlaces && hasPlacesPhysicalHealth">{{ PLACES_PHLTH_CITATION }} Retrieved {{ meta.cdcPlaces.retrievedAt }} from <a :href="meta.cdcPlaces.sourceUrl" target="_blank" rel="noopener noreferrer">{{ meta.cdcPlaces.sourceUrl }}<span class="sr-only"> (opens in new tab)</span></a></li>
            <li v-if="meta?.cdcPlaces && hasPlacesChd">{{ PLACES_CHD_CITATION }} Retrieved {{ meta.cdcPlaces.retrievedAt }} from <a :href="meta.cdcPlaces.sourceUrl" target="_blank" rel="noopener noreferrer">{{ meta.cdcPlaces.sourceUrl }}<span class="sr-only"> (opens in new tab)</span></a></li>
            <li v-if="meta?.cdcPlaces && hasPlacesBpHigh">{{ PLACES_BPHIGH_CITATION }} Retrieved {{ meta.cdcPlaces.retrievedAt }} from <a :href="meta.cdcPlaces.sourceUrl" target="_blank" rel="noopener noreferrer">{{ meta.cdcPlaces.sourceUrl }}<span class="sr-only"> (opens in new tab)</span></a></li>
            <li v-if="meta?.cdcPlaces && hasPlacesInactivity">{{ PLACES_LPA_CITATION }} Retrieved {{ meta.cdcPlaces.retrievedAt }} from <a :href="meta.cdcPlaces.sourceUrl" target="_blank" rel="noopener noreferrer">{{ meta.cdcPlaces.sourceUrl }}<span class="sr-only"> (opens in new tab)</span></a></li>
            <li v-if="meta?.cdcPlaces && hasPlacesCopd">{{ PLACES_COPD_CITATION }} Retrieved {{ meta.cdcPlaces.retrievedAt }} from <a :href="meta.cdcPlaces.sourceUrl" target="_blank" rel="noopener noreferrer">{{ meta.cdcPlaces.sourceUrl }}<span class="sr-only"> (opens in new tab)</span></a></li>
            <li v-if="meta?.cdcPlaces && hasPlacesSmoking">{{ PLACES_CSMOKING_CITATION }} Retrieved {{ meta.cdcPlaces.retrievedAt }} from <a :href="meta.cdcPlaces.sourceUrl" target="_blank" rel="noopener noreferrer">{{ meta.cdcPlaces.sourceUrl }}<span class="sr-only"> (opens in new tab)</span></a></li>
            <li v-if="meta?.acsLep"><strong>Limited English proficiency (tract)</strong> — U.S. Census Bureau American Community Survey (ACS) 5-year table {{ meta.acsLep.table }}, Age by Language Spoken at Home by Ability to Speak English for the Population 5 Years and Over ({{ meta.acsLep.vintage }}). Retrieved {{ meta.acsLep.retrievedAt }} from <a :href="meta.acsLep.sourceUrl" target="_blank" rel="noopener noreferrer">{{ meta.acsLep.sourceUrl }}<span class="sr-only"> (opens in new tab)</span></a>. Public domain. “Limited English” = speaks English less than “very well.”</li>
            <li v-if="meta?.acsSnap"><strong>SNAP households (tract)</strong> — U.S. Census Bureau American Community Survey (ACS) 5-year table {{ meta.acsSnap.table }}, Receipt of Food Stamps/SNAP in the Past 12 Months by Presence of People 60 Years and Over for Households ({{ meta.acsSnap.vintage }}). Retrieved {{ meta.acsSnap.retrievedAt }} from <a :href="meta.acsSnap.sourceUrl" target="_blank" rel="noopener noreferrer">{{ meta.acsSnap.sourceUrl }}<span class="sr-only"> (opens in new tab)</span></a>. Public domain. Share of households that received Food Stamps/SNAP in the past 12 months.</li>
            <li v-if="meta?.plantNeed"><strong>Planting need (tract)</strong> — a 0–100 score computed by this app from data already shown: tree density (fewer trees per acre = more need), share of residents in poverty (ACS B17001), and, where available, adult asthma (CDC PLACES). Each is rescaled 0–100 within this city (lowest tract = 0, highest = 100), tree density is flipped so the sparsest tract scores 100, and the parts are averaged with equal weight. Higher = more need. Compares tracts within one city only; not an official index. Inherits the sources and licenses of its inputs.</li>
            <li v-if="meta?.fara"><strong>Food access (tract)</strong> — {{ FARA_CITATION }} Retrieved {{ meta.fara.retrievedAt }} from <a :href="meta.fara.sourceUrl" target="_blank" rel="noopener noreferrer">{{ meta.fara.sourceUrl }}<span class="sr-only"> (opens in new tab)</span></a></li>
            <li v-if="meta?.nri"><strong>National Risk Index (tract)</strong> — FEMA NRI {{ meta.nri.version }}. {{ NRI_DISCLAIMER }} Retrieved {{ meta.nri.retrievedAt }} from <a :href="meta.nri.sourceUrl" target="_blank" rel="noopener noreferrer">{{ meta.nri.sourceUrl }}<span class="sr-only"> (opens in new tab)</span></a></li>
            <li><strong>Streets basemap</strong> — <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap<span class="sr-only"> (opens in new tab)</span></a> · OpenMapTiles · OSM data</li>
            <li><strong>Satellite</strong> — <a href="https://cloudless.eox.at" target="_blank" rel="noopener noreferrer">EOxCloudless 2025<span class="sr-only"> (opens in new tab)</span></a> by EOX · modified Copernicus Sentinel data 2025 · <strong>CC BY-NC-SA (non-commercial)</strong></li>
          </ul>

          <template v-if="meta && packRows.length">
            <h3 class="text-subtitle-1 font-weight-bold mb-1">This pack</h3>
            <dl class="about-pack text-body-2 mb-4">
              <template v-for="r in packRows" :key="r.label">
                <dt class="text-caption text-medium-emphasis">{{ r.label }}</dt>
                <dd :class="{ 'about-pack-mono': r.mono }">{{ r.value }}</dd>
              </template>
            </dl>
          </template>

          <h3 class="text-subtitle-1 font-weight-bold mb-1">Scope &amp; code</h3>
          <p class="text-body-2 mb-2"><strong>Packaged cities only:</strong> this site shows only the cities that ship with it — it is not a live national search.</p>
          <p class="text-body-2 mb-2"><strong>Offline:</strong> This browser can keep the app shell and the last city you opened. Street and satellite map tiles still need a connection.</p>
          <p class="text-body-2 mb-0"><strong>Source code:</strong> <a href="https://github.com/Zevl411/street-tree-equity" target="_blank" rel="noopener noreferrer">github.com/Zevl411/street-tree-equity<span class="sr-only"> (opens in new tab)</span></a></p>

          <div class="about-reset mt-4">
            <p class="text-caption text-medium-emphasis mb-1">This browser remembers your city, map view, layers, and starred tracts.</p>
            <v-btn id="about-reset-btn" variant="text" color="error" prepend-icon="mdi-restore" @click="resetConfirmOpen = true">Reset saved preferences</v-btn>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-btn variant="text" prepend-icon="mdi-content-copy" @click="copyCitations">Copy citations</v-btn>
          <v-spacer />
          <v-btn color="primary" variant="text" @click="aboutOpen = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <v-dialog v-model="resetConfirmOpen" max-width="400">
      <v-card id="reset-confirm" title="Reset saved preferences?">
        <v-card-text class="text-body-2">Clears this browser’s saved city, map view, starred tracts, theme, basemap, and layer choices. Packaged city data on the site is not deleted.</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn class="reset-cancel" variant="text" @click="resetConfirmOpen = false">Cancel</v-btn>
          <v-btn color="error" variant="flat" @click="confirmReset">Reset</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <v-snackbar v-model="citationsSnack" timeout="2500" class="safe-snack">Citations copied</v-snackbar>
    <v-dialog v-model="citationsFallbackOpen" max-width="480" @after-enter="selectCitations">
      <v-card id="citations-fallback" title="Copy citations">
        <v-card-text>
          <v-textarea :model-value="citationsText" readonly autofocus rows="7" variant="outlined" density="compact" label="Citations" @focus="(e: FocusEvent) => (e.target as HTMLTextAreaElement).select()" />
        </v-card-text>
        <v-card-actions><v-spacer /><v-btn color="primary" variant="text" @click="citationsFallbackOpen = false">Close</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
    <v-snackbar v-model="satFallback" timeout="5000" class="safe-snack">Satellite imagery unavailable — showing streets.</v-snackbar>
    <v-dialog v-model="shareFallbackOpen" max-width="420" @after-enter="selectShareUrl">
      <v-card id="share-fallback" title="Share map link">
        <v-card-text>
          <v-textarea :model-value="shareFallbackUrl" readonly autofocus rows="3" variant="outlined" density="compact"
            aria-label="Map link" hide-details @focus="(e: FocusEvent) => (e.target as HTMLTextAreaElement).select()" />
          <div class="text-caption text-medium-emphasis mt-2">Clipboard blocked — select the link and copy.</div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="selectShareUrl">Select all</v-btn>
          <v-btn variant="text" @click="shareFallbackOpen = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <v-snackbar :model-value="!!linkSnack" timeout="3000" class="safe-snack" @update:model-value="(v: boolean) => { if (!v) linkSnack = '' }">{{ linkSnack }}</v-snackbar>
  </v-app>
</template>

<style scoped>
.about-pack { display: grid; grid-template-columns: max-content 1fr; column-gap: 12px; row-gap: 2px; margin: 0; }
.about-pack dd { margin: 0; user-select: text; word-break: break-word; }
.about-pack-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.unit-toggle .v-btn { min-height: 44px; }
/* #106: 6-way metric switch wraps on narrow drawers */
.metric-toggle { flex-wrap: wrap; height: auto !important; }
.skip-link {
  position: absolute;
  left: 8px;
  top: 8px;
  z-index: 3000;
  padding: 8px 12px;
  border-radius: 4px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  transform: translateY(-200%);
}
.skip-link:focus-visible, .skip-link:focus { transform: none; }
#map-stage:focus { outline: none; }
#map-stage:focus-visible { outline-offset: -2px; }
.preset-chip-touch { min-height: 44px; }
/* Normal-flow stage inside v-main's padded box, so absolute map/overlays
   sit below the app bar instead of under it (#34). */
.main-stage {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
}
.hint {
  position: absolute;
  left: 12px;
  /* .main-stage already starts below the app bar (v-main padding). */
  top: 12px;
  z-index: 2;
}
.overview-strip {
  position: absolute;
  top: 8px;
  left: 8px;
  right: 8px;
  z-index: 2;
}
.overview-action { min-height: 44px; }
.overview-icon { min-width: 44px; min-height: 44px; }
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
.app-root {
  overflow-x: hidden;
}
.map-legend-box {
  position: absolute;
  left: calc(8px + env(safe-area-inset-left, 0px));
  bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  /* stay clear of bottom-right CreditStrip (#42) */
  max-width: min(320px, 46vw);
  max-height: calc(60dvh - env(safe-area-inset-bottom, 0px));
  overflow-y: auto;
  z-index: 2;
}
.legend-toggle {
  min-height: 44px;
}
.shortcuts-list { display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; align-items: center; margin: 0; }
.shortcuts-list dd { margin: 0; }
.shortcuts-group + .shortcuts-group { margin-top: 14px; }
.shortcuts-group h3 { margin: 0; }
.shortcuts-print-title { display: none; }
.shortcuts-group .text-caption kbd { font-family: ui-monospace, monospace; }
.shortcuts-list kbd { display: inline-block; min-width: 2em; text-align: center; padding: 2px 6px; border-radius: 4px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.3); font-family: ui-monospace, monospace; font-size: 0.85em; }
.bottom-drawer {
  max-height: min(85vh, calc(100dvh - var(--v-layout-top, 0px))) !important;
  height: auto !important;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.about-sources { padding-left: 1.1rem; }
.about-sources li { margin-bottom: 4px; }
.fs-exit-btn {
  position: absolute;
  top: calc(10px + env(safe-area-inset-top, 0px));
  left: calc(10px + env(safe-area-inset-left, 0px));
  z-index: 5;
}
@media print { .fs-exit-btn { display: none !important; } }
#map-stage:fullscreen,
#map-stage:-webkit-full-screen { width: 100%; height: 100%; }

.spread-chip { max-width: 100%; }
/* #83 CSS-only inequality sparkline: domain 0→p90 */
.spread-spark { position: relative; width: 100%; height: 8px; margin: 6px 0 4px; border-radius: 999px; background: rgba(var(--v-theme-on-surface), 0.12); }
.spread-spark--dense { height: 6px; margin: 5px 0 3px; }
.spread-spark-range { position: absolute; top: 0; bottom: 0; border-radius: 999px; background: rgba(var(--v-theme-primary), 0.45); }
.spread-spark-tick { position: absolute; top: -2px; bottom: -2px; width: 2px; transform: translateX(-1px); background: rgb(var(--v-theme-primary)); }
</style>

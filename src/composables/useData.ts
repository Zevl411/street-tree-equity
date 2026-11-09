import { ref, shallowRef } from 'vue'
import type { FeatureCollection } from 'geojson'
import { saveLastPack } from '@/utils/offlinePack'
import type { CityManifest, Meta, ParkCollection, TractCollection } from '@/types'

// All data is static JSON shipped with the site. BASE_URL makes it work at "/" (dev, Express)
// and at "/street-tree-equity/" (GitHub Pages project site). Each city in public/cities.json
// has a dataPath (Portland: "data", i.e. public/data/).
export const dataUrl = (file: string, dataPath = 'data') => `${import.meta.env.BASE_URL}${dataPath}/${file}`

async function getJson<T>(url: string, label: string, signal?: AbortSignal, keep?: Response[]): Promise<T> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Failed to load ${label}: HTTP ${res.status}`)
  keep?.push(res.clone())
  return (await res.json()) as T
}

export const loadCities = () => getJson<CityManifest>(`${import.meta.env.BASE_URL}cities.json`, 'cities.json')

export function useData() {
  const meta = ref<Meta | null>(null)
  const tracts = ref<TractCollection | null>(null)
  const parks = ref<ParkCollection | null>(null)
  const roads = ref<FeatureCollection | null>(null)
  // #104: optional mobility overlays (null → switch hidden)
  const bike = shallowRef<FeatureCollection | null>(null)
  const transit = shallowRef<FeatureCollection | null>(null)
  /** #110: OSM mapped sidewalks lines (optional; missing/empty → switch hidden). */
  const sidewalks = shallowRef<FeatureCollection | null>(null)
  // #51: static pack tree points (optional). shallowRef — can be large; never deep-reactive / Pinia.
  const trees = shallowRef<FeatureCollection | null>(null)
  /** #102: OSM school points (optional; missing file → null, Schools switch hidden). */
  const schools = shallowRef<FeatureCollection | null>(null)
  /** #108: OSM library + community_centre points (optional; missing file → null, switch hidden). */
  const libraries = shallowRef<FeatureCollection | null>(null)
  /** #122: OSM garden + allotments points (optional; missing file → null, switch hidden). */
  const gardens = shallowRef<FeatureCollection | null>(null)
  /** #126: OSM drinking-water fountain points (optional; missing file → null, switch hidden). */
  const fountains = shallowRef<FeatureCollection | null>(null)
  /** #128: OSM post office points (optional; missing/empty → null, switch hidden). */
  const postOffices = shallowRef<FeatureCollection | null>(null)
  /** #130: OSM playground points (optional; missing/empty → null, switch hidden). */
  const playgrounds = shallowRef<FeatureCollection | null>(null)
  /** #132: OSM public toilet points (optional; missing/empty → null, switch hidden). */
  const toilets = shallowRef<FeatureCollection | null>(null)
  /** #112: OSM pharmacy + clinic/doctors points (optional; missing/empty → switch hidden). */
  const clinics = shallowRef<FeatureCollection | null>(null)
  /** #116: OSM hospital + fire_station points (optional; missing/empty → switch hidden). */
  const emergency = shallowRef<FeatureCollection | null>(null)
  const loading = ref(true)
  const error = ref<string | null>(null)

  // #61: one controller per load(); a newer load aborts the older so only the latest sets refs/error.
  let controller: AbortController | null = null

  function clearPack() {
    meta.value = null
    tracts.value = null
    parks.value = null
    bike.value = null
    transit.value = null
    sidewalks.value = null
    roads.value = null
    trees.value = null
    schools.value = null
    libraries.value = null
    gardens.value = null
    fountains.value = null
    postOffices.value = null
    playgrounds.value = null
    toilets.value = null
    clinics.value = null
    emergency.value = null
  }

  /** Resolves true when this load won and succeeded. */
  // #94: deferred tree points (mobile). Separate controller so a pack switch aborts an in-flight trees fetch.
  const treesLoading = ref(false)
  /** True once a pack loaded without trees (deferred) and points have not been fetched yet. */
  const treesDeferred = ref(false)
  let treesCtl: AbortController | null = null
  let packPath: string | null = null

  /** #94: fetch trees.geojson for the current pack. Resolves true on success with features. */
  async function loadTrees(): Promise<boolean> {
    if (trees.value) return true
    if (packPath === null || treesLoading.value) return false
    const path = packPath
    treesCtl?.abort()
    const ctl = new AbortController()
    treesCtl = ctl
    treesLoading.value = true
    try {
      const tr = await getJson<FeatureCollection>(dataUrl('trees.geojson', path), 'trees.geojson', ctl.signal)
      if (treesCtl !== ctl || packPath !== path) return false
      if (!tr || !Array.isArray(tr.features) || tr.features.length === 0) return false
      trees.value = tr
      treesDeferred.value = false
      return true
    } catch {
      return false
    } finally {
      if (treesCtl === ctl) {
        treesLoading.value = false
        treesCtl = null
      }
    }
  }

  async function load(dataPath = 'data', opts: { deferTrees?: boolean } = {}): Promise<boolean> {
    treesCtl?.abort()
    treesCtl = null
    treesLoading.value = false
    treesDeferred.value = false
    packPath = null
    controller?.abort()
    const ctl = new AbortController()
    controller = ctl
    const { signal } = ctl
    loading.value = true
    error.value = null
    // Clear the previous city's pack so MapView unmounts (no wrong-city map while loading).
    clearPack()
    const kept: Response[] = []
    const get = <T>(f: string) => getJson<T>(dataUrl(f, dataPath), f, signal, kept)
    try {
      const [m, t, p, r, tr, sc, bk, ts, lb, sw, gd, ft, po, pg, tl, cl, em] = await Promise.all([
        get<Meta>('meta.json'),
        get<TractCollection>('tracts-equity.geojson'),
        get<ParkCollection>('parks.geojson'),
        get<FeatureCollection>('roads-lowtree.geojson').catch(() => null),
        // Missing/invalid trees.geojson is not an error: overlay just hides.
        // #94: on small viewports trees.geojson is not fetched until the user asks.
        opts.deferTrees ? Promise.resolve(null) : get<FeatureCollection>('trees.geojson').catch(() => null),
        get<FeatureCollection>('schools.geojson').catch(() => null),
        get<FeatureCollection>('bike.geojson').catch(() => null),
        get<FeatureCollection>('transit.geojson').catch(() => null),
        get<FeatureCollection>('libraries.geojson').catch(() => null),
        get<FeatureCollection>('sidewalks.geojson').catch(() => null),
        get<FeatureCollection>('gardens.geojson').catch(() => null),
        get<FeatureCollection>('fountains.geojson').catch(() => null),
        get<FeatureCollection>('postoffices.geojson').catch(() => null),
        get<FeatureCollection>('playgrounds.geojson').catch(() => null),
        get<FeatureCollection>('toilets.geojson').catch(() => null),
        get<FeatureCollection>('clinics.geojson').catch(() => null),
        get<FeatureCollection>('emergency.geojson').catch(() => null),
      ])
      if (controller !== ctl) return false
      meta.value = m
      tracts.value = t
      parks.value = p
      roads.value = r
      bike.value = bk && Array.isArray(bk.features) && bk.features.length > 0 ? bk : null
      sidewalks.value = sw && Array.isArray(sw.features) && sw.features.length > 0 ? sw : null
      transit.value = ts && Array.isArray(ts.features) && ts.features.length > 0 ? ts : null
      trees.value = tr && Array.isArray(tr.features) && tr.features.length > 0 ? tr : null
      schools.value = sc && Array.isArray(sc.features) ? sc : null
      libraries.value = lb && Array.isArray(lb.features) && lb.features.length > 0 ? lb : null
      gardens.value = gd && Array.isArray(gd.features) && gd.features.length > 0 ? gd : null
      fountains.value = ft && Array.isArray(ft.features) && ft.features.length > 0 ? ft : null
      postOffices.value = po && Array.isArray(po.features) && po.features.length > 0 ? po : null
      playgrounds.value = pg && Array.isArray(pg.features) && pg.features.length > 0 ? pg : null
      toilets.value = tl && Array.isArray(tl.features) && tl.features.length > 0 ? tl : null
      clinics.value = cl && Array.isArray(cl.features) && cl.features.length > 0 ? cl : null
      emergency.value = em && Array.isArray(em.features) && em.features.length > 0 ? em : null
      packPath = dataPath
      treesDeferred.value = !!opts.deferTrees
      void saveLastPack(kept)
      return true
    } catch (e) {
      if (controller !== ctl || (e instanceof DOMException && e.name === 'AbortError')) return false
      clearPack()
      error.value = e instanceof Error ? e.message : String(e)
      return false
    } finally {
      if (controller === ctl) {
        loading.value = false
        controller = null
      }
    }
  }

  return { meta, schools, libraries, gardens, fountains, postOffices, playgrounds, toilets, clinics, emergency, tracts, parks, roads, bike, transit, sidewalks, trees, loading, error, load, loadTrees, treesLoading, treesDeferred }
}

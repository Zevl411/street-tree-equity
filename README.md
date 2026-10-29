# Street Tree Equity Map 🌳

Choropleth of **OpenStreetMap-mapped trees per acre by U.S. Census tract**, with nearest parks and
“plant here” streets (no mapped tree within 20 m). Demo city: **central Portland, OR**.

- **Frontend:** Vue 3 + Vite + TypeScript + Vuetify 3, MapLibre GL JS
- **Basemap:** Streets = [OpenFreeMap](https://openfreemap.org) (free, no API key, no signup); Satellite = [EOxCloudless 2025](https://cloudless.eox.at) (free, no key, CC BY-NC-SA non-commercial). Toggle in the Layers menu.
- **Dark mode:** header moon/sun toggle (or `d`) saves `ste-theme`; until then the app follows your OS `prefers-color-scheme`. Share links carry `theme=` and apply it on open (saving `ste-theme`) so the recipient sees the sender's theme. Share links use `theme=treeLight` or `theme=treeDark`. Short aliases `theme=light` and `theme=dark` are accepted on open; the address bar updates to the canonical value.
- **Colorblind-safe colors:** Layers switch saves `ste-palette=cb` (Okabe–Ito–ish blues→greens→amber on the Green ramp); High contrast keeps its own colors. Not in share links.
- **Histogram bin:** the selected legend bin is saved per city in `ste-bin` (`{ cityId: index }`); share links carry `bin=`, which applies on open and is saved.
- **Data:** static GeoJSON in `public/data/` built by a Node pipeline from OSM (Overpass) + Census
- **Hosting:** GitHub Pages (demo) or GitLab Pages — static only
- **Optional Node server:** Express serves the build + a read-only JSON API over the same files

## Free forever — how

| Piece | What we use | Why it stays free |
|---|---|---|
| Storage / “database” | Static GeoJSON committed to git (~1.7 MB for the demo) | No DB to pay for. Files are the database. |
| Data sources | OSM via public Overpass API, Census cartographic boundary files | Open data, no keys. Fetched only at build time, cached in `data-raw/`. |
| Basemap tiles | OpenFreeMap vector tiles | Free public instance, no key. Swappable (see below). |
| Hosting | GitHub Pages / GitLab Pages | Free static hosting for public repos. |
| CI | GitHub Actions / GitLab CI | Free tiers; build takes < 1 min. |

**Scaling = smaller or more static files, never paid storage.** For a bigger area: split into one
file per city/county, drop the optional `trees.geojson` / `roads-lowtree.geojson` layers, raise
simplification tolerances, or convert to [PMTiles](https://protomaps.com/docs/pmtiles) (a single static
file that Pages can serve with range requests). GitHub Pages sites have a soft 1 GB limit; the demo uses < 2 MB.

## Quick start

Requires Node 20.19+ (or 22).

```bash
npm install
npm run dev            # Vite dev server at http://localhost:5173 (uses committed public/data)
```

Data is already committed, so the app works right after clone — no network fetch needed
(except basemap tiles in the browser).

### Rebuild the data (optional)

```bash
npm run data           # rebuild public/data from cached raw downloads in data-raw/ (fetches if missing)
npm run data:refresh   # force re-download from Overpass + Census
```

The pipeline (`scripts/build-data.mjs`) takes ~1–2 minutes and is polite to the free Overpass
service (3 queries, cached, retries across mirrors).

### Production build + local Node server

```bash
npm run build          # type-check + build to dist/ (base "/")
npm run serve          # Express: http://localhost:3000/  (API at /api/meta, /api/tracts, /api/tracts/:geoid, /api/parks)
npm run test:smoke     # starts the server and checks the main routes
```

To mimic GitHub Pages locally:

```bash
VITE_BASE=/street-tree-equity/ npm run build
BASE_PATH=/street-tree-equity/ npm run serve   # http://localhost:3000/street-tree-equity/
```

### Local Node server vs. Pages

GitHub Pages and GitLab Pages are **static hosts — they cannot run Node**. In production the app
loads `data/*.geojson` directly from the static site. The Express server (`server/index.mjs`) is
for local use or for self-hosting on any free Node host; it serves the same `dist/` plus a small
read-only API that reads the same JSON files (no database). The frontend never depends on the API,
so the Pages deploy and the Node deploy behave identically.

## Deploy

### GitHub Pages (demo target)

1. Create a GitHub repo (e.g. `street-tree-equity`) and push `main`.
2. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. `.github/workflows/pages.yml` builds with `VITE_BASE=/<repo-name>/` and deploys `dist/`.
   Site: `https://<user>.github.io/<repo-name>/`.
4. To refresh data in CI: **Actions → Deploy to GitHub Pages → Run workflow → refresh_data ✔**.

For a user/org site (`<user>.github.io` repo) or a custom domain, change `VITE_BASE` in the workflow to `/`.

### GitLab Pages

`.gitlab-ci.yml` builds on every push/MR and deploys `dist/` (renamed to `public/`) to GitLab Pages
from the default branch: `https://<namespace>.gitlab.io/<project>/`. It sets
`VITE_BASE=/$CI_PROJECT_NAME/` unless you define a `VITE_BASE` CI/CD variable. Set
`REFRESH_DATA=true` on a manual or scheduled pipeline to re-fetch data.

<a id="add-or-switch-cities"></a>
## Accessibility

Respects the OS “reduce motion” setting: map jumps instead of flying, and UI transitions are shortened.

Print map (browser print) hides chrome and keeps the map, legend, and credits.

Keyboard users can **Skip to map**, operate the Layers presets and switches, and activate plant-here street / park rows from the tract panel (Enter or Space); map exploration itself is pointer-oriented, so use Find tract to pick a tract by keyboard.

## Add or switch cities

Use the place button in the app bar to switch between packaged demo cities listed in
[`public/cities.json`](public/cities.json) (your choice is remembered in `localStorage` as `ste-city`,
and `?city=<id>` links work). The browser never queries Overpass live.

Layer presets — in Layers, one tap on **Equity**, **Plant-here**, or **Parks** sets the layer switches; **Copy link** includes layer visibility via `layers=` (e.g. `layers=trees,parks,bq`; omitted when it matches the default).

Density unit — in Layers, **Per acre** / **Per km²** switches displayed tree density (legend labels, tract details, hint, Compare). Display-only: map colors and breaks stay trees/acre. Remembered in this browser (`localStorage` `ste-density-unit`) and shared via `unit=km2` (omitted for acre).

City overview — with no tract selected, a card (desktop, top-left) or slim strip (mobile, top) summarizes the city: mapped trees, tracts, average density in your chosen unit, and plant-here share, with shortcuts to **Compare cities** and **About**.

Low-canopy hotspots — **Hotspots** on the city overview (or **Low-canopy hotspots** in More) lists the 10 lowest-density tracts in the active city, in your chosen unit; tap one to open it. Share `?hotspots=1` to open the list on load (the flag is dropped after opening).

Cities — the place control lists packaged demos from cities.json only (no map search). Ready packs load immediately; Coming soon rows stay visible but disabled until a data pack is published under data/<city-id>/.

Compare — optionally compare packaged city-level tree stats side by side. Uses the same static open data packs; no account or upload. Open it from **Compare two cities** in the city menu, or share `?compare=idA,idB` (two different ready ids; anything else is ignored).

Find tract — search the open city’s tracts by name or GEOID and jump to one on the map. Runs entirely in your browser.

Plant-here streets — in a tract’s details, see the longest low-tree street segments and zoom to one. Uses the same packaged OSM-derived road data as the orange map layer.

To add a city: edit `city.config.json` (below), run `npm run data:refresh` to build its static files, put them
in a folder under `public/` (e.g. `public/data-seattle/`), and add an entry to `public/cities.json` with
`id`, `cityName`, `subtitle`, `dataPath` (that folder, relative to the site root) and `bbox`.
Portland uses `"dataPath": "data"`.

Or build one in CI (no local Overpass): **Actions → City pack → Run workflow**, fill `cityId`, `cityName`, `subtitle`, `bbox` (W,S,E,N), `stateFips`, `countyFips` (optional `censusYear`). It runs `scripts/build-city-pack.mjs` (same `data:refresh` path), writes `public/data/<cityId>/`, uploads it as an artifact, and with `open_pr` (default on) opens/updates a `pack/<cityId>` PR with the pack and a ready `cities.json` entry. Size: warn > 5 MB, fail > 15 MB.

### Restore last session (#44)

Reloading brings back your last city, basemap, density unit, tract fill opacity, theme, map camera and selected tract,
all from browser `localStorage` (`ste-city`, `ste-basemap`, `ste-density-unit`, `ste-theme`, `ste-fill-opacity` (tract fill opacity, 0.3–1), `ste-legend-open` (legend open/collapsed; default collapsed on phones, expanded on desktop), and
`ste-view` = `{ cityId, lng, lat, zoom, geoid }`). Precedence per field: a valid URL param wins,
then storage (only for ready packs; stale or coming-soon ids are ignored), then defaults. A URL
`geoid` owns the camera; a stored camera is only used when its `cityId` matches the shown city.
Layer switches are not persisted (URL `layers=` only).

Share links (#70) also carry `hc=1` for the high-contrast ramp (omitted for the default green; `ste-choropleth` stays the offline fallback) and `legend=0|1` when you've explicitly collapsed/expanded the legend. URL wins over stored prefs on load; unknown params are ignored.

## Change the city / bbox

Edit `city.config.json`:

```jsonc
{
  "cityName": "Portland, OR",
  "subtitle": "Central Portland",
  "bbox": [-122.75, 45.47, -122.58, 45.57],   // [west, south, east, north]
  "stateFips": "41",                            // 2-digit state FIPS (Oregon = 41)
  "countyFips": ["051"],                        // county filter (Multnomah); [] = any county
  "censusYear": 2023,                           // Census cartographic boundary vintage
  "roadsLowTree": { "enabled": true, "bufferMeters": 20, "minLengthMeters": 120, ... }
}
```

Then run `npm run data:refresh` and commit `public/data/`. Tracts are selected by centroid inside
the bbox; OSM is queried over the full extent of those tracts so edge tracts are counted completely.
Keep the bbox city-district sized — Overpass is a shared free service and may time out (HTTP 429/504)
on very large areas. Disable `roadsLowTree` for faster runs/smaller output.

Basemap: set `VITE_BASEMAP_STYLE` to any MapLibre style URL that needs no key (default
`https://tiles.openfreemap.org/styles/positron`; `liberty` and `bright` also work). If set, it is used for Streets in both themes — the dark-mode toggle won't swap it. Satellite always uses EOxCloudless 2025 (no key); if its tiles fail, the app falls back to Streets.

Dark mode — header toggle; preference saved in the browser; streets basemap uses OpenFreeMap Dark (no API key).

## How the numbers are computed

- **Trees:** OSM nodes tagged `natural=tree`, point-in-polygon joined to tracts (turf.js).
- **Area:** Census `ALAND` (land area, excludes water) → acres and km².
- **Trees/acre:** `treeCount / landAcres`; map classes are quantile breaks (5 classes) stored in `meta.json`.
- **Bottom quartile:** tracts at or below the 25th percentile of trees/acre (toggle the outline in Layers).
- **Nearest parks:** OSM `leisure=park` polygons, distance from tract centroid to a point on each park.
- **“Plant here” streets:** OSM `highway=primary|secondary|tertiary|residential|living_street` ways with
  no mapped tree within 20 m (segments ≥ 120 m are drawn; all are counted in the % metric).

⚠️ **Caveat:** OSM tree coverage is uneven — a low number may mean “not mapped yet” rather than “no
trees.” Treat it as a conversation starter, and add trees to OSM to improve it. A city’s own open
street-tree inventory (e.g. Portland’s Street Tree Inventory open data) could be swapped in as the
tree source for official coverage.

## Project layout

```
city.config.json          # demo city, bbox, Census FIPS, Overpass mirrors
scripts/build-data.mjs    # Node data pipeline (npm run data)
scripts/lib/              # Overpass/Census fetch + geo helpers
scripts/smoke-test.mjs    # server smoke test
public/data/              # generated static data (committed)
server/index.mjs          # optional Express server + read-only API
src/                      # Vue 3 + Vuetify app (App.vue, components/MapView.vue, ...)
.github/workflows/pages.yml
.gitlab-ci.yml
```

## Attribution & licenses

- Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the
  Open Database License (ODbL). Derived files in `public/data/` (trees, parks, roads, counts) are ODbL.
- Census tract boundaries: U.S. Census Bureau cartographic boundary files (public domain).
- Basemap: [OpenFreeMap](https://openfreemap.org) · © [OpenMapTiles](https://www.openmaptiles.org/) · data © OpenStreetMap contributors.
- Satellite: [EOxCloudless](https://cloudless.eox.at) by EOX IT Services GmbH — contains modified Copernicus Sentinel data 2025 · CC BY-NC-SA (non-commercial).
- Code: MIT.

## TypeScript only

App code under `src/` is TypeScript only (`.ts` / `.vue` with `<script setup lang="ts">`); no `.js` files. `tsconfig.json` runs in `strict` mode and CI fails on any JavaScript under `src/` and on `npm run typecheck` (`vue-tsc`) errors. Node tooling in `scripts/` and `server/` may stay `.mjs`.

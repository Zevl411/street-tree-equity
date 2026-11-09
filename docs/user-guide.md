# Street Tree Equity Map — User guide

_Last updated 2026-11-09_

## What this map shows

Tree canopy is the default map: the estimated percentage of each tract's non-water land covered by trees, from USFS/NLCD Tree Canopy Cover 2025 (v2025.6, 30 m). Annual NLCD Land Cover 2025 (Collection 1.2) supplies the open-water mask. These satellite-based estimates can miss small or scattered urban canopy and are not exact sidewalk-shade measurements. Mapped street trees (OSM) is still available separately; a zero mapped count can mean missing mapping, not no trees. Planting need now uses canopy cover, so scores may change even where no new planting occurred.

Use it as a conversation starter about where shade and greenery are missing, not as an official tree inventory. The app only covers cities that have been packaged ahead of time. It does not search the whole country live.

## Pick a city

Use the city picker in the header to switch cities. Only packaged cities appear in the list. If your city is not there, it has not been built yet.

## Read the map

Each tract is shaded green: darker green means a higher estimated tree-canopy share on the default map (classes are relative within each city pack). The legend shows which shade matches which range.

Open the Layers menu to change the basemap:

- **Streets** — a street map from OpenFreeMap.
- **Satellite** — cloud-free imagery from EOxCloudless.

In the same menu you can turn on or off the tree points, parks, and "plant here" streets (street segments with no mapped tree nearby).

## City overview

The overview panel sums up the whole city:

- Mapped OSM trees, number of tracts, and the active metric’s pack aggregate.
- **Spread** — the range from the 10th to the 90th percentile tract, so you can see how uneven the city is.
- An inequality sparkline showing how density is distributed across tracts.
- On the mapped street-tree metric only, a desktop scatter of OSM density against tract area. Tracts with no mapped trees are included.
- A histogram of tract density. Click a bar to filter the map to that range; click again to clear it.
- An option to highlight tracts below the city median.

## Find and save tracts

Click any tract to open its details, including its density and nearby parks.

Use search (`/`) to find a tract by name or GEOID. Star a tract to save it as a favorite, or press `*` while a tract is selected.

Turn on hotspots (`h`) to call out the lowest-density areas. Press `n` and `p` to jump to the next or previous below-median tract.

## Share and export

Copy the share link to send someone exactly what you see. The link keeps your theme, layers, and filters.

You can export the selected tract, or all tracts, as a CSV file for use in a spreadsheet.

To export just what the map is showing, choose **CSV – current view** in the tract **Download…** menu or under **Export…** in Layers. It has every tract in the city with `canopy_pct` (estimated percent of non-water land), separate `mapped_street_trees` / `mapped_street_trees_unit` OSM density, and the active metric, or both metrics in dual view. In Compare cities, **CSV – compare view** exports both cities. These files start with a few lines beginning with `#` that list the city, metric, data sources and share link. Skip rows starting with `#`; the header row is the first non-comment line.

Missing canopy is not zero. Tracts with at least 99% open water display “Mostly water — no canopy estimate”; their exported canopy cells are blank. Full CSV/GeoJSON append `canopy_pct`, retain OSM counts/densities, and rename `plant_need_trees` to `plant_need_canopy` (the relative canopy-gap component). The current-view OSM density pair was previously named `canopy,canopy_unit`; only the headings change for those OSM values.

Old explicit `metric=trees` links still open mapped street trees (OSM); links without a metric now open Tree canopy. Canopy percentages do not change with acre/km² display preferences.

## Keyboard

Press `?` in the app for the full shortcut list. The main ones:

| Key | Action |
|---|---|
| `/` | Search tracts |
| `d` | Toggle dark mode |
| `s` | Switch Streets / Satellite |
| `h` | Toggle hotspots |
| `*` | Star the selected tract |
| `n` / `p` | Next / previous below-median tract |
| `f` | Toggle full screen |
| `?` | Show shortcuts |

## About and data

Open the About dialog for data sources, citations, and build details. It also has **Reset preferences**, which clears your saved theme, colors, and other settings in this browser.

Canopy: [USFS/NLCD TCC](https://data.fs.usda.gov/geodata/rastergateway/treecanopycover/) 2025 v2025.6; water mask: [USGS Annual NLCD](https://doi.org/10.5066/P143HE8T) 2025 Collection 1.2, class 11. Both inputs are CC0 public-domain data. Map data © OpenStreetMap contributors (ODbL). Tract boundaries: U.S. Census Bureau. Streets basemap: OpenFreeMap. Satellite: EOxCloudless (CC BY-NC-SA, non-commercial). The app is free forever: no accounts, no keys, no paid services.

## Limits

- **OSM is incomplete.** Low density can mean few trees, or simply that nobody has mapped them yet.
- **Satellite imagery is non-commercial only** under its CC BY-NC-SA license.
- **Data is not live.** The browser never queries OSM (Overpass) directly; each city pack is built ahead of time, so recent changes to OSM will not appear until the pack is rebuilt.

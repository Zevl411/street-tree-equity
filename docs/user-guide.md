# Street Tree Equity Map — User guide

_Last updated 2026-10-29_

## What this map shows

The map shows how many trees are mapped per acre in each U.S. Census tract. Tree locations come from OpenStreetMap (OSM), a volunteer-built map, and tract boundaries come from the U.S. Census Bureau.

Use it as a conversation starter about where shade and greenery are missing, not as an official tree inventory. The app only covers cities that have been packaged ahead of time. It does not search the whole country live.

## Pick a city

Use the city picker in the header to switch cities. Only packaged cities appear in the list. If your city is not there, it has not been built yet.

## Read the map

Each tract is shaded green: darker green means more mapped trees per acre. The legend shows which shade matches which range.

Open the Layers menu to change the basemap:

- **Streets** — a street map from OpenFreeMap.
- **Satellite** — cloud-free imagery from EOxCloudless.

In the same menu you can turn on or off the tree points, parks, and "plant here" streets (street segments with no mapped tree nearby).

## City overview

The overview panel sums up the whole city:

- Total trees, number of tracts, and the average trees per acre.
- **Spread** — the range from the 10th to the 90th percentile tract, so you can see how uneven the city is.
- An inequality sparkline showing how density is distributed across tracts.
- On desktop, a scatter of density against tract area. Tracts with no mapped trees are included.
- A histogram of tract density. Click a bar to filter the map to that range; click again to clear it.
- An option to highlight tracts below the city median.

## Find and save tracts

Click any tract to open its details, including its density and nearby parks.

Use search (`/`) to find a tract by name or GEOID. Star a tract to save it as a favorite, or press `*` while a tract is selected.

Turn on hotspots (`h`) to call out the lowest-density areas. Press `n` and `p` to jump to the next or previous below-median tract.

## Share and export

Copy the share link to send someone exactly what you see. The link keeps your theme, layers, and filters.

You can export the selected tract, or all tracts, as a CSV file for use in a spreadsheet.

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

Map data © OpenStreetMap contributors (ODbL). Tract boundaries: U.S. Census Bureau. Streets basemap: OpenFreeMap. Satellite: EOxCloudless (CC BY-NC-SA, non-commercial). The app is free forever: no accounts, no keys, no paid services.

## Limits

- **OSM is incomplete.** Low density can mean few trees, or simply that nobody has mapped them yet.
- **Satellite imagery is non-commercial only** under its CC BY-NC-SA license.
- **Data is not live.** The browser never queries OSM (Overpass) directly; each city pack is built ahead of time, so recent changes to OSM will not appear until the pack is rebuilt.

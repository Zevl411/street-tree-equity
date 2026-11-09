# Invent #151 — GHLTH data preparation only

Base: `759775005e2819d4053b12c98e33a2abfaaae0e4` (#150 squash). Branch: `feat/general-health-151`. No new GHLTH UI is enabled before Designer lock; no push or PR in this phase.

## Source, method and coverage

- CDC PLACES 2025 GIS-friendly tract source `yjkw-uj5s`, crude `ghlth_crudeprev`, CI `ghlth_crude95ci`, adult-18+ Census-2020 weight `totalpop18plus`. The official long-format title is “Fair or poor self-rated health status among adults”; long-format data was used only for independent verification, never the join.
- `resolvePlacesMeasureYear` fetched the existing Socrata column metadata endpoint. Its value description is “Model-based estimate for crude prevalence of fair or poor health among adults, 2023”. All seven packs have `meta.cdcPlaces.years.GHLTH=2023`; no `dataYear` or guessed year.
- Seven independent existing-reader joins: `PLACES_MEASURES=GHLTH PLACES_CSV=data-raw/cdc-places/ghlth151-tracts.csv node scripts/add-cdc-places.mjs <pack>`. The small same-dataset GIS-friendly extract contains exactly the 464 needed GEOIDs. Raw CSV/JSON/metadata remain ignored under `data-raw/cdc-places/`.
- `places.mjs` already handles the new columns case-insensitively and padded/quoted CIs; it needs no change or second reader. New tests exercise it directly. Missing/invalid GHLTH coverage stops before a pack write; no fallback.

| Pack | Value/CI/positive-weight coverage | Breaks (%) | Weighted overall (%) | Tract delta | Meta delta |
|---|---:|---|---:|---:|---:|
| public/data | 98/98 | [10.2, 12, 13.2, 15.3] | 14.1 | +10,218 B | +187 B |
| public/data/central-miami-fl | 152/152 | [7.5, 17.4, 26.8, 33.2] | 26 | +15,840 B | +186 B |
| public/data/melbourne-fl | 19/19 | [13.9, 15.4, 18.1, 23.2] | 19 | +1,975 B | +187 B |
| public/data/pembroke-pines-fl | 50/50 | [13.6, 14.8, 16.2, 19.6] | 18.1 | +5,214 B | +189 B |
| public/data/orlando-fl | 43/43 | [9.1, 12.9, 17.1, 27.6] | 20 | +4,483 B | +186 B |
| public/data/tampa-fl | 60/60 | [8.7, 15.8, 25.5, 30.7] | 22.7 | +6,254 B | +188 B |
| public/data/central-jacksonville-fl | 42/42 | [10.8, 18.1, 24.8, 38.3] | 27.4 | +4,374 B | +189 B |

**Coverage: 464/464 values, parseable CIs, positive weights.**

## Three independently fetched direct Socrata checks

| GEOID | Crude % | 95% CI | Adult weight |
|---|---:|---|---:|
| 12086002404 | 44.8 | 39.2–50.7 | 4491 |
| 41051003100 | 12.0 | 10.4–13.9 | 3962 |
| 12009064400 | 18.1 | 15.5–21.0 | 4090 |

Each was independently requested from `https://data.cdc.gov/resource/yjkw-uj5s.json` with its GEOID and the four source fields, then matched to the pack. The Miami long-format cross-check also reports GHLTH/CrudePrev/year2023 and 44.8 (39.2–50.7). Small normalized expected facts and original-file hashes are committed, not raw source downloads.

## Byte-level diff, exports and sizes

- Removing exactly `pctGeneralHealth`, `pctGeneralHealthLo`, `pctGeneralHealthHi`, `generalHealthAdultPop` reproduces every old tract file byte-for-byte against main7597750. **0 geometry changes; 0 old-property changes.** This includes depression, all earlier PLACES, canopy/landAcres/gap and Planting need values, precision, property/feature order. Removing only new GHLTH metadata also reproduces the original metadata bytes.
- Full CSV **106→109**. Shared `PLACES_EXPORT` appends `pct_general_health`, `pct_general_health_ci_lo`, `pct_general_health_ci_hi` after depression, columns88–90. Existing106 headers retain relative order. Tests cover all464 rows under both canopy targets, null/zero and GeoJSON numeric/null triple parity. `CI_KEYS` and the raw value-key type are prepared without exposing a new metric option.
- Tracts **+48,358 B**; metadata **+1,312 B**; combined **+49,670 B**. Largest changed tract file: Miami **629,455 B**, below1 MiB. Existing warn>1 MiB/fail>3 MiB guard is unchanged; only pre-existing overlay warnings.

## Authorized softs

- `HotspotsPanel.vue`: generic static `text-wrap` on the heading, replacing the depression-only conditional. No control/container/focus changes.
- Snapshot a11y full-CSV log derives its column count from `full[0].length` (and row count from the parsed download), rather than stale103. A source regression test protects both softs.

## Checks

- Typecheck, build, unit **171/171**, smoke **7/7**, sizes and dedicated size guard **4/4** pass. Browser regression suites for the two softs are recorded in the final handoff.
- New tests use small committed fixtures and `os.tmpdir()`, with explicit fixture year override, no raw cache/network/Python at test time. Historical fingerprints remain pinned; only later additive GHLTH fields are stripped in older tests.

## UI still pending Designer lock

- `generalHealth` registry definition (`higherIsBetter:false`) and switch option next to PHLTH, exact label/tooltip/legend/Hotspots/missing copy, precision and aliases; do not invent a side/order or strings.
- TractDetails row/caption, About/Copy-citations methods/What changed and user docs according to the locked sheet.
- Snapshot allowlist/rankable integration (next to PHLTH per TL) and corresponding25-candidate/UI/a11y checks; GHLTH was **not** added to exclusions. Existing24-candidate ranking is unchanged during data prep.
- Current-view selectable-metric/deep-link/alias integration and locked source-topic/citation copy. Full data exports/CI/year plumbing are already ready.
- `PLACES_DATA_IDS` contains all16 prepared measures in the single map; `PLACES_METRIC_IDS` derives only the15 registered metrics. This keeps App/About/Copy/snapshot UI unchanged without a duplicate source map. Registering the metric after lock will include it automatically. `App.vue`, `TractDetails.vue`, and `tractSnapshot.ts` remain byte-identical to main.

# Invent #151 — GHLTH verification

Base: `759775005e2819d4053b12c98e33a2abfaaae0e4` (#150 squash). Branch: `feat/general-health-151`. Data preparation was committed as `7fe727d` before the Designer lock. The following UI integration follows LOCKED rev1.1 exactly.

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
- Full CSV **106→109**. Shared `PLACES_EXPORT` appends `pct_general_health`, `pct_general_health_ci_lo`, `pct_general_health_ci_hi` after depression, columns88–90. Existing106 headers retain relative order. Tests cover all464 rows under both canopy targets, null/zero and GeoJSON numeric/null triple parity. `CI_KEYS` and the raw value-key type include the new measure.
- Tracts **+48,358 B**; metadata **+1,312 B**; combined **+49,670 B**. Largest changed tract file: Miami **629,455 B**, below1 MiB. Existing warn>1 MiB/fail>3 MiB guard is unchanged; only pre-existing overlay warnings.

## Authorized softs

- `HotspotsPanel.vue`: generic `hotspots-heading text-wrap`, shrinkable noninteractive text span and scoped wrapping CSS; the original spacer and same close button/attributes/handler/order remain. No control/container/focus changes. Runtime longest-six-title union tests include GHLTH, depression, uninsured, disability and shortSleep, plus an unbroken controlled string.
- Thin pure `fullCsvHeaders()` returns the same `CSV_HEADERS` array. Snapshot and gap a11y assertions/captions use `fullCsvHeaders().length`, not103/106/109 literals; both retain complete parsed source-cell equality. The independent unit contract still pins109 and exact column positions/old-header order.

## Checks

- Typecheck, build, unit **178/178**, smoke **7/7**, sizes and dedicated size guard **4/4** pass. Menu a11y **100/100**, snapshot a11y **239/239**, and gap/GHLTH/generic-heading a11y **296/296** pass.
- New tests use small committed fixtures and `os.tmpdir()`, with explicit fixture year override, no raw cache/network/Python at test time. Historical fingerprints remain pinned; only later additive GHLTH fields are stripped in older tests.

## Designer LOCKED rev1.1 UI integration

- Full32-option switch order is unchanged except the new `generalHealth` immediately after PHLTH/before bphigh. Registry/source/export append order stays after depression. `higherIsBetter:false`, 0–100 percent points/one decimal, no density conversion; all strings/flags match the sheet. No new layer token, interaction or composite. Canopy remains the default.
- Exact finite/zero/null/CI-missing details row and always-readable self-rated/PHLTH caption; only the new row opts out of legacy subheader ellipsis. Old PHLTH/MHLTH/DEPRESSION rows and meanings are unchanged. Source citation year is meta-driven; exact shared GHLTH methods note is gated and reused by About/Copy citations. What changed and both user docs use the locked wording.
- Shared map now has16 registered measures; temporary data-only type/filter plumbing was removed. Exact canonical/spaced/mixed-case aliases are tested; `health`/`poor health` are not aliases, and old physical/mental/depression links retain their meanings. Single/dual URL writers preserve unrelated flags and canopy targets.
- Snapshot25 candidates, same7 exclusions, only explicit allowlist/label/count-comment changes. Label is `Fair or poor health (self-rated)`. Miami check n152/B151/T0/X100 gives the exact all151 helper; its actual top3 remain Income/Diabetes/Physical health. A real GHLTH winning tract is used for keyboard/SR/same-focus/dual-text regression. No weighting or significance claim in rankings.
- Current-view CSV16/18(single/compare),22/24(dual/dual-income), with compare adding2; both group directions, units, targets, zero/null, raw CI and dynamic year are tested. Full109-column and numeric/null GeoJSON tests cover all464 tracts and preserve all106 old headers.
- No edits to Dev2's shared Layers/menu/dual/Compare/focus containers or handlers. Branch remains `feat/general-health-151` per the explicit setup, not the sheet's suggested branch name. No raw files, new dependencies, runtime CDC calls or paid services.

Fresh-clone exact-head verification is recorded in the final handoff and PR body. Screenshots are on the shared box at `/tmp/ste-ghlth151-shots/`, including GHLTH details at 390px/desktop in light/dark/high contrast, and the longest legacy and GHLTH Hotspots titles at 390px light/dark.

# Invent #150 — DEPRESSION verification

Base: `6e0996dcc80e11c786a7cee249e92f5052c753a6` (#149 squash). Data preparation was committed locally first, then Designer LOCKED rev 1 authorized the narrow UI integration below.

## Source and method

- CDC PLACES 2025 release, GIS-friendly tract dataset `yjkw-uj5s`: <https://data.cdc.gov/resource/yjkw-uj5s.json>. Only the 464 pack GEOIDs and `tractfips`, `depression_crudeprev`, `depression_crude95ci`, `totalpop18plus` were requested; raw responses/CSV are git-ignored under `data-raw/cdc-places/`.
- `resolvePlacesMeasureYear` reads <https://data.cdc.gov/api/views/yjkw-uj5s/columns.json>. `depression_crudeprev` description: “Model-based estimate for crude prevalence of depression among adults, 2023”. The BRFSS year is **2023**, recorded as `meta.cdcPlaces.years.DEPRESSION`; `dataYear` is not introduced.
- Each pack was joined independently through `add:places` / the existing generic `places.mjs` reader. `PLACES_MEASURES=DEPRESSION` selects the incremental backfill so older properties are never deleted/reinserted or recomputed. Example: `PLACES_MEASURES=DEPRESSION PLACES_CSV=data-raw/cdc-places/depression150-tracts.csv npm run add:places -- public/data/central-miami-fl`.
- New fields: `pctDepression`, `pctDepressionLo`, `pctDepressionHi`, `depressionAdultPop`. Crude prevalence is already 0–100; CIs are parsed from the source. Pack mean uses adults-18+ weights; median and density breaks use the existing pipeline.
- The locked rev 1 correction appends DEPRESSION after ACCESS2 in data/shared-map order; the later switch order places it after MHLTH. Prepared polarity is `higherIsBetter:false`. DEPRESSION is ever-diagnosed depression, distinct from MHLTH frequent mental distress; all user-facing wording follows Designer LOCKED rev 1.

## Coverage and directly verified check tract

| Pack | Coverage | Tract size delta | Metadata delta |
|---|---:|---:|---:|
| public/data/central-jacksonville-fl | 42/42 | +3,882 B | +194 B |
| public/data/central-miami-fl | 152/152 | +14,032 B | +192 B |
| public/data/melbourne-fl | 19/19 | +1,765 B | +194 B |
| public/data/orlando-fl | 43/43 | +3,959 B | +194 B |
| public/data/pembroke-pines-fl | 50/50 | +4,621 B | +194 B |
| public/data/tampa-fl | 60/60 | +5,538 B | +194 B |
| public/data | 98/98 | +9,061 B | +194 B |

**Total: 464/464 values and confidence intervals.** Tract `12086002404`: **14.1%**, 95% CI **11.8–16.4%**, adult-population weight **4,491**.

Independent direct check: <https://data.cdc.gov/resource/yjkw-uj5s.json?$select=tractfips,depression_crudeprev,depression_crude95ci,totalpop18plus&$where=tractfips=%2712086002404%27>. Small normalized numeric regression expectations and main-baseline fingerprints are committed in `tests/fixtures/depression150-baseline.json`, not the raw download.

## Diff, CSV and size verification

- Across all seven packs: **0 geometry changes, 0 changes to any existing tract property**. Removing the four new fields reproduces the exact canonical JSON SHA-256 of main `6e0996d`, including numeric precision and property order. Existing canopy, landAcres, canopy-gap inputs, Planting need fields/formula and protected canopy/gap metadata are unchanged.
- Full CSV: **106 unique columns**, with `pct_depression`, `pct_depression_ci_lo`, `pct_depression_ci_hi` after uninsured (columns 85–87). All previous 103 headers retain relative order. Header/cell parity and every tract value/CI are tested for both gap targets. `CI_KEYS` covers the active current-view metric. This supersedes the original single-column/104 instruction.
- Tracts: **+42,858 bytes**. Metadata: **+1,356 bytes**. Combined: **+44,214 bytes**. Largest changed tract file: Central Miami, **613,615 bytes**, below 1 MB. Existing size thresholds remain warn above 1 MB / fail above 3 MB.

## Checks

- `npm run typecheck`, `npm run test:unit` (**153/153**), `npm run build`, `npm run report:sizes`.
- Browser suites: menu **100/100**, snapshot **239/239**, gap + depression **168/168**. Six desktop/mobile light/dark/high-contrast screenshots were captured outside git and inspected; the new row/caption wrap without clipping. The dedicated size-guard suite passes **4/4**.
- Regression fixtures use `os.tmpdir()` and committed small fixtures; tests/build do not need `data-raw`, source access, or Python. Missing DEPRESSION coverage fails before any pack is written; an unknown selective measure is also rejected. GHLTH is never selected automatically.

## Locked rev 1 UI integration

- Registry append order is preserved: depression after uninsured. The 31-option switch places Depression history immediately after Mental health, before Physical health. Canonical/soft aliases follow the sheet; existing MHLTH links remain unchanged and `depressed` is not an alias. Canopy stays the default.
- Verbatim lifetime-history detail row/caption, registry tooltip/legend/Hotspots copy, shared citation/methods note, What changed paragraph and user documentation are present. The new detail row alone opts out of Vuetify subheader ellipsis so the full value/CI/model text wraps at 390px; older rows/styles are untouched. A single depression-only `text-wrap` class on the existing Hotspots heading satisfies the sheet’s long-title wrapping requirement without changing its container, controls or focus behavior.
- Snapshot has 24 candidates and the same seven exclusions; math/focus handlers are unchanged. Miami 12086002404 DEPRESSION score independently verifies n=152, B=85, T=0, higher=66, raw X=56.29139072847682. Its original top three remain Income, Diabetes, Physical health; depression is not forced into the shortlist. Historical #147 fixture tests intentionally retain their pre-DEPRESSION candidate set; new #150 tests cover the 24-candidate set.
- Full CSV is 106 columns, with depression at columns 85–87. GeoJSON exports the numeric/null triple. Current-view tests cover 16 single / 18 compare-single / 22 dual / 24 dual-with-income columns, both units, both canopy targets, missing/zero values and source-year substitution. The methods note is shared by About and Copy citations.
- No changes to Dev2's shared menu/focus/dual/Compare containers. Branch remains `feat/depression-150` per the explicit setup request (the sheet's suggested branch name differs).
- Build input was a small extract of the same GIS-friendly Socrata source via the existing PLACES_CSV override, not long-format data or a new source. Seven incremental joins preserve all older numeric properties and their order. Source-column join/adult-population casing in metadata reflects the extract headers; all previous measure-column mappings remain present.

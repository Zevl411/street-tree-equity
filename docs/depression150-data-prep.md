# Invent #150 — DEPRESSION data preparation only

Base: `6e0996dcc80e11c786a7cee249e92f5052c753a6` (#149 squash). No push or PR in this phase. No App/component/UI-copy or rendered switch-order changes.

## Source and method

- CDC PLACES 2025 release, GIS-friendly tract dataset `yjkw-uj5s`: <https://data.cdc.gov/resource/yjkw-uj5s.json>. Only the 464 pack GEOIDs and `tractfips`, `depression_crudeprev`, `depression_crude95ci`, `totalpop18plus` were requested; raw responses/CSV are git-ignored under `data-raw/cdc-places/`.
- `resolvePlacesMeasureYear` reads <https://data.cdc.gov/api/views/yjkw-uj5s/columns.json>. `depression_crudeprev` description: “Model-based estimate for crude prevalence of depression among adults, 2023”. The BRFSS year is **2023**, recorded as `meta.cdcPlaces.years.DEPRESSION`; `dataYear` is not introduced.
- Each pack was joined independently through `add:places` / the existing generic `places.mjs` reader. `PLACES_MEASURES=DEPRESSION` selects the incremental backfill so older properties are never deleted/reinserted or recomputed. Example: `PLACES_MEASURES=DEPRESSION PLACES_CSV=data-raw/cdc-places/depression150-tracts.csv npm run add:places -- public/data/central-miami-fl`.
- New fields: `pctDepression`, `pctDepressionLo`, `pctDepressionHi`, `depressionAdultPop`. Crude prevalence is already 0–100; CIs are parsed from the source. Pack mean uses adults-18+ weights; median and density breaks use the existing pipeline.
- The locked rev 1 correction appends DEPRESSION after ACCESS2 in data/shared-map order; the later switch order places it after MHLTH. Prepared polarity is `higherIsBetter:false`. DEPRESSION is ever-diagnosed depression, distinct from MHLTH frequent mental distress; final user-facing wording awaits Designer lock.

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

Independent direct check: <https://data.cdc.gov/resource/yjkw-uj5s.json?$select=tractfips,depression_crudeprev,depression_crude95ci,totalpop18plus&$where=tractfips=%2712086002404%27>. A small checked source row/column description and main-baseline fingerprints are committed in `tests/fixtures/depression150-baseline.json`, not the raw download.

## Diff, CSV and size verification

- Across all seven packs: **0 geometry changes, 0 changes to any existing tract property**. Removing the four new fields reproduces the exact canonical JSON SHA-256 of main `6e0996d`, including numeric precision and property order. Existing canopy, landAcres, canopy-gap inputs, Planting need fields/formula and protected canopy/gap metadata are unchanged.
- Full CSV: **106 unique columns**, with `pct_depression`, `pct_depression_ci_lo`, `pct_depression_ci_hi` after uninsured (columns 85–87). All previous 103 headers retain relative order. Header/cell parity and every tract value/CI are tested for both gap targets. `CI_KEYS` is prepared for the later current-view metric activation. This supersedes the original single-column/104 instruction.
- Tracts: **+42,858 bytes**. Metadata: **+1,356 bytes**. Combined: **+44,214 bytes**. Largest changed tract file: Central Miami, **613,615 bytes**, below 1 MB. Existing size thresholds remain warn above 1 MB / fail above 3 MB.

## Checks

- `npm run typecheck`, `npm run test:unit` (**146/146**), `npm run build`, `npm run report:sizes`.
- Regression fixtures use `os.tmpdir()` and committed small fixtures; tests/build do not need `data-raw`, source access, or Python. Missing DEPRESSION coverage fails before any pack is written; an unknown selective measure is also rejected. GHLTH is never selected automatically.

## Pending Designer lock — deliberately not activated

- Registry `MetricId`/`METRICS` entry, final labels/aliases/tooltips/legend/Hotspots/median copy, and rendered switch insertion after mentalHealth. Existing switch-order tests remain unchanged.
- TractDetails row/value/CI display and approved About/source/citation wording; the shared data entry is not yet exposed to registered-metric UI consumers.
- Snapshot activation and resulting rank/check-value updates: the allowlist already prepares `depression`, and it is not excluded, but the 23 active candidates remain unchanged until the Designer-approved registry/switch order exists.
- Current-view/dual/Compare/export and URL UI activation, then their final integration/a11y checks. No component or App.vue UI work is included in this data-only commit.

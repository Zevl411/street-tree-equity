/** #148 metadata-resolved source copy, shared by About, citations and every current-view export. */
import type { Meta, TractProps } from '@/types'
export const CANOPY_URL = 'https://data.fs.usda.gov/geodata/rastergateway/treecanopycover/'
export const WATER_URL = 'https://doi.org/10.5066/P143HE8T'
export const CC0_URL = 'https://creativecommons.org/public-domain/cc0/'
export const USFS_REFERENCE = 'USDA Forest Service. 2026. USFS NLCD Percent Tree Canopy CONUS v2025-6. Salt Lake City, UT.'
export const USGS_REFERENCE = 'U.S. Geological Survey (USGS), 2024, Annual NLCD Collection 1 Science Products: U.S. Geological Survey data release, https://doi.org/10.5066/P94UXNTS'
export const USFS_CREDIT = 'Funding for this project was provided by the U.S. Forest Service (USFS). The TCC data products are developed and maintained by the USDA Forest Service through integrated teams and support from the Geospatial Office and Research and Development - Forest Inventory and Analysis.'
export const OSM_COVERAGE_NOTE = 'Counts street trees mapped in OpenStreetMap. Coverage varies by city; zero can mean unmapped, not treeless.'
export function canopyCitationParts(meta?: Pick<Meta, 'canopy'> | null) {
  const c=meta?.canopy, w=c?.waterMask
  return {
    tcc: `Tree canopy (tract) — USDA Forest Service, USFS NLCD Percent Tree Canopy CONUS${c?.version ? ` v${c.version.replace('.', '-')}` : ''}${c?.vintage ? `, ${c.vintage} map year` : ''}${c?.resolution ? `, ${c.resolution} m` : ''}. Zonal mean over non-water land; satellite-based model estimates, not a street-tree inventory.`,
    mask: `U.S. Geological Survey, Annual NLCD${w?.collection ? ` Collection ${w.collection}` : ''} Land Cover${w?.vintage ? `, ${w.vintage} map year` : ''}${w?.waterClass != null ? `, class ${w.waterClass} (Open Water)` : ''}.`,
    references: `${USFS_REFERENCE} ${USGS_REFERENCE}`,
  }
}
export function canopyCitation(meta?: Pick<Meta,'canopy'> | null): string {
  const p=canopyCitationParts(meta)
  return `${p.tcc} Water mask: ${p.mask} Both source datasets are CC0 public-domain data. ${p.references}`
}
export function canopyTooltip(meta?: Pick<Meta,'canopy'> | null): string {
  const c=meta?.canopy,w=c?.waterMask
  return `Share of each tract's land area under tree canopy, excluding open water (USFS/NLCD Tree Canopy Cover${c?.vintage ? `, ${c.vintage}` : ''}${c?.version ? `, v${c.version}` : ''}). Satellite-based model estimates from Landsat and Sentinel-2${c?.resolution ? ` at ${c.resolution} m resolution` : ''}; small or scattered urban canopy can be underestimated. Not a street-tree count or a direct measure of sidewalk shade. Open water is masked using Annual NLCD Land Cover${w?.vintage ? ` ${w.vintage}` : ''}${w?.collection ? `, Collection ${w.collection}` : ''}${w?.waterClass != null ? `, class ${w.waterClass}` : ''}.`
}
export function canopyHelper(meta?: Pick<Meta,'canopy'> | null): string {
  return `USFS satellite-based canopy estimate${meta?.canopy?.vintage ? ` for ${meta.canopy.vintage}` : ''}; open water excluded. Ties count halfway. Small or scattered urban canopy can be underestimated.`
}
export const validCanopy = (t: Pick<TractProps,'canopyPct'>): t is Pick<TractProps,'canopyPct'> & {canopyPct:number} => typeof t.canopyPct==='number' && Number.isFinite(t.canopyPct) && t.canopyPct>=0 && t.canopyPct<=100
export function canopyValue(n: number): string { return n>0 && n<0.05 ? '<0.1' : String(Number(n.toFixed(1))) }
export function canopyMissing(t: Pick<TractProps,'canopyStatus'>): string { return t.canopyStatus==='mostly-water' ? 'Mostly water — no canopy estimate' : 'Tree canopy unavailable for this tract.' }
export function canopyMissingExplanation(t: Pick<TractProps,'canopyStatus'>): string { return t.canopyStatus==='mostly-water' ? 'At least 99% of this tract is open water in Annual NLCD Land Cover; no land-canopy estimate is shown.' : 'No valid canopy estimate is available; missing data is not zero canopy.' }

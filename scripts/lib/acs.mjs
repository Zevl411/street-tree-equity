/**
 * #107: shared ACS table-based summary-file helpers (#103 join pattern).
 * Pipe-delimited .dat with GEO_ID header; tract rows prefixed 1400000US.
 */
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

export const ACS_YEAR = process.env.ACS_YEAR || '2024'
export const ACS_VINTAGE = `${+ACS_YEAR - 4}-${ACS_YEAR}`
export const acsSourceUrl = (table) => `https://www2.census.gov/programs-surveys/acs/summary_file/${ACS_YEAR}/table-based-SF/data/5YRData/acsdt5y${ACS_YEAR}-${table.toLowerCase()}.dat`
export const acsDatPath = (table) => `data-raw/acs/acsdt5y${ACS_YEAR}-${table.toLowerCase()}.dat`

/** Pack tract geoid → 11-digit string. */
export const tractGeoid = (f) => String(f.properties.geoid).padStart(11, '0')

export function loadPacks(dirs) {
  return dirs.map((dir) => ({
    dir,
    meta: JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')),
    fc: JSON.parse(fs.readFileSync(path.join(dir, 'tracts-equity.geojson'), 'utf8')),
  }))
}
export function writePack(p) {
  fs.writeFileSync(path.join(p.dir, 'tracts-equity.geojson'), JSON.stringify(p.fc))
  fs.writeFileSync(path.join(p.dir, 'meta.json'), JSON.stringify(p.meta))
}

/** Census value → finite non-negative number, else null (blank / sentinel negatives). */
export const acsNum = (s) => { const v = s === '' || s == null ? NaN : Number(s); return Number.isFinite(v) && v >= 0 ? v : null }

/** Stream a .dat; returns Map<geoid11, { [col]: number|null }> for wanted tracts only. */
export async function readAcsTracts(dat, cols, want) {
  const rows = new Map()
  let hdr = null
  for await (const line of readline.createInterface({ input: fs.createReadStream(dat) })) {
    const c = line.split('|')
    if (!hdr) { hdr = Object.fromEntries(c.map((h, i) => [h.replace(/^\uFEFF/, ''), i])); continue }
    const g = c[hdr.GEO_ID] ?? ''
    if (!g.startsWith('1400000US')) continue
    const id = g.slice(9).padStart(11, '0')
    if (!want.has(id)) continue
    rows.set(id, Object.fromEntries(cols.map((k) => [k, acsNum(c[hdr[k]])])))
  }
  return rows
}

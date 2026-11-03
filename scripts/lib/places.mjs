/** #117: CDC PLACES GIS-friendly CSV helpers (case-insensitive headers, CI parse). */
import fs from 'node:fs'
import readline from 'node:readline'

export function splitCsv(line) {
  const out = []; let cur = ''; let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += c }
    else if (c === '"') q = true
    else if (c === ',') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur); return out
}

/**
 * Stream a PLACES CSV; `want` = lowercase logical names → returns { columns (exact header names), rows Map<geoid, {name: raw}> }.
 * Headers are matched case-insensitively (bulk export ships `TractFIPS`, `CASTHMA_CrudePrev`; Socrata resource ships lowercase).
 */
export async function readPlaces(file, wantCols, geoids, joinCol = 'tractfips') {
  let idx = null; const columns = {}; const rows = new Map(); let total = 0
  for await (const raw of readline.createInterface({ input: fs.createReadStream(file) })) {
    if (!idx) {
      const hdr = splitCsv(raw.replace(/^\uFEFF/, '')).map((h) => h.trim())
      const lower = new Map(hdr.map((h, i) => [h.toLowerCase(), i]))
      idx = {}
      for (const c of [joinCol, ...wantCols]) {
        if (!lower.has(c)) throw new Error(`STOP: column ${c} (case-insensitive) missing in ${file}`)
        idx[c] = lower.get(c); columns[c] = hdr[lower.get(c)]
      }
      continue
    }
    if (!raw) continue
    total++
    const c = splitCsv(raw)
    const id = String(c[idx[joinCol]] ?? '').trim().padStart(11, '0')
    if (geoids.has(id)) rows.set(id, Object.fromEntries(wantCols.map((k) => [k, c[idx[k]]])))
  }
  return { columns, rows, total }
}

/** Blank / non-finite → null (never 0). */
export const placesNum = (s) => { if (s == null || String(s).trim() === '') return null; const v = Number(s); return Number.isFinite(v) ? v : null }

/** "( 8.1, 10.3)" → [8.1, 10.3] or null */
export function parseCi(s) {
  const m = String(s ?? '').match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/)
  if (!m) return null
  const lo = Number(m[1]); const hi = Number(m[2])
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null
}

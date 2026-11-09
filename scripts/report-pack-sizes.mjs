#!/usr/bin/env node
/**
 * #135: report per-pack file sizes (warn-only, always exit 0).
 * Walks Portland root public/data + every ready city in public/cities.json.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WARN_BYTES, FAIL_BYTES, packReport } from './lib/size-guard.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mb = (bytes) => (bytes / WARN_BYTES).toFixed(3)

const citiesPath = path.join(ROOT, 'public', 'cities.json')
const cities = JSON.parse(await fs.readFile(citiesPath, 'utf8'))
const ready = (cities.cities || []).filter((c) => c.status === 'ready')

/** @type {{ id: string, dir: string }[]} */
const packs = []
for (const c of ready) {
  const rel = c.dataPath || (c.id === 'portland-or' ? 'data' : `data/${c.id}`)
  packs.push({ id: c.id, dir: path.join(ROOT, 'public', rel) })
}

let anyWarn = false
let anyFailSized = false

for (const { id, dir } of packs) {
  const report = await packReport(dir)
  console.log(`\n=== ${id} (${path.relative(ROOT, dir) || dir}) — ${report.files.length} files, total ${mb(report.totalBytes)} MB ===`)
  console.log('file'.padEnd(28) + 'MB'.padStart(10) + 'bytes'.padStart(12))
  for (const f of report.files) {
    const flag = f.bytes > FAIL_BYTES ? ' FAIL' : f.bytes > WARN_BYTES ? ' WARN' : ''
    if (f.bytes > WARN_BYTES) anyWarn = true
    if (f.bytes > FAIL_BYTES) anyFailSized = true
    console.log(f.name.padEnd(28) + mb(f.bytes).padStart(10) + String(f.bytes).padStart(12) + flag)
  }
  console.log('TOTAL'.padEnd(28) + mb(report.totalBytes).padStart(10) + String(report.totalBytes).padStart(12))
}

if (anyFailSized) {
  console.warn('\n[report:sizes] WARN: one or more files exceed 3 MB hard threshold (report is warn-only; build checkFile would fail).')
} else if (anyWarn) {
  console.warn('\n[report:sizes] WARN: one or more files exceed 1 MB soft target.')
} else {
  console.log('\n[report:sizes] all files ≤ 1 MB soft target.')
}
process.exit(0)

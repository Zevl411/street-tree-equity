#!/usr/bin/env node
/**
 * #137: backfill slimLines onto committed packs (Portland root + every ready city in public/cities.json).
 * Reads committed sidewalks.geojson (and Portland bike.geojson when >1 MB) — no Overpass refetch.
 * Never touches tracts-equity.geojson / meta.json.
 * Sidewalks: 5 dp + DP (~1 m), then merge into one MultiLineString per distinct property set; asserts
 *   (a) line part count == pre-merge part count, (b) distinct property sets unchanged.
 * Bike: per-feature slim only; asserts feature count + property keys/ids unchanged.
 *   node scripts/slim-sidewalks.mjs [packDir...]
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { slimLines, assertSlimInvariant, slimAndMergeSidewalks } from './lib/slim-lines.mjs'
import { WARN_BYTES, checkFile } from './lib/size-guard.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let dirs = process.argv.slice(2)
if (!dirs.length) {
  const cities = JSON.parse(await fs.readFile(path.join(ROOT, 'public', 'cities.json'), 'utf8'))
  dirs = ['public/data', ...(cities.cities || []).filter((c) => c.status === 'ready' && c.id !== 'portland-or')
    .map((c) => `public/${c.dataPath || `data/${c.id}`}`)]
}

async function mergeSidewalks(fp, label) {
  let text
  try { text = await fs.readFile(fp, 'utf8') } catch (e) { if (e.code === 'ENOENT') return null; throw e }
  const r = slimAndMergeSidewalks(JSON.parse(text), label)
  const out = JSON.stringify(r.fc)
  await fs.writeFile(fp, out)
  checkFile(path.relative(ROOT, fp), Buffer.byteLength(out))
  console.log(`[slim] ${label}: ${r.preFeatures} features → ${r.features} MultiLineString (${r.parts} parts, ${r.propSets} prop sets) — asserts (a)(b) OK; ${text.length} → ${out.length} B`)
  return r
}

async function slimFile(fp, label) {
  let text
  try { text = await fs.readFile(fp, 'utf8') } catch (e) { if (e.code === 'ENOENT') return null; throw e }
  const before = JSON.parse(text)
  const after = slimLines(before)
  const r = assertSlimInvariant(before, after, label)
  const out = JSON.stringify(after)
  await fs.writeFile(fp, out)
  checkFile(path.relative(ROOT, fp), Buffer.byteLength(out))
  console.log(`[slim] ${label}: ${r.features} features (unchanged), keys unchanged; ${text.length} → ${out.length} B`)
  return { before: text.length, after: out.length }
}

for (const d of dirs) {
  const dir = path.resolve(ROOT, d)
  await mergeSidewalks(path.join(dir, 'sidewalks.geojson'), `${d}/sidewalks.geojson`)
  // Phase 2: Portland root bike.geojson only, when still over the 1 MB warn line.
  if (path.relative(ROOT, dir) === path.join('public', 'data')) {
    const bp = path.join(dir, 'bike.geojson')
    const st = await fs.stat(bp).catch(() => null)
    if (st && st.size > WARN_BYTES) await slimFile(bp, `${d}/bike.geojson`)
  }
}

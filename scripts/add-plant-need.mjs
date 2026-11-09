#!/usr/bin/env node
/**
 * #124: build-time 0–100 "Planting need" composite from props already in each pack (no download, no fetch).
 *   node scripts/add-plant-need.mjs public/data[/<city-id>] ...
 * Run AFTER canopy, poverty (#107) and asthma (#117) steps.
 * Per pack, over finite values: s(x)=100·(x−min)/(max−min) (max==min → 50)
 *   T = 100 − s(canopyPct); P = s(pctPoverty); A = s(pctAsthma) when finite for the tract.
 *   plantNeed = mean of available {T,P,A} (equal weights), 1 dp, clamped 0–100.
 *   Absent (never 0) when canopyPct or pctPoverty is missing.
 * meta.metricBreaks.plantNeed = densityBreaks(values,5); meta.overall.plantNeed = median tract score.
 */
import { densityBreaks } from './lib/geo-utils.mjs'
import { loadPacks, writePack } from './lib/acs.mjs'

const dirs = process.argv.slice(2)
if (!dirs.length) throw new Error('usage: add-plant-need.mjs <packDir> [...]')
const r1 = (x) => Math.round(x * 10) / 10
const fin = (v) => typeof v === 'number' && Number.isFinite(v)
const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : r1((s[n / 2 - 1] + s[n / 2]) / 2)) : null }
const scaler = (vals) => {
  const f = vals.filter(fin); if (!f.length) return null
  const lo = Math.min(...f), hi = Math.max(...f)
  return (x) => (hi === lo ? 50 : (100 * (x - lo)) / (hi - lo))
}

for (const p of loadPacks(dirs)) {
  const feats = p.fc.features
  const sT = scaler(feats.map((f) => f.properties.canopyPct))
  const sP = scaler(feats.map((f) => f.properties.pctPoverty))
  const sA = scaler(feats.map((f) => f.properties.pctAsthma))
  const vals = []
  let nulled = 0, asthmaMissing = 0
  for (const f of feats) {
    const t = f.properties
    delete t.plantNeed; delete t.plantNeedParts
    if (!sT || !sP || !fin(t.canopyPct) || !fin(t.pctPoverty)) { nulled++; continue }
    const T = 100 - sT(t.canopyPct), P = sP(t.pctPoverty)
    const A = sA && fin(t.pctAsthma) ? sA(t.pctAsthma) : null
    if (A == null) asthmaMissing++
    const parts = A == null ? [T, P] : [T, P, A]
    t.plantNeed = r1(Math.min(100, Math.max(0, parts.reduce((a, b) => a + b, 0) / parts.length)))
    // Compatibility key T now means the relative canopy-gap component, not mapped trees.
    t.plantNeedParts = { T: r1(T), P: r1(P), ...(A == null ? {} : { A: r1(A) }) }
    vals.push(t.plantNeed)
  }
  const m = p.meta
  m.metricBreaks = { ...(m.metricBreaks ?? {}), plantNeed: densityBreaks(vals, 5) }
  m.overall.plantNeed = median(vals)
  m.plantNeed = { inputs: ['canopyPct', 'pctPoverty', 'pctAsthma?'], weights: 'equal', scaling: 'pack min-max', canopyVersion: m.canopy?.version, asthmaIncluded: !!sA && asthmaMissing < vals.length }
  writePack(p)
  console.log(`[plant-need] ${p.dir}: ${vals.length}/${feats.length} scored, ${nulled} nulled (canopy/poverty missing), ${asthmaMissing} asthma-missing, breaks ${JSON.stringify(m.metricBreaks.plantNeed)}, median ${m.overall.plantNeed}, meta ${JSON.stringify(m.plantNeed)}`)
}

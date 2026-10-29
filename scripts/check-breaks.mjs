// #35 smoke: every pack's meta.breaks strictly positive + ascending, colors = breaks+1.
import fs from 'fs'
import { densityBreaks } from './lib/geo-utils.mjs'
let fail = 0
const z = densityBreaks([0, 0, 0, 0, 0.01, 0.02, 0.05, 0.1, 0.3], 5)
if (!z.length || z[0] <= 0) { console.error('FAIL densityBreaks zero-heavy', z); fail++ }
for (const d of fs.readdirSync('public/data', { withFileTypes: true })) {
  const p = `public/data/${d.name}/meta.json`
  if (!d.isDirectory() || !fs.existsSync(p)) continue
  const { breaks = [], colors = [] } = JSON.parse(fs.readFileSync(p))
  const ok = breaks.every((b, i) => b > 0 && (i === 0 || b > breaks[i - 1])) && colors.length === breaks.length + 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${d.name} ${JSON.stringify(breaks)}`)
  if (!ok) fail++
}
process.exit(fail ? 1 : 0)

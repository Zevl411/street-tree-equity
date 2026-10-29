#!/usr/bin/env node
// Smoke test: start the Express server against dist/ + public/data and hit a few routes.
//   npm run build && npm run test:smoke
import { spawn } from 'node:child_process'

const PORT = 3123
const BASE = process.env.BASE_PATH || '/'
const prefix = BASE.endsWith('/') ? BASE : BASE + '/'
const srv = spawn(process.execPath, ['server/index.mjs'], {
  env: { ...process.env, PORT: String(PORT), BASE_PATH: BASE },
  stdio: 'inherit',
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failed = 0
try {
  await sleep(1200)
  for (const p of ['', 'api/health', 'api/meta', 'api/tracts', 'cities.json', 'data/tracts-equity.geojson', 'data/trees.geojson']) {
    const url = `http://localhost:${PORT}${prefix}${p}`
    const res = await fetch(url)
    const body = await res.text()
    const ok = res.ok && body.length > 0
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'} ${res.status} ${url} (${body.length} bytes)`)
  }
} finally {
  srv.kill()
}
process.exit(failed ? 1 : 0)

#!/usr/bin/env node
/**
 * Optional local Node/Express server.
 *
 * GitHub Pages / GitLab Pages are static hosts and cannot run Node — production is the static
 * `dist/` folder only. This server is for local use / self-hosting on any free Node host:
 *   - serves the built app from dist/ (run `npm run build` first)
 *   - exposes a tiny read-only JSON API over the SAME static files in public/data
 *     (no database: the files are the database)
 *
 *   PORT=3000 BASE_PATH=/ npm run serve
 *   (BASE_PATH must match the VITE_BASE used for the build; default "/")
 */
import express from 'express'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const DATA = path.join(ROOT, 'public', 'data')
const PORT = Number(process.env.PORT || 3000)
const BASE = ('/' + (process.env.BASE_PATH || '/').replace(/^\/+|\/+$/g, '') + '/').replace('//', '/')

const cache = new Map()
async function readData(file) {
  if (!cache.has(file)) cache.set(file, JSON.parse(await fs.readFile(path.join(DATA, file), 'utf8')))
  return cache.get(file)
}

const app = express()
app.disable('x-powered-by')
const api = express.Router()

api.get('/health', (_req, res) => res.json({ ok: true }))
api.get('/meta', async (_req, res, next) => {
  try { res.json(await readData('meta.json')) } catch (e) { next(e) }
})
api.get('/tracts', async (_req, res, next) => {
  try {
    const fc = await readData('tracts-equity.geojson')
    // lightweight table view (no geometry), sorted lowest density first
    const rows = fc.features
      .map(({ properties: p }) => ({ geoid: p.geoid, name: p.name, treeCount: p.treeCount,
        areaAcres: p.areaAcres, treesPerAcre: p.treesPerAcre, rank: p.rank, bottomQuartile: p.bottomQuartile }))
      .sort((a, b) => a.treesPerAcre - b.treesPerAcre)
    res.json(rows)
  } catch (e) { next(e) }
})
api.get('/tracts/:geoid', async (req, res, next) => {
  try {
    const fc = await readData('tracts-equity.geojson')
    const f = fc.features.find((x) => x.properties.geoid === req.params.geoid)
    if (!f) return res.status(404).json({ error: 'tract not found' })
    res.json(f)
  } catch (e) { next(e) }
})
api.get('/parks', async (_req, res, next) => {
  try { res.json(await readData('parks.geojson')) } catch (e) { next(e) }
})

app.use(`${BASE}api`, api)

if (!existsSync(path.join(DIST, 'index.html'))) {
  console.warn('[server] dist/ not found — run `npm run build` first (API still works).')
}
app.use(BASE, express.static(DIST, { maxAge: '1h', index: 'index.html' }))
// single-page fallback
app.get(`${BASE}*`, (_req, res) => {
  const index = path.join(DIST, 'index.html')
  if (existsSync(index)) res.sendFile(index)
  else res.status(404).send('Build not found. Run `npm run build`.')
})
if (BASE !== '/') app.get('/', (_req, res) => res.redirect(BASE))

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: err.message })
})

app.listen(PORT, () => {
  console.log(`[server] Street Tree Equity at http://localhost:${PORT}${BASE}  (API: ${BASE}api/meta)`)
})

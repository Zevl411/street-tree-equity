#!/usr/bin/env node
/**
 * Build a static city pack into public/data/<cityId>/ and upsert a ready entry in public/cities.json.
 * Reuses `npm run data:refresh` with a temporary city.config.json, then restores the committed
 * config and Portland's public/data/* files from git.
 *
 * Env (or --key=value): CITY_ID, CITY_NAME, SUBTITLE, BBOX (W,S,E,N), STATE_FIPS, COUNTY_FIPS (comma list),
 * CENSUS_YEAR (optional), SKIP_BUILD=1 (config/cities.json dry run only).
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { checkFile, packReport } from './lib/size-guard.mjs'
import { slimAndMergeSidewalks } from './lib/slim-lines.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const [k, ...v] = a.slice(2).split('=')
    return [k.toUpperCase().replace(/-/g, '_'), v.join('=')]
  }),
)
const get = (k) => (args[k] ?? process.env[k] ?? '').trim()
const fail = (m) => { console.error(`build-city-pack: ${m}`); process.exit(1) }

const cityId = get('CITY_ID')
const cityName = get('CITY_NAME')
const subtitle = get('SUBTITLE')
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(cityId)) fail('CITY_ID must be kebab-case, e.g. central-miami-fl')
if (cityId === 'portland-or') fail('portland-or is the root pack; refusing to overwrite')
if (!cityName || !subtitle) fail('CITY_NAME and SUBTITLE are required')
const bbox = get('BBOX').split(',').map((s) => Number(s.trim()))
if (bbox.length !== 4 || bbox.some((n) => !Number.isFinite(n))) fail('BBOX must be W,S,E,N numbers')
const [w, s, e, n] = bbox
if (!(w < e && s < n) || w < -180 || e > 180 || s < -90 || n > 90) fail('BBOX must satisfy W<E, S<N in lon/lat')
if ((e - w) * (n - s) > 0.25) fail('BBOX too large (>0.25 sq deg); keep it city-district sized for Overpass')
const stateFips = get('STATE_FIPS')
if (!/^\d{2}$/.test(stateFips)) fail('STATE_FIPS must be 2 digits')
const countyFips = get('COUNTY_FIPS').split(',').map((c) => c.trim()).filter(Boolean)
if (!countyFips.length || countyFips.some((c) => !/^\d{3}$/.test(c))) fail('COUNTY_FIPS must be 3-digit codes, comma separated')

const configPath = path.join(ROOT, 'city.config.json')
const original = await fs.readFile(configPath, 'utf8')
const base = JSON.parse(original)
const censusYear = get('CENSUS_YEAR') ? Number(get('CENSUS_YEAR')) : base.censusYear
if (!Number.isInteger(censusYear)) fail('CENSUS_YEAR must be an integer')

const FILES = ['meta.json', 'tracts-equity.geojson', 'parks.geojson', 'groceries.geojson', 'schools.geojson', 'bike.geojson', 'transit.geojson', 'libraries.geojson', 'gardens.geojson', 'fountains.geojson', 'postoffices.geojson', 'playgrounds.geojson', 'toilets.geojson', 'benches.geojson', 'clinics.geojson', 'emergency.geojson', 'sidewalks.geojson', 'roads-lowtree.geojson', 'trees.geojson']
const dataDir = path.join(ROOT, 'public', 'data')
const packDir = path.join(dataDir, cityId)
const git = (...a) => execFileSync('git', a, { cwd: ROOT, stdio: 'inherit' })

const cfg = { ...base, cityName, subtitle, bbox, stateFips, countyFips, censusYear }
console.log('build-city-pack: config', JSON.stringify({ cityId, cityName, subtitle, bbox, stateFips, countyFips, censusYear }))

if (get('SKIP_BUILD') !== '1') {
  await fs.writeFile(configPath, JSON.stringify(cfg, null, 2) + '\n')
  try {
    execFileSync('npm', ['run', 'data:refresh'], { cwd: ROOT, stdio: 'inherit' })
    await fs.rm(packDir, { recursive: true, force: true })
    await fs.mkdir(packDir, { recursive: true })
    for (const f of FILES) {
      try { await fs.copyFile(path.join(dataDir, f), path.join(packDir, f)) }
      catch { console.warn(`build-city-pack: ${f} not produced (optional layer?)`) }
    }
  } finally {
    await fs.writeFile(configPath, original)
    // Restore Portland root pack files overwritten by the build.
    git('checkout', '--', ...FILES.map((f) => `public/data/${f}`))
  }
  // #137: sidewalks slim + merge-by-props (idempotent; build-data already slims after tract metrics — tracts untouched here).
  {
    const swPath = path.join(packDir, 'sidewalks.geojson')
    const swText = await fs.readFile(swPath, 'utf8').catch(() => null)
    if (swText) {
      const r = slimAndMergeSidewalks(JSON.parse(swText), `${cityId}/sidewalks.geojson`)
      await fs.writeFile(swPath, JSON.stringify(r.fc))
    }
  }
  for (const f of ['meta.json', 'tracts-equity.geojson']) {
    await fs.access(path.join(packDir, f)).catch(() => fail(`required ${f} missing from pack`))
  }
  // #135: per-file size guard on every FILES entry that landed in the pack
  for (const f of FILES) {
    const fp = path.join(packDir, f)
    try {
      const st = await fs.stat(fp)
      checkFile(`public/data/${cityId}/${f}`, st.size)
    } catch (e) {
      if (e && e.code === 'ENOENT') continue
      throw e
    }
  }
  const report = await packReport(packDir)
  console.log(`build-city-pack: ${cityId} pack total ${(report.totalBytes / 1048576).toFixed(3)} MB (${report.files.length} files)`)
}

const citiesPath = path.join(ROOT, 'public', 'cities.json')
const cities = JSON.parse(await fs.readFile(citiesPath, 'utf8'))
const entry = { id: cityId, cityName, subtitle, dataPath: `data/${cityId}`, bbox, status: 'ready' }
const i = cities.cities.findIndex((c) => c.id === cityId)
if (i >= 0) cities.cities[i] = { ...cities.cities[i], ...entry }
else cities.cities.push(entry)
await fs.writeFile(citiesPath, JSON.stringify(cities, null, 2) + '\n')
console.log(`build-city-pack: ${i >= 0 ? 'updated' : 'added'} ${cityId} in public/cities.json`)

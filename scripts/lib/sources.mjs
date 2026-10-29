// Free data sources: plain HTTP downloads (Census) and the public Overpass API (OSM).
// Raw responses are cached in data-raw/ (git-ignored) so re-runs don't hammer free services.
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const USER_AGENT = 'street-tree-equity/0.1 (open-source prototype)'
const opts = { rawDir: 'data-raw', refresh: false, endpoints: ['https://overpass-api.de/api/interpreter'] }
const log = (...a) => console.log('[data]', ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function setRawOptions(o) {
  Object.assign(opts, Object.fromEntries(Object.entries(o).filter(([, v]) => v != null)))
}

export async function cachedDownload(url, file) {
  const dest = path.join(opts.rawDir, file)
  if (!opts.refresh && existsSync(dest)) {
    log(`cache hit ${file}`)
    return fs.readFile(dest)
  }
  log(`downloading ${url}`)
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await fs.writeFile(dest, buf)
  return buf
}

/** POST an Overpass QL query, trying each configured endpoint with backoff. */
export async function overpass(name, query) {
  const dest = path.join(opts.rawDir, `overpass-${name}.json`)
  if (!opts.refresh && existsSync(dest)) {
    log(`cache hit overpass-${name}.json`)
    return JSON.parse(await fs.readFile(dest, 'utf8'))
  }
  let lastErr
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const ep of opts.endpoints) {
      try {
        log(`overpass ${name} -> ${ep} (attempt ${attempt + 1})`)
        const res = await fetch(ep, {
          method: 'POST',
          headers: {
            'User-Agent': USER_AGENT,
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: new URLSearchParams({ data: query }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        if (json.remark && /runtime error|timed out/i.test(json.remark)) throw new Error(json.remark)
        await fs.writeFile(dest, JSON.stringify(json))
        log(`overpass ${name}: ${json.elements?.length ?? 0} elements`)
        return json
      } catch (err) {
        lastErr = err
        log(`  failed: ${err.message}`)
        await sleep(3000 * (attempt + 1))
      }
    }
  }
  throw new Error(`Overpass query "${name}" failed on all endpoints: ${lastErr?.message}`)
}

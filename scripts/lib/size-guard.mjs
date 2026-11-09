/**
 * #135 Pack size guard — shared soft/hard thresholds for pack files.
 * Soft warn >1 MB (1048576 B); hard fail >3 MB per file. Never thins data.
 */
import fs from 'node:fs/promises'
import path from 'node:path'

export const WARN_BYTES = 1 * 1024 * 1024 // 1048576
export const FAIL_BYTES = 3 * 1024 * 1024 // 3145728

const mb = (bytes) => (bytes / WARN_BYTES).toFixed(3)

/**
 * Soft-warn when bytes > 1 MB; throw when bytes > 3 MB.
 * @param {string} filePath display / log path
 * @param {number} bytes file size in bytes
 * @returns {{ ok: true, warned: boolean }}
 */
export function checkFile(filePath, bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) {
    throw new Error(`size-guard: invalid bytes for ${filePath}: ${bytes}`)
  }
  if (bytes > FAIL_BYTES) {
    const msg = `[size-guard] FAIL: ${filePath} is ${mb(bytes)} MB (${bytes} bytes) > 3 MB. Not thinning — fix bbox/query or escalate.`
    console.error(msg)
    throw new Error(msg)
  }
  let warned = false
  if (bytes > WARN_BYTES) {
    warned = true
    console.warn(
      `[size-guard] WARN: ${filePath} is ${mb(bytes)} MB (${bytes} bytes) > 1 MB soft target. Do not thin silently — escalate if legitimate.`,
    )
  }
  return { ok: true, warned }
}

/**
 * Per-file sizes + pack total for a pack directory (non-recursive; .json/.geojson only).
 * @param {string} dir absolute or cwd-relative pack dir
 * @returns {Promise<{ dir: string, files: { name: string, path: string, bytes: number }[], totalBytes: number }>}
 */
export async function packReport(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = []
  for (const ent of entries) {
    if (!ent.isFile()) continue
    if (!ent.name.endsWith('.geojson') && !ent.name.endsWith('.json')) continue
    const fp = path.join(dir, ent.name)
    const st = await fs.stat(fp)
    files.push({ name: ent.name, path: fp, bytes: st.size })
  }
  files.sort((a, b) => a.name.localeCompare(b.name))
  const totalBytes = files.reduce((s, f) => s + f.bytes, 0)
  return { dir, files, totalBytes }
}

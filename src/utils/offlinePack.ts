// #88: keep exactly one city pack (the last successful load) in Cache Storage for offline use.
// The service worker reads this cache only when the network fails. Replace-only: other packs are evicted.
export const LAST_PACK_CACHE = 'ste-last-pack'

export async function saveLastPack(responses: Response[]): Promise<void> {
  if (!import.meta.env.PROD || typeof caches === 'undefined' || !responses.length) return
  try {
    const cache = await caches.open(LAST_PACK_CACHE)
    const keep = new Set(responses.map((r) => r.url))
    for (const req of await cache.keys()) if (!keep.has(req.url)) await cache.delete(req)
    await Promise.all(responses.map((r) => cache.put(r.url, r)))
  } catch {
    // Quota / private mode: offline is best-effort.
  }
}

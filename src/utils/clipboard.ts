import { applyShareFlags, encodeLayers, type LayerFlags, type ShareFlags } from '@/composables/useDeepLink'
import type { Basemap, DensityUnit, ThemeName } from '@/stores/ui'

/** #47: copy text; Clipboard API first, then legacy execCommand. Never throws. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* fall through to legacy */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/** Absolute share URL for a tract, mirroring writeDeepLink rules. */
export function tractShareUrl(v: { city: string | null; geoid: string; basemap: Basemap; theme: ThemeName; layers: LayerFlags; unit: DensityUnit } & ShareFlags): string {
  const url = new URL(window.location.origin + window.location.pathname)
  const q = url.searchParams
  if (v.city) q.set('city', v.city)
  q.set('geoid', v.geoid)
  q.set('basemap', v.basemap)
  q.set('theme', v.theme)
  const layers = encodeLayers(v.layers)
  if (layers !== null) q.set('layers', layers)
  if (v.unit === 'km2') q.set('unit', 'km2')
  applyShareFlags(q, v)
  return url.href
}

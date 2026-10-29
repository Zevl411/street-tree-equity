import { nextTick, watch, type Ref } from 'vue'

/** Focus the first match of `selector` once an overlay has rendered (teleported content needs a frame). */
export async function focusSoon(selector: string | (() => HTMLElement | null | undefined)) {
  await nextTick()
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    const el = typeof selector === 'string' ? document.querySelector<HTMLElement>(selector) : selector()
    if (el && el.offsetParent !== null) {
      el.focus()
      // Overlays mid-transition can silently refuse focus; keep trying for a few frames.
      if (document.activeElement === el) {
        // VDialog focuses its own content wrapper after the enter transition; win that race.
        setTimeout(() => {
          const a = document.activeElement
          if (el.isConnected && (!a || a === document.body || a.classList.contains('v-overlay__content'))) el.focus()
        }, 350)
        return true
      }
    }
  }
  return false
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex="0"]:not(.v-list-item--disabled), a[href]'

/**
 * #39: on open, move focus to `initial` (selector inside the overlay); on close,
 * return focus to whatever opened it (the activator), or `fallback` if it's gone.
 */
export function useOverlayFocus(
  open: Ref<boolean>,
  initial: string,
  fallback?: () => string | null,
  /** Return false when another surface (e.g. the tract drawer) takes focus on close. */
  shouldRestore: () => boolean = () => true,
) {
  let opener: HTMLElement | null = null
  watch(open, async (v) => {
    if (v) {
      const active = document.activeElement as HTMLElement | null
      opener = active && active !== document.body ? active : null
      await focusSoon(initial)
    } else {
      const el = opener
      opener = null
      await nextTick()
      setTimeout(() => {
        if (!shouldRestore()) return
        if (el?.isConnected && el.offsetParent !== null) el.focus()
        else { const f = fallback?.(); if (f) void focusSoon(f) }
      }, 0)
    }
  })
}

export const firstFocusableIn = (root: string) => `${root} :is(${FOCUSABLE})`

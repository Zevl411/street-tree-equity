import { ref, type Ref } from 'vue'

const QUERY = '(prefers-reduced-motion: reduce)'
let state: Ref<boolean> | null = null

/** Live ref of the OS reduced-motion preference (shared singleton). */
export function usePrefersReducedMotion(): Ref<boolean> {
  if (state) return state
  const mql = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(QUERY) : null
  state = ref(!!mql?.matches)
  const s = state
  mql?.addEventListener?.('change', (e) => { s.value = e.matches })
  return s
}

/** Camera animation duration: 0 when reduced motion is requested. */
export function cameraDuration(ms: number): number {
  return usePrefersReducedMotion().value ? 0 : ms
}

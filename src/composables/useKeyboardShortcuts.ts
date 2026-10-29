import { onMounted, onUnmounted } from 'vue'

// #46: global single-key shortcuts via native keydown (no deps).
export interface ShortcutHandlers {
  find: () => void
  escape: () => void
  toggleTheme: () => void
  toggleBasemap: () => void
  toggleHotspots: () => void
  help: () => void
  toggleFullscreen?: () => void
  /** #77: n/p cycle below-median tracts. */
  jumpBelowMedian?: (dir: 1 | -1) => void
  /** #84: `*` (Shift+8 / numpad) toggles star on the selected tract. */
  toggleStar?: () => void
}

/** True when the key should be left to a text field / editable element. */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file', 'image'].includes(type)
  }
  return el.closest('[contenteditable="true"], [role="textbox"], [role="combobox"]') !== null
}

export function useKeyboardShortcuts(h: ShortcutHandlers): void {
  function onKey(e: KeyboardEvent) {
    if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === 'Escape') { h.escape(); return } // capture phase: runs before Vuetify closes an overlay, so open-state checks are accurate; never preventDefault
    if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return
    switch (e.key === '?' ? '?' : e.key.toLowerCase()) {
      case '/': e.preventDefault(); h.find(); break
      case '?': e.preventDefault(); h.help(); break
      case 'd': h.toggleTheme(); break
      case 's': h.toggleBasemap(); break
      case 'h': h.toggleHotspots(); break
      case 'f': h.toggleFullscreen?.(); break
      case 'n': h.jumpBelowMedian?.(1); break
      case 'p': h.jumpBelowMedian?.(-1); break
      case '*': e.preventDefault(); h.toggleStar?.(); break
    }
  }
  onMounted(() => window.addEventListener('keydown', onKey, { capture: true }))
  onUnmounted(() => window.removeEventListener('keydown', onKey, { capture: true }))
}

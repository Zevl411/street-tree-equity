import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

export type ThemeName = 'treeLight' | 'treeDark'
export type Basemap = 'streets' | 'satellite'

const THEME_KEY = 'ste-theme'
const BASEMAP_KEY = 'ste-basemap'

function read(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function write(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* storage unavailable */ }
}

/** Saved preference, else OS prefers-color-scheme, else light. */
export function initialTheme(): ThemeName {
  const saved = read(THEME_KEY)
  if (saved === 'treeLight' || saved === 'treeDark') return saved
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'treeDark' : 'treeLight'
}

function initialBasemap(): Basemap {
  return read(BASEMAP_KEY) === 'satellite' ? 'satellite' : 'streets'
}

/** UI chrome state: theme, basemap, layer visibility, About dialog. */
export const useUiStore = defineStore('ui', () => {
  const theme = ref<ThemeName>(initialTheme())
  const isDark = computed(() => theme.value === 'treeDark')
  const themeAnnounce = ref('')

  function setTheme(name: ThemeName): void {
    theme.value = name
    write(THEME_KEY, name)
    themeAnnounce.value = name === 'treeDark' ? 'Dark mode on' : 'Light mode on'
  }
  function toggleTheme(): void {
    setTheme(isDark.value ? 'treeLight' : 'treeDark')
  }

  // Satellite UI ships in a later PR; the field + persistence are ready for it.
  const basemap = ref<Basemap>(initialBasemap())
  watch(basemap, (b) => write(BASEMAP_KEY, b))
  function setBasemap(b: Basemap): void {
    basemap.value = b
  }

  const showTrees = ref(true)
  const showParks = ref(true)
  const showRoads = ref(true)
  const highlightBottomQuartile = ref(false)
  const aboutOpen = ref(false)

  return {
    theme, isDark, themeAnnounce, setTheme, toggleTheme,
    basemap, setBasemap,
    showTrees, showParks, showRoads, highlightBottomQuartile, aboutOpen,
  }
})

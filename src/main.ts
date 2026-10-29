import { createApp } from 'vue'
import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'
import 'maplibre-gl/dist/maplibre-gl.css'
import { createVuetify } from 'vuetify'
import App from './App.vue'
import './style.css'

function initialTheme(): 'treeLight' | 'treeDark' {
  try {
    const saved = localStorage.getItem('ste-theme')
    if (saved === 'treeLight' || saved === 'treeDark') return saved
  } catch { /* storage unavailable */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'treeDark' : 'treeLight'
}

const vuetify = createVuetify({
  theme: {
    defaultTheme: initialTheme(),
    themes: {
      treeLight: {
        dark: false,
        colors: { primary: '#2e7d32', secondary: '#6d4c41', accent: '#f9a825', surface: '#ffffff', background: '#fafafa' },
      },
      treeDark: {
        dark: true,
        colors: { primary: '#66bb6a', secondary: '#bcaaa4', accent: '#ffd54f', surface: '#1e1e1e', background: '#121212' },
      },
    },
  },
})

createApp(App).use(vuetify).mount('#app')

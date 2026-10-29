import { createApp, watch } from 'vue'
import { createPinia } from 'pinia'
import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'
import 'maplibre-gl/dist/maplibre-gl.css'
import { createVuetify } from 'vuetify'
import App from './App.vue'
import { useUiStore } from './stores/ui'
import './style.css'

const pinia = createPinia()
const app = createApp(App).use(pinia)
const ui = useUiStore(pinia)

const vuetify = createVuetify({
  theme: {
    defaultTheme: ui.theme,
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
// The ui store owns the theme; keep Vuetify in sync with it.
watch(() => ui.theme, (name) => { vuetify.theme.global.name.value = name })

app.use(vuetify).mount('#app')

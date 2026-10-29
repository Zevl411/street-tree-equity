import { createApp } from 'vue'
import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'
import 'maplibre-gl/dist/maplibre-gl.css'
import { createVuetify } from 'vuetify'
import App from './App.vue'
import './style.css'

const vuetify = createVuetify({
  theme: {
    defaultTheme: 'treeLight',
    themes: {
      treeLight: {
        dark: false,
        colors: { primary: '#2e7d32', secondary: '#6d4c41', accent: '#f9a825', surface: '#ffffff' },
      },
    },
  },
})

createApp(App).use(vuetify).mount('#app')

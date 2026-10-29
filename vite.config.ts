import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'

// Base path is configurable so the same build works on:
//   - GitHub Pages project site:  VITE_BASE=/street-tree-equity/
//   - GitLab Pages project site:  VITE_BASE=/<project-name>/
//   - User/org Pages root, local Express server, or `npm run dev`:  VITE_BASE=/  (default)
const base = process.env.VITE_BASE || '/'

export default defineConfig({
  base,
  plugins: [vue(), vuetify({ autoImport: true })],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    chunkSizeWarningLimit: 1600,
  },
})

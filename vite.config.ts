import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'
import { VitePWA } from 'vite-plugin-pwa'

// Base path is configurable so the same build works on:
//   - GitHub Pages project site:  VITE_BASE=/street-tree-equity/
//   - GitLab Pages project site:  VITE_BASE=/<project-name>/
//   - User/org Pages root, local Express server, or `npm run dev`:  VITE_BASE=/  (default)
const base = process.env.VITE_BASE || '/'

export default defineConfig({
  base,
  plugins: [
    vue(),
    vuetify({ autoImport: true }),
    // #88: offline shell + last city pack. Same-origin only; basemap/satellite tiles are never cached.
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}', 'cities.json'],
        globIgnores: ['data/**', '**/data/**'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/data\//, /\.json$/, /\.geojson$/],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // City packs: always network; on failure fall back to the single last-pack cache the
            // app writes after a successful load (src/utils/offlinePack.ts). Nothing is added here.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/[^/]+\.(geojson|json)$/.test(url.pathname) && !url.pathname.endsWith('/cities.json'),
            handler: 'NetworkOnly',
            options: {
              plugins: [{
                handlerDidError: async ({ request }) => (await (await caches.open('ste-last-pack')).match(request)) ?? Response.error(),
              }],
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    chunkSizeWarningLimit: 1600,
  },
})

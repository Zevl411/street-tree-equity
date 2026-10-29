<script setup lang="ts">
// #42: compact, always-visible basemap credit chip (bottom-right of map stage,
// opposite the mobile legend). Replaces MapLibre's attribution control.
import { storeToRefs } from 'pinia'
import { useUiStore } from '@/stores/ui'

const { basemap } = storeToRefs(useUiStore())
</script>

<template>
  <div class="credit-strip text-caption" role="contentinfo" aria-label="Map credits">
    <template v-if="basemap === 'satellite'">
      <a href="https://cloudless.eox.at" target="_blank" rel="noopener noreferrer"
        title="EOxCloudless by EOX — contains modified Copernicus Sentinel data 2025 · non-commercial">EOxCloudless<span class="sr-only"> (opens in new tab)</span></a>
      · <span title="Contains modified Copernicus Sentinel data 2025">Copernicus 2025<span class="sr-only"> (modified Copernicus Sentinel data)</span></span>
      · <span title="Non-commercial license">CC BY-NC-SA<span class="sr-only"> (non-commercial)</span></span>
    </template>
    <template v-else>
      © <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap<span class="sr-only"> (opens in new tab)</span></a>
      · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap<span class="sr-only"> (opens in new tab)</span></a>
    </template>
    · <a href="https://www.census.gov/geographies/mapping-files.html" target="_blank" rel="noopener noreferrer" title="Tract boundaries: U.S. Census Bureau">Census<span class="sr-only"> tract boundaries (opens in new tab)</span></a>
  </div>
</template>

<style scoped>
.credit-strip {
  position: absolute;
  right: 8px;
  bottom: calc(8px + env(safe-area-inset-bottom, 0px));
  z-index: 2; /* with legend/overview; below Vuetify overlays */
  max-width: min(280px, 46vw);
  padding: 2px 8px;
  border-radius: 4px;
  line-height: 16px;
  text-align: right;
  background: rgba(var(--v-theme-surface), 0.88);
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}
.credit-strip a { color: inherit; text-decoration: none; }
.credit-strip a:hover, .credit-strip a:focus-visible { text-decoration: underline; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>

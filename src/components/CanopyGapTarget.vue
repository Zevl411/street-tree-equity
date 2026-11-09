<script setup lang="ts">
import { computed } from 'vue'
import { gapNumber, type GapTargetMode } from '@/utils/canopyGap'
const props=defineProps<{ mode:GapTargetMode; target:number|null; loading?:boolean }>()
const emit=defineEmits<{ change:[mode:GapTargetMode] }>()
const description=computed(()=>props.loading?'Loading canopy-gap estimate…':props.mode==='30'?'Target: 30% canopy — a fixed comparison, not an official recommendation.':props.target===null?'City target unavailable. Use a fixed 30% target to choose a comparison.':`Target: ${gapNumber(props.target)}% canopy — your city's leafier neighborhoods (75th percentile of tract estimates in this pack).`)
</script>
<template>
  <div class="canopy-gap-target my-3">
    <v-switch :model-value="mode === '30'" label="Use a fixed 30% target" inset color="primary" density="compact" hide-details
      aria-describedby="canopy-gap-target-description" @update:model-value="emit('change', $event ? '30' : 'p75')" />
    <p id="canopy-gap-target-description" class="text-caption">{{ description }}</p>
  </div>
</template>
<style scoped>
.canopy-gap-target { color: rgb(var(--v-theme-on-surface)); }
.canopy-gap-target :deep(.v-switch__track) { opacity: 1; }
.canopy-gap-target :deep(.v-selection-control) { min-height: 44px; }
.canopy-gap-target :deep(.v-label) { white-space: normal; height: auto; opacity: 1; min-height: 44px; }
.canopy-gap-target :deep(.v-selection-control:has(input:focus-visible)) { outline: 2px solid rgb(var(--v-theme-on-surface)); outline-offset: 2px; border-radius: 4px; }
</style>

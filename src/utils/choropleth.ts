import type { Meta } from '@/types'

export type ChoroplethMode = 'green' | 'contrast'

/** #49: viridis-like, colorblind-friendlier (low → high density). Mode-constant across themes. */
export const HIGH_CONTRAST_COLORS = ['#440154', '#31688e', '#35b779', '#fde725', '#f0e442'] as const

/** Active fill ramp; same length as meta.colors so meta.breaks step stops line up. */
export function choroplethColors(meta: Pick<Meta, 'colors'>, mode: ChoroplethMode): string[] {
  if (mode !== 'contrast') return meta.colors
  const n = meta.colors.length
  return Array.from({ length: n }, (_, i) =>
    HIGH_CONTRAST_COLORS[n <= 1 ? 0 : Math.round((i * (HIGH_CONTRAST_COLORS.length - 1)) / (n - 1))])
}

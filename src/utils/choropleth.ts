import type { Meta } from '@/types'

export type ChoroplethMode = 'green' | 'contrast'
export type ChoroplethPalette = 'default' | 'cb'

/** #49: viridis-like, colorblind-friendlier (low → high density). Mode-constant across themes. */
export const HIGH_CONTRAST_COLORS = ['#440154', '#31688e', '#35b779', '#fde725', '#f0e442'] as const

/** #81: Okabe–Ito–ish sequential (blues → teal → green → amber). Mode-constant across themes. */
export const CB_SAFE_COLORS = ['#56B4E9', '#0072B2', '#009E73', '#E69F00', '#D55E00'] as const

function sample(ramp: readonly string[], n: number): string[] {
  return Array.from({ length: n }, (_, i) =>
    ramp[n <= 1 ? 0 : Math.round((i * (ramp.length - 1)) / (n - 1))])
}

/**
 * Active fill ramp; same length as meta.colors so meta.breaks step stops line up.
 * HC (#49) always wins; palette (#81) only applies on the Green path.
 */
export function choroplethColors(meta: Pick<Meta, 'colors'>, mode: ChoroplethMode, palette: ChoroplethPalette = 'default'): string[] {
  if (mode === 'contrast') return sample(HIGH_CONTRAST_COLORS, meta.colors.length)
  if (palette === 'cb') return sample(CB_SAFE_COLORS, meta.colors.length)
  return meta.colors
}

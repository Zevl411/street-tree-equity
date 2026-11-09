// #138: placesCitation year clause — omit when missing (never "BRFSS undefined")
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { placesCitation } from '../src/utils/placesCitation.ts'

test('#138 placesCitation includes BRFSS year when present', () => {
  const s = placesCitation('Current cigarette smoking among adults', 'current cigarette smoking', 2023)
  assert.match(s, /\(BRFSS 2023 model-based estimates\)/)
  assert.doesNotMatch(s, /BRFSS undefined|BRFSS null|BRFSS\s+\)/)
  assert.match(s, /self-reported current cigarette smoking/)
})

test('#138 placesCitation omits year clause when year missing', () => {
  for (const y of [null, undefined, Number.NaN] as const) {
    const s = placesCitation('Current cigarette smoking among adults', 'current cigarette smoking', y as number | null | undefined)
    assert.match(s, /2025 release \(model-based estimates\)\./)
    assert.doesNotMatch(s, /BRFSS/)
    assert.doesNotMatch(s, /undefined|null/)
  }
})

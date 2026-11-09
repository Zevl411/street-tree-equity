// #135 pack size-guard thresholds: node --test tests/sizeGuard.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error — build-time .mjs helper (no types)
import { WARN_BYTES, FAIL_BYTES, checkFile } from '../scripts/lib/size-guard.mjs'

test('constants: 1 MB and 3 MB', () => {
  assert.equal(WARN_BYTES, 1048576)
  assert.equal(FAIL_BYTES, 3145728)
})

test('1 MB boundary: equal → no warn; +1 → warn', () => {
  const at = checkFile('at-1mb.bin', WARN_BYTES)
  assert.equal(at.ok, true)
  assert.equal(at.warned, false)
  const over = checkFile('over-1mb.bin', WARN_BYTES + 1)
  assert.equal(over.ok, true)
  assert.equal(over.warned, true)
})

test('3 MB boundary: equal → warn only; +1 → throw', () => {
  const at = checkFile('at-3mb.bin', FAIL_BYTES)
  assert.equal(at.ok, true)
  assert.equal(at.warned, true)
  assert.throws(
    () => checkFile('over-3mb.bin', FAIL_BYTES + 1),
    (err: unknown) => err instanceof Error && /FAIL/.test(err.message),
  )
})

test('well under soft target → ok, no warn', () => {
  const r = checkFile('small.bin', 100)
  assert.equal(r.ok, true)
  assert.equal(r.warned, false)
})

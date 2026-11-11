import test from 'node:test'
import assert from 'node:assert/strict'
import { focusSoon } from '../src/composables/useOverlayFocus.ts'

// No DOM dependency: exercise the asynchronous cancellation boundary with a tiny focus target.
function fakePage() {
  const saved = { document: globalThis.document, raf: globalThis.requestAnimationFrame, timeout: globalThis.setTimeout }
  const delayed: (() => void)[] = []
  let calls = 0
  const body = {} as HTMLElement
  const page = { body, activeElement: body, querySelector: () => el }
  const el = {
    offsetParent: {}, isConnected: true,
    focus() { calls++; page.activeElement = el as unknown as HTMLElement },
  }
  Object.assign(globalThis, {
    document: page,
    requestAnimationFrame: (fn: FrameRequestCallback) => setImmediate(() => fn(0)),
    setTimeout: (fn: () => void, ms: number) => {
      if (ms === 350) { delayed.push(fn); return 0 }
      return saved.timeout(fn, ms)
    },
  })
  return { page, el, delayed, calls: () => calls,
    restore() { Object.assign(globalThis, { document: saved.document, requestAnimationFrame: saved.raf, setTimeout: saved.timeout }) },
  }
}

test('opening focus work is cancelled when Escape closes the overlay before the next frame', async () => {
  const f = fakePage()
  try {
    let open = true
    const pending = focusSoon('#item', () => open)
    open = false
    assert.equal(await pending, false)
    assert.equal(f.calls(), 0, 'must not focus a leaving item')
  } finally { f.restore() }
})

test('a stale post-transition retry cannot steal focus after close or a newer open', async () => {
  const f = fakePage()
  try {
    let generation = 1
    assert.equal(await focusSoon('#item', () => generation === 1), true)
    assert.equal(f.calls(), 1)
    generation++
    f.page.activeElement = f.page.body
    f.delayed.forEach((fn) => fn())
    assert.equal(f.calls(), 1, 'stale callback must not focus an outgoing list')
  } finally { f.restore() }
})

test('current opening work still focuses its target', async () => {
  const f = fakePage()
  try {
    assert.equal(await focusSoon('#item', () => true), true)
    assert.equal(f.page.activeElement, f.el)
    assert.equal(f.calls(), 1)
  } finally { f.restore() }
})

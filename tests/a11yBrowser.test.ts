import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launchChrome, freePort } from '../scripts/lib/a11y-browser.mjs'

test('harness uses a free ephemeral port', async () => {
  const port = await freePort()
  assert.ok(Number.isInteger(port) && port > 0)
})

test('Chrome failure retries three times with fresh profiles/ports and complete diagnostics', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ste-chrome-test-'))
  const binary = path.join(dir, 'fake-chrome')
  writeFileSync(binary, '#!/bin/sh\necho startup-out\necho startup-err >&2\nexit 17\n', { mode: 0o755 })
  try {
    await assert.rejects(launchChrome(binary, { timeout: 2000 }), (error: Error) => {
      assert.match(error.message, /after 3 attempts/)
      for (const i of [1, 2, 3]) assert.ok(error.message.includes(`Attempt ${i}/3: binary=${binary}`))
      assert.match(error.message, /stdout:\nstartup-out/)
      assert.match(error.message, /stderr:\nstartup-err/)
      const profiles = [...error.message.matchAll(/--user-data-dir=([^"\n]+)/g)].map((m) => m[1])
      const ports = [...error.message.matchAll(/--remote-debugging-port=(\d+)/g)].map((m) => m[1])
      assert.equal(new Set(profiles).size, 3)
      assert.equal(new Set(ports).size, 3)
      return true
    })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('an unspawnable Chrome binary fails clearly rather than hanging cleanup', async () => {
  await assert.rejects(launchChrome('/does-not-exist/ste-chrome', { timeout: 1000 }), /ENOENT/)
})

#!/usr/bin/env node
// #142/#145: headless menu-button and dual-view focus tests at desktop + 390px.
//   npm run build && npm run test:a11y
// Zero dependencies: starts server/index.mjs (like test:smoke), launches a local Chrome/Chromium
// in headless mode and drives it over the DevTools protocol with Node's built-in WebSocket.
// Set CHROME_PATH to override the browser binary.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { freePort, launchChrome } from './lib/a11y-browser.mjs'

const PORT = Number(process.env.A11Y_PORT || await freePort())
const BASE = `http://localhost:${PORT}/`
const CSV_VIEW_TOOLTIP = 'Download the tracts and metrics in this view as a CSV file'
const ROUNDS = Number(process.env.A11Y_ROUNDS || 2) // repeat each open key to catch focus races
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function findChrome() {
  const c = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean)
  const hit = c.find((p) => existsSync(p))
  if (!hit) throw new Error('No Chrome/Chromium found; set CHROME_PATH')
  return hit
}

let viewport = ''
let passed = 0
let failed = 0
function check(ok, label, extra = '') {
  if (ok) passed++
  else failed++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${viewport}${label}${!ok && extra ? ` (${extra})` : ''}`)
}

// --- minimal CDP client ---
class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map()
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result)
      }
    })
  }
  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }) })
    return new Cdp(ws)
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })) })
  }
  close() { this.ws.close() }
}

const KEYS = {
  Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
  Space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
  Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
  Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
  d: { key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68, text: 'd' },
}

let cdp
async function evaluate(expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.text}: ${r.exceptionDetails.exception?.description ?? ''}`)
  return r.result.value
}
async function press(name, modifiers = 0) {
  const k = KEYS[name]
  const { text, ...rest } = k
  await cdp.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', modifiers, ...rest, ...(text ? { text, unmodifiedText: text } : {}) })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, ...rest })
}
async function focusElement(expr) {
  if (!await waitFor(`window.__vis(${expr})`, 5000)) throw new Error(`Focus target missing/hidden: ${expr}`)
  await evaluate(`(${expr}).focus()`)
  if (!await waitFor(`document.activeElement === (${expr}) && window.__settled()`, 5000)) throw new Error(`Focus did not settle: ${expr}`)
}
async function settled() {
  if (!await waitFor('window.__settled()', 5000)) throw new Error('Overlay transition did not settle')
}
const SHIFT = 8
async function waitFor(expression, timeout = 15000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (await evaluate(expression).catch(() => false)) return true
    await sleep(100)
  }
  return false
}
async function goto(url) {
  const previous = await evaluate('window.__a11yDocument').catch(() => null)
  await cdp.send('Page.navigate', { url })
  if (!await waitFor(`window.__a11yDocument && window.__a11yDocument !== ${JSON.stringify(previous)} && document.readyState === "complete"`)) {
    throw new Error(`Navigation did not complete: ${url}`)
  }
}

// Page-side helpers, installed on every document.
const PAGE_HELPERS = `
  window.__a11yDocument = crypto.randomUUID()
  window.__downloads = []
  const origClick = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__downloads.push(this.download); return } return origClick.call(this) }
  window.__settled = () => !document.getAnimations().some((a) => a.playState === 'running' && a.effect?.target?.closest?.('.v-overlay'))
  window.__vis = (el) => !!el && el.isConnected && el.checkVisibility({ visibilityProperty: true }) && el.getClientRects().length > 0
  window.__btn = (root, text) => [...document.querySelectorAll(root + ' button')].find((b) => b.textContent.trim().startsWith(text)) || null
  window.__tooltipShown = (text) => [...document.querySelectorAll('.v-tooltip > .v-overlay__content')].some((c) => window.__vis(c) && c.textContent.trim() === text)
`

/**
 * One menu button: Enter / Space / ArrowDown open it and focus the first item, aria-expanded tracks
 * state, Escape closes it and returns focus to the button, Tab closes it without trapping focus.
 * `btn` is a page expression for the activator; `menu` is the menu list selector.
 */
async function menuButtonSuite(name, { btn, menu, stillOpen }) {
  const firstItem = `document.querySelector('${menu} .v-list-item')`
  const isOpen = `window.__vis(document.querySelector('${menu}'))`
  check(await evaluate(`(${btn})?.getAttribute('aria-haspopup') === 'menu'`), `${name}: aria-haspopup="menu"`)
  for (const key of Array.from({ length: ROUNDS }, () => ['Enter', 'Space', 'ArrowDown']).flat()) {
    await focusElement(btn)
    check(await evaluate(`(${btn}).getAttribute('aria-expanded') === 'false' && !${isOpen}`), `${name}: closed + aria-expanded="false" before ${key}`)
    await press(key)
    const focused = await waitFor(`document.activeElement === ${firstItem} && ${isOpen}`, 3000)
    check(focused, `${name}: ${key} opens the menu and focuses the first item`,
      await evaluate(`(document.activeElement?.className || '') + ' | ' + (document.activeElement?.textContent || '').trim().slice(0, 40)`))
    check(await evaluate(`(${btn}).getAttribute('aria-expanded') === 'true'`), `${name}: aria-expanded="true" after ${key}`)
    await press('Escape')
    const closed = await waitFor(`!${isOpen} && document.activeElement === (${btn}) && window.__settled()`, 5000)
    check(closed, `${name}: Escape after ${key} closes the menu and returns focus to the button`,
      await evaluate(`(document.activeElement?.textContent || '').trim().slice(0, 40)`))
    check(await evaluate(`(${btn}).getAttribute('aria-expanded') === 'false'`), `${name}: aria-expanded="false" after Escape`)
    if (stillOpen) check(await evaluate(stillOpen), `${name}: Escape closes only this menu, not its parent surface`)
    await settled()
  }
  // Tab closes without trapping focus.
  await focusElement(btn)
  await press('Enter')
  await waitFor(`document.activeElement === ${firstItem}`, 3000)
  const items = await evaluate(`document.querySelectorAll('${menu} .v-list-item').length`)
  for (let i = 0; i < items; i++) await press('Tab')
  check(await waitFor(`!${isOpen}`, 3000), `${name}: Tab moves out and closes the menu (no trap)`)
  check(await evaluate(`(${btn}).getAttribute('aria-expanded') === 'false'`), `${name}: aria-expanded="false" after Tab`)
  await settled()
  return { firstItem, isOpen }
}

/** The #139/#140 current-view CSV item keeps its aria-label and shows the #140 tooltip on keyboard focus. */
async function csvItemChecks(name, { btn, menu, csvIndex, ariaPrefix, nested = false }) {
  const isOpen = `window.__vis(document.querySelector('${menu}'))`
  const item = `document.querySelectorAll('${menu} .v-list-item')[${csvIndex}]`
  await focusElement(btn)
  await press('ArrowDown')
  await waitFor(`document.activeElement === document.querySelector('${menu} .v-list-item')`, 3000)
  for (let i = 0; i < csvIndex; i++) await press('ArrowDown')
  check(await waitFor(`document.activeElement === ${item}`, 2000), `${name}: ArrowDown moves between items to the CSV item`)
  check(await evaluate(`(${item}).getAttribute('aria-label')?.startsWith(${JSON.stringify(ariaPrefix)})`), `${name}: CSV item keeps its aria-label`,
    await evaluate(`(${item}).getAttribute('aria-label')`))
  check(await waitFor(`window.__tooltipShown(${JSON.stringify(CSV_VIEW_TOOLTIP)})`, 3000), `${name}: #140 tooltip opens on focus`)
  await evaluate('window.__downloads.length = 0')
  await press('Enter')
  check(await waitFor('window.__downloads.length === 1', 3000), `${name}: Enter on the CSV item downloads`, await evaluate('JSON.stringify(window.__downloads)'))
  check(await waitFor(`!${isOpen}`, 3000), `${name}: menu closes after choosing an item`)
  // A nested menu (Export… inside Layers) also closes its parent VMenu on item click (VMenu closeParents), as with the mouse.
  if (!nested) check(await waitFor(`document.activeElement === (${btn})`, 3000), `${name}: focus returns to the button after choosing an item`)
  await settled()
}

// #145: watch every animation frame throughout a state transition, not just the settled focus.
// Start only after an actionable element is focused: a new HTML document starts on body by definition.
const dualSwitch = `document.querySelector('#layers-panel .dual-switch input')`
const layersButton = `document.querySelector('button[aria-label="Layers"]')`
const layersVisible = `window.__vis(document.querySelector('#layers-panel'))`
const dualOn = `!!document.querySelector('#map-stage > .dual')`
async function observeFocus() {
  await evaluate(`window.__bodyFrames = 0; window.__observedFrames = 0; window.__watchFocus = true;
    (function frame() { if (!window.__watchFocus) return;
      window.__observedFrames++; if (document.activeElement === document.body) window.__bodyFrames++;
      requestAnimationFrame(frame);
    })()`)
}
async function focusCheck(label, expected) {
  await waitFor(`window.__observedFrames >= 30 && window.__settled() && (${expected})`, 5000)
  const result = await evaluate(`({ body: document.activeElement === document.body, frames: window.__bodyFrames,
    expected: ${expected}, active: document.activeElement?.outerHTML.slice(0, 180) })`)
  await evaluate('window.__watchFocus = false')
  check(!result.body && result.frames === 0, `${label}: never body (including transition frames)`, JSON.stringify(result))
  check(result.expected, `${label}: correct focus`, result.active)
}
async function openLayers() {
  if (!(await evaluate(layersVisible))) {
    await focusElement(layersButton)
    await press('Enter')
    await waitFor(layersVisible)
    await settled()
  }
}
async function toggleTo(on) {
  // Recovery/setup uses the real checkbox, never a store or a test-only app hook.
  await openLayers()
  await focusElement(dualSwitch)
  if ((await evaluate(dualOn)) !== on) { await press('Space'); await waitFor(`${dualOn} === ${on}`); await settled() }
}
async function changeUrl(on) {
  await evaluate(`(() => { const url = new URL(location.href);
    ${on ? "url.searchParams.set('dual', 'trees,risk')" : "url.searchParams.delete('dual')"};
    history.pushState(null, '', url); dispatchEvent(new PopStateEvent('popstate'));
  })()`)
}
async function dualFocusSuite(mobile) {
  // Each viewport starts independent of the preceding TractDetails selection.
  await evaluate(`localStorage.removeItem('ste-view')`).catch(() => {})
  await goto(`${BASE}?city=portland-or&metric=trees`)
  check(await waitFor(`!!document.querySelector('.maplibregl-canvas')`), 'Dual: map loaded')
  await settled()
  await openLayers()
  check(await evaluate(layersVisible), 'Layers: opens from the keyboard')
  if (mobile) check(await evaluate(`!!document.querySelector('.v-bottom-sheet.v-overlay--active #layers-panel')`), 'Layers: uses the 390px bottom sheet')
  await press('Escape')
  check(await waitFor(`!${layersVisible} && document.activeElement === (${layersButton})`), 'Layers: Escape closes surface and returns focus to its button')
  check(await evaluate('document.activeElement !== document.body'), 'Layers: focus is not body after closing')
  await openLayers()
  await toggleTo(false)
  await evaluate(`window.__originalToggle = (${dualSwitch}); window.__originalPanel = document.querySelector('#layers-panel')`)
  for (const on of [true, false]) {
    await observeFocus()
    await press('Space')
    check(await waitFor(`${dualOn} === ${on}`, 4000), `Dual toggle ${on ? 'ON' : 'OFF'}: Space changes view`)
    await focusCheck(`Dual toggle ${on ? 'ON' : 'OFF'}`, `document.activeElement === (${dualSwitch})`)
    check(await evaluate(`window.__originalToggle === (${dualSwitch}) && window.__originalPanel === document.querySelector('#layers-panel')`), 'Dual: toggle and its container are not remounted')
  }
  await press('Enter')
  check(await evaluate(`!${dualOn} && document.activeElement === (${dualSwitch})`), 'Dual: Enter does not toggle a checkbox (WAI-ARIA)')
  // d from the checkbox, then a persistent non-checkbox button: preserves focus in both cases.
  for (const target of [dualSwitch, `window.__btn('#layers-panel', 'Export…')`]) {
    for (const on of [true, false]) {
      await toggleTo(!on)
      await evaluate(`(${target}).focus(); window.__shortcutFocus = document.activeElement`)
      await observeFocus(); await press('d')
      check(await waitFor(`${dualOn} === ${on}`, 2000), `Dual shortcut ${on ? 'ON' : 'OFF'}: d changes view`)
      await focusCheck('Dual shortcut (surviving control)', 'document.activeElement === window.__shortcutFocus')
    }
  }
  // A readonly dual select is removed on exit: transfer focus BEFORE the subtree disappears.
  await toggleTo(true)
  await evaluate(`document.querySelector('.dual-left input').focus()`)
  await observeFocus(); await press('d')
  check(await waitFor(`!${dualOn}`, 2000), 'Dual shortcut OFF from select: changes view')
  await focusCheck('Dual shortcut OFF from select', `document.activeElement === (${dualSwitch})`)
  // The single/dual canvas is replaced too. d must not strand focus in the removed map.
  await toggleTo(false)
  await press('Escape'); await waitFor(`!${layersVisible}`); await settled()
  await evaluate(`document.querySelector('.maplibregl-canvas').focus()`)
  await observeFocus(); await press('d')
  check(await waitFor(dualOn, 2000), 'Dual shortcut ON from canvas: changes view')
  await focusCheck('Dual shortcut ON from removed canvas', `document.activeElement === (${dualSwitch})`)
  // URL/history changes use the same path. A surviving focus target stays put, selects return to toggle.
  for (const on of [true, false]) {
    await toggleTo(!on)
    await evaluate(`window.__btn('#layers-panel', 'Export…').focus(); window.__urlFocus = document.activeElement`)
    await observeFocus(); await changeUrl(on)
    check(await waitFor(`${dualOn} === ${on}`, 2000), `Dual URL ${on ? 'ON' : 'OFF'}: view follows ?dual=`)
    await focusCheck('Dual URL (surviving control)', 'document.activeElement === window.__urlFocus')
  }
  await toggleTo(true)
  for (const side of ['left', 'right']) {
    await toggleTo(true)
    await evaluate(`document.querySelector('.dual-${side} input').focus()`)
    await observeFocus(); await changeUrl(false)
    check(await waitFor(`!${dualOn}`, 2000), `Dual URL removal from ${side} select: exits dual`)
    await focusCheck(`Dual URL removal from ${side} select`, `document.activeElement === (${dualSwitch})`)
  }
  // Shared links are boot paths, not same-document transitions: check after pack/view restoration.
  await goto(`${BASE}?city=portland-or&metric=trees&dual=trees,risk`)
  check(await waitFor(dualOn), 'Dual URL boot: restores pair', await evaluate('location.href'))
  check(await waitFor('document.activeElement !== document.body', 2000), 'Dual URL boot: has an actionable focus target')
  await openLayers()
  check(await evaluate(`(${dualSwitch}).checked`), 'Dual URL boot: toggle is checked')
  await press('Escape'); await waitFor(`!${layersVisible}`); await settled()
  await focusElement(`document.querySelector('.maplibregl-canvas')`)
  await observeFocus(); await press('Escape')
  check(await waitFor(`!${dualOn}`, 2000), 'Dual Escape OFF from canvas: exits dual')
  await focusCheck('Dual Escape OFF from removed canvas', `document.activeElement === (${dualSwitch})`)
}

const dist = path.resolve('dist/index.html')
if (!existsSync(dist)) { console.error('dist/ missing: run `npm run build` first'); process.exit(1) }

const srv = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, PORT: String(PORT), BASE_PATH: '/' }, stdio: ['ignore', 'pipe', 'pipe'] })
let serverOutput = ''
let serverError = null
srv.stdout.on('data', (chunk) => { serverOutput += chunk })
srv.stderr.on('data', (chunk) => { serverOutput += chunk })
srv.on('error', (error) => { serverError = error })
let browser
try {
  // Never accidentally exercise somebody else's server when an explicit override collides.
  const deadline = Date.now() + 10000
  while (!serverOutput.includes('[server] Street Tree Equity') && !serverError && srv.exitCode === null && Date.now() < deadline) await sleep(100)
  if (!serverOutput.includes('[server] Street Tree Equity')) throw new Error(`Accessibility server failed on port ${PORT}: ${serverError?.message || serverOutput}`)
  browser = await launchChrome(findChrome(), { timeout: Number(process.env.A11Y_CHROME_TIMEOUT_MS || 30000) })
  cdp = await Cdp.connect(browser.webSocketUrl)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false })
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_HELPERS })

  async function section(label, fn) {
    try { await fn() } catch (e) { failed++; console.error(`ERROR in ${label}:`, e.message) }
  }

  // Keep the original #142 desktop assertions; repeat them unchanged at 390×844.
  for (const size of [{ width: 1400, height: 900, mobile: false }, { width: 390, height: 844, mobile: true }]) {
  viewport = `[${size.width}×${size.height}] `
  const before = { passed, failed }
  await cdp.send('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: 1 })
  await section('Dual focus', () => dualFocusSuite(size.mobile))

  // 1) Layers → Export… (nested inside the Layers VMenu on desktop)
  await section('Layers', async () => {
  await goto(`${BASE}?city=portland-or&metric=copd`)
  check(await waitFor(`!!document.querySelector('button[aria-label="Layers"]')`), 'Layers: button rendered')
  await waitFor(`!!document.querySelector('.maplibregl-canvas')`)
  await settled()
  await evaluate(`document.querySelector('button[aria-label="Layers"]').click()`)
  check(await waitFor(`window.__vis(window.__btn('#layers-panel', 'Export…'))`), 'Layers: Export… rendered')
  await settled()
  const exportBtn = `window.__btn('#layers-panel', 'Export…')`
  const layersOpen = `window.__vis(document.querySelector('#layers-panel'))`
  await menuButtonSuite('Layers Export…', { btn: exportBtn, menu: '#view-export-menu', stillOpen: layersOpen })
  await openLayers()
  await csvItemChecks('Layers Export…', { btn: exportBtn, menu: '#view-export-menu', csvIndex: 0, ariaPrefix: 'Download current-view CSV', nested: true })
  await settled()
  if (!(await evaluate(layersOpen))) {
    await evaluate(`document.querySelector('button[aria-label="Layers"]').click()`)
    await waitFor(layersOpen)
    await settled()
  }
  // Other plain buttons in the Layers panel take Enter too (same root cause).
  await evaluate(`window.__downloads.length = 0; window.__btn('#layers-panel', 'Export all tracts CSV').focus()`)
  await press('Enter')
  check(await waitFor('window.__downloads.length === 1', 3000), 'Layers: Enter activates a plain button inside the panel (Export all tracts CSV)')
  })

  // 2) TractDetails → Download…
  await section('TractDetails', async () => {
  await goto(`${BASE}?city=portland-or&metric=copd&geoid=41051007600`)
  check(await waitFor(`window.__vis(window.__btn('body', 'Download…'))`, 20000), 'TractDetails: Download… rendered')
  await settled()
  const dlBtn = `window.__btn('body', 'Download…')`
  check(await evaluate(`!(${dlBtn}).hasAttribute('aria-label')`), 'TractDetails Download…: accessible name stays its visible text')
  await menuButtonSuite('TractDetails Download…', { btn: dlBtn, menu: '#download-menu' })
  // The "Download data" tooltip on the activator still opens on focus alongside the menu props.
  await evaluate(`window.__btn('body', 'Copy summary').focus()`)
  await press('Tab', SHIFT)
  check(await evaluate(`document.activeElement === (${dlBtn})`), 'TractDetails Download…: reachable with Shift+Tab')
  check(await waitFor(`window.__tooltipShown('Download data')`, 3000), 'TractDetails Download…: "Download data" tooltip opens on focus')
  await csvItemChecks('TractDetails Download…', { btn: dlBtn, menu: '#download-menu', csvIndex: 2, ariaPrefix: 'Download current-view CSV' })
  })

  // 3) CompareCities → CSV (a plain button that downloads directly, not a menu)
  await section('CompareCities', async () => {
  await goto(`${BASE}?city=portland-or&metric=copd&compare=portland-or,tampa-fl`)
  const csvBtn = `[...document.querySelectorAll('#compare-panel button')].find((b) => b.querySelector('.v-btn__content')?.textContent.includes('CSV'))`
  check(await waitFor(`window.__vis(${csvBtn})`, 20000), 'CompareCities: CSV button rendered')
  await settled()
  check(await evaluate(`!(${csvBtn}).hasAttribute('aria-haspopup') && !(${csvBtn}).hasAttribute('aria-expanded')`),
    'CompareCities CSV: plain button, so no aria-haspopup/aria-expanded')
  check(await evaluate(`(${csvBtn}).getAttribute('aria-label')?.startsWith('Download compare-view CSV')`), 'CompareCities CSV: keeps its aria-label',
    await evaluate(`(${csvBtn}).getAttribute('aria-label')`))
  await evaluate(`[...document.querySelectorAll('#compare-panel button')].find((b) => b.textContent.includes('Copy comparison link')).focus()`)
  await press('Tab')
  check(await evaluate(`document.activeElement === (${csvBtn})`), 'CompareCities CSV: reachable with Tab')
  check(await waitFor(`window.__tooltipShown(${JSON.stringify(CSV_VIEW_TOOLTIP)})`, 3000), 'CompareCities CSV: #140 tooltip opens on focus')
  for (const key of ['Enter', 'Space']) {
    await evaluate(`window.__downloads.length = 0; (${csvBtn}).focus()`)
    await press(key)
    check(await waitFor('window.__downloads.length === 1', 3000), `CompareCities CSV: ${key} downloads`, await evaluate('JSON.stringify(window.__downloads)'))
    check(await evaluate(`document.activeElement === (${csvBtn})`), `CompareCities CSV: focus stays on the button after ${key}`)
    await settled()
  }
  await evaluate(`window.__downloads.length = 0; (${csvBtn}).focus()`)
  await press('ArrowDown')
  await settled()
  check(await evaluate('window.__downloads.length === 0'), 'CompareCities CSV: ArrowDown does nothing (no menu to open)')
  })
  console.log(`${viewport}${passed - before.passed} passed, ${failed - before.failed} failed`)
  }
} catch (e) {
  failed++
  console.error('ERROR', e)
} finally {
  try { cdp?.close() } catch { /* ignore */ }
  await browser?.close()
  srv.kill()
}
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)

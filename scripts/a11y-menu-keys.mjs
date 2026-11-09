#!/usr/bin/env node
// #142: headless keyboard test for the menu buttons (WAI-ARIA menu-button pattern).
//   npm run build && npm run test:a11y
// Zero dependencies: starts server/index.mjs (like test:smoke), launches a local Chrome/Chromium
// in headless mode and drives it over the DevTools protocol with Node's built-in WebSocket.
// Set CHROME_PATH to override the browser binary.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const PORT = Number(process.env.A11Y_PORT || 3125)
const DEBUG_PORT = Number(process.env.A11Y_DEBUG_PORT || 9325)
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

let passed = 0
let failed = 0
function check(ok, label, extra = '') {
  if (ok) passed++
  else failed++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${!ok && extra ? ` (${extra})` : ''}`)
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
  await cdp.send('Page.navigate', { url })
  await sleep(300)
  await waitFor('document.readyState === "complete"')
}

// Page-side helpers, installed on every document.
const PAGE_HELPERS = `
  window.__downloads = []
  const origClick = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__downloads.push(this.download); return } return origClick.call(this) }
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
    await evaluate(`(${btn}).focus()`)
    check(await evaluate(`(${btn}).getAttribute('aria-expanded') === 'false' && !${isOpen}`), `${name}: closed + aria-expanded="false" before ${key}`)
    await press(key)
    const focused = await waitFor(`document.activeElement === ${firstItem} && ${isOpen}`, 3000)
    check(focused, `${name}: ${key} opens the menu and focuses the first item`,
      await evaluate(`(document.activeElement?.className || '') + ' | ' + (document.activeElement?.textContent || '').trim().slice(0, 40)`))
    check(await evaluate(`(${btn}).getAttribute('aria-expanded') === 'true'`), `${name}: aria-expanded="true" after ${key}`)
    await press('Escape')
    const closed = await waitFor(`!${isOpen} && document.activeElement === (${btn})`, 3000)
    check(closed, `${name}: Escape after ${key} closes the menu and returns focus to the button`,
      await evaluate(`(document.activeElement?.textContent || '').trim().slice(0, 40)`))
    check(await evaluate(`(${btn}).getAttribute('aria-expanded') === 'false'`), `${name}: aria-expanded="false" after Escape`)
    if (stillOpen) check(await evaluate(stillOpen), `${name}: Escape closes only this menu, not its parent surface`)
    await sleep(150)
  }
  // Tab closes without trapping focus.
  await evaluate(`(${btn}).focus()`)
  await press('Enter')
  await waitFor(`document.activeElement === ${firstItem}`, 3000)
  const items = await evaluate(`document.querySelectorAll('${menu} .v-list-item').length`)
  for (let i = 0; i < items; i++) await press('Tab')
  check(await waitFor(`!${isOpen}`, 3000), `${name}: Tab moves out and closes the menu (no trap)`)
  check(await evaluate(`(${btn}).getAttribute('aria-expanded') === 'false'`), `${name}: aria-expanded="false" after Tab`)
  await sleep(300)
  return { firstItem, isOpen }
}

/** The #139/#140 current-view CSV item keeps its aria-label and shows the #140 tooltip on keyboard focus. */
async function csvItemChecks(name, { btn, menu, csvIndex, ariaPrefix, nested = false }) {
  const isOpen = `window.__vis(document.querySelector('${menu}'))`
  const item = `document.querySelectorAll('${menu} .v-list-item')[${csvIndex}]`
  await evaluate(`(${btn}).focus()`)
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
  await sleep(300)
}

const dist = path.resolve('dist/index.html')
if (!existsSync(dist)) { console.error('dist/ missing: run `npm run build` first'); process.exit(1) }

const srv = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, PORT: String(PORT), BASE_PATH: '/' }, stdio: ['ignore', 'ignore', 'inherit'] })
const profile = mkdtempSync(path.join(tmpdir(), 'ste-a11y-'))
const chrome = spawn(findChrome(), ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--no-default-browser-check', '--window-size=1400,900', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox',
  ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), 'about:blank'], { stdio: 'ignore' })

try {
  let pageWs = null
  for (let i = 0; i < 100 && !pageWs; i++) {
    await sleep(100)
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()
      pageWs = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? null
    } catch { /* not up yet */ }
  }
  if (!pageWs) throw new Error('Chrome DevTools endpoint did not come up')
  cdp = await Cdp.connect(pageWs)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false })
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_HELPERS })

  async function section(label, fn) {
    try { await fn() } catch (e) { failed++; console.error(`ERROR in ${label}:`, e.message) }
  }

  // 1) Layers → Export… (nested inside the Layers VMenu on desktop)
  await section('Layers', async () => {
  await goto(`${BASE}?city=portland-or&metric=copd`)
  check(await waitFor(`!!document.querySelector('button[aria-label="Layers"]')`), 'Layers: button rendered')
  await waitFor(`!!document.querySelector('.maplibregl-canvas')`)
  await sleep(1500)
  await evaluate(`document.querySelector('button[aria-label="Layers"]').click()`)
  check(await waitFor(`window.__vis(window.__btn('#layers-panel', 'Export…'))`), 'Layers: Export… rendered')
  await sleep(400)
  const exportBtn = `window.__btn('#layers-panel', 'Export…')`
  const layersOpen = `window.__vis(document.querySelector('#layers-panel'))`
  await menuButtonSuite('Layers Export…', { btn: exportBtn, menu: '#view-export-menu', stillOpen: layersOpen })
  await csvItemChecks('Layers Export…', { btn: exportBtn, menu: '#view-export-menu', csvIndex: 0, ariaPrefix: 'Download current-view CSV', nested: true })
  await sleep(400)
  if (!(await evaluate(layersOpen))) {
    await evaluate(`document.querySelector('button[aria-label="Layers"]').click()`)
    await waitFor(layersOpen)
    await sleep(400)
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
  await sleep(800)
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
  await sleep(600)
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
    await sleep(300)
  }
  await evaluate(`window.__downloads.length = 0; (${csvBtn}).focus()`)
  await press('ArrowDown')
  await sleep(500)
  check(await evaluate('window.__downloads.length === 0'), 'CompareCities CSV: ArrowDown does nothing (no menu to open)')
  })
} catch (e) {
  failed++
  console.error('ERROR', e)
} finally {
  try { cdp?.close() } catch { /* ignore */ }
  chrome.kill()
  srv.kill()
  await sleep(300)
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
}
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)

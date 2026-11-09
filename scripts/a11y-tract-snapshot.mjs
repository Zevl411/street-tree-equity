#!/usr/bin/env node
// #147: isolated snapshot browser, keyboard and state invariants; no new dependencies.
//   npm run build && npm run test:a11y:snapshot
// Zero dependencies: starts server/index.mjs (like test:smoke), launches a local Chrome/Chromium
// in headless mode and drives it over the DevTools protocol with Node's built-in WebSocket.
// Set CHROME_PATH to override the browser binary.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const PORT = Number(process.env.A11Y_PORT || 3147)
const DEBUG_PORT = Number(process.env.A11Y_DEBUG_PORT || 9347)
const BASE = `http://localhost:${PORT}/`
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
        const { res, rej, timer } = this.pending.get(msg.id)
        clearTimeout(timer)
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
    return new Promise((res, rej) => { const timer = setTimeout(() => { this.pending.delete(id); rej(new Error('CDP timed out: ' + method)) }, 30000); this.pending.set(id, { res, rej, timer }); this.ws.send(JSON.stringify({ id, method, params })) })
  }
  close() { for (const p of this.pending.values()) clearTimeout(p.timer); this.ws.close() }
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
  if (!await waitFor('document.readyState === "complete"')) throw new Error('Page did not finish loading')
}

// App-owned Vue/Pinia state is inspected only by this test, not exposed by production code.
// Controlled fixtures/transitions exercise data/mode cases without adding app debug APIs.
const HELPERS = `
window.__vis = el => !!el && el.isConnected && el.checkVisibility({visibilityProperty:true}) && el.getClientRects().length > 0
window.__stores = () => {
  const provides=document.querySelector('#app')?.__vue_app__?._context.provides
  if(!provides) return null
  const pinia=Reflect.ownKeys(provides).map(k=>provides[k]).find(x=>x?._s instanceof Map)
  return pinia ? {ui:pinia._s.get('ui'),city:pinia._s.get('city')} : null
}
window.__component = name => {
  const seen=new Set()
  function walk(v) {
    if(!v || typeof v!=='object' || seen.has(v)) return null
    seen.add(v)
    if(v.component?.type?.__name===name) return v.component
    if(v.component) { const c=walk(v.component.subTree); if(c) return c }
    if(v.suspense) { const c=walk(v.suspense.activeBranch); if(c) return c }
    if(Array.isArray(v.children)) for(const child of v.children) { const c=walk(child); if(c) return c }
    return null
  }
  return walk(document.querySelector('#app')?._vnode)
}
window.__button = id => document.querySelector('.tract-snapshot button[data-snapshot-metric="'+id+'"]')
window.__row = id => document.querySelector('.tract-snapshot [data-snapshot-metric="'+id+'"]')
window.__status = () => document.querySelector('.snapshot-status')?.textContent
window.__documentToken = Math.random()
window.__invariants = () => {
 const {ui,city}=window.__stores()
 const state={...ui.$state}; delete state.activeMetric
 const url=new URL(location.href); url.searchParams.delete('metric')
 const drawer=document.querySelector('#tract-details-panel')?.closest('.v-navigation-drawer__content')
 return {state:JSON.stringify(state), city:city.cityId, geoid:city.selectedGeoid, url:url.href,
   camera:localStorage.getItem('ste-view'), scroll:drawer?.scrollTop,
   history:history.length, document:window.__documentToken}
}
window.__installActions = () => {
 window.__actions=0; window.__messages=[]
 window.__stores().ui.$onAction(({name})=>{if(name==='setActiveMetric')window.__actions++})
 new MutationObserver(()=>{const text=window.__status(); if(text)window.__messages.push(text)}).observe(document.querySelector('.snapshot-status'),{childList:true,subtree:true,characterData:true})
}
window.__stableCamera = () => {
 const now=localStorage.getItem('ste-view')
 if(now!==window.__lastCamera) {window.__lastCamera=now;window.__cameraSince=Date.now();return false}
 return Date.now()-(window.__cameraSince||Date.now())>1600
}
`
const section = '.tract-snapshot'
const miami = `${BASE}?city=central-miami-fl&geoid=12086002404&metric=copd&audit=keep&layers=parks,roads&unit=acre`
const miamiIds = ['income','diabetes','physicalHealth']
async function ready(url) {
  await goto(url)
  if(!await waitFor(`window.__vis(document.querySelector('${section}')) && !!window.__stores()?.ui`,25000)) throw new Error('Snapshot did not render')
  await waitFor(`window.__stableCamera()`,10000)
  // Wait until native drawer transition has completed before point-based mouse input.
  await waitFor(`!document.querySelector('.v-navigation-drawer--is-booting')`)
}
async function focus(id) {
  await evaluate(`window.__button(${JSON.stringify(id)}).scrollIntoView({block:'nearest'});window.__button(${JSON.stringify(id)}).focus({preventScroll:true})`)
  if(!await waitFor(`document.activeElement===window.__button(${JSON.stringify(id)})`)) throw new Error('Button did not focus')
}
async function mouse(id) {
  const point=await evaluate(`(()=>{const r=window.__button(${JSON.stringify(id)}).getBoundingClientRect();return {x:r.x+r.width/2,y:Math.max(1,Math.min(innerHeight-1,r.y+r.height/2))}})()`)
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point})
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point})
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point})
}
async function activate(id, key, label) {
  await focus(id)
  await evaluate(`window.__activated=window.__button(${JSON.stringify(id)});window.__canvas=document.querySelector('.maplibregl-canvas')`)
  const before=await evaluate('window.__invariants()'), actions=await evaluate('window.__actions'), messages=await evaluate('window.__messages.length')
  if(key==='Mouse') await mouse(id); else await press(key)
  check(await waitFor(`window.__stores().ui.activeMetric===${JSON.stringify(id)} && window.__status()===${JSON.stringify('Map now showing '+label)} && document.activeElement===window.__activated`),`${key} ${id}: metric + exact polite status + same focus`)
  const after=await evaluate('window.__invariants()')
  check(JSON.stringify(before)===JSON.stringify(after),`${key} ${id}: city, geoid, camera session, scroll, share flags, history and document unchanged`,JSON.stringify({before,after}))
  check(await evaluate(`window.__activated.isConnected && window.__activated===window.__button(${JSON.stringify(id)}) && window.__canvas===document.querySelector('.maplibregl-canvas')`),`${key} ${id}: button and map canvas not remounted`)
  check(await evaluate(`window.__actions===${actions+1} && window.__messages.length===${messages+1}`),`${key} ${id}: one native activation, one success announcement`)
  check(await evaluate(`document.querySelectorAll('${section} [aria-current="true"]').length===1 && window.__button(${JSON.stringify(id)}).getAttribute('aria-current')==='true' && window.__button(${JSON.stringify(id)}).textContent.includes('On map')`),`${key} ${id}: unique aria-current + check/On map marker`)
  check(await evaluate(`window.__stores().ui.metric.id===${JSON.stringify(id)} && ( ${id==='canopy'?'true':"JSON.stringify(window.__component('MapView').props.meta.breaks)===JSON.stringify(window.__component('MapView').props.meta.metricBreaks["+JSON.stringify(id)+"])"} ) && new URL(location.href).searchParams.get('metric')===${id==='canopy'?'null':JSON.stringify(id)}`),`${key} ${id}: canonical metric URL${id==='canopy'?' clears default':''}`)
}
async function semantics(name) {
  const info=await evaluate(`(()=>{
    const s=document.querySelector('${section}'),ol=s.querySelector('ol'), rows=[...ol.children], status=s.querySelector('.snapshot-status')
    return {heading:s.getAttribute('aria-labelledby')==='tract-snapshot-heading' && s.querySelector('h3').textContent==='Community-need snapshot',
      ids:rows.map(li=>li.querySelector('button')?.dataset.snapshotMetric),
      native:rows.every(li=>li.tagName==='LI' && li.children.length===1 && li.firstElementChild.tagName==='BUTTON' && li.firstElementChild.type==='button'),
      names:[...s.querySelectorAll('button')].map(b=>b.getAttribute('aria-label')),
      lines:rows.map(li=>[li.querySelector('.snapshot-line1').textContent,li.querySelector('.snapshot-line2').textContent]),
      trees:!ol.contains(s.querySelector('.snapshot-trees')),
      zero:s.querySelector('.snapshot-trees .snapshot-line1').textContent,
      tie:s.querySelector('.snapshot-trees .snapshot-line2').textContent,
      mapping:s.querySelector('.snapshot-mapping-note').textContent,
      status:status.getAttribute('role')==='status' && status.getAttribute('aria-live')==='polite' && status.getAttribute('aria-atomic')==='true' && status.textContent==='',
      current:s.querySelectorAll('[aria-current]').length,
      help:s.querySelector('details').open,
      wrong:s.querySelectorAll('[role="menu"],[role="listbox"],[role="option"],[aria-selected],[aria-pressed]').length,
      overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth || s.scrollWidth>s.clientWidth,
      sizes:[...s.querySelectorAll('button')].every(b=>b.getBoundingClientRect().height>=64),
      summary:s.querySelector('summary').getBoundingClientRect().height>=44, helpGap:getComputedStyle(s.querySelector('details')).marginBottom}
  })()`)
  check(info.heading && info.native && JSON.stringify(info.ids)===JSON.stringify(miamiIds),`${name}: labelled section + ordered direct li/native buttons + rank order`)
  check(JSON.stringify(info.lines)===JSON.stringify([
    ['Income · $19,394','Lower than all 151 other tracts in Miami'],
    ['Diabetes · 28.9% · model estimate','Higher than all 151 other tracts in Miami'],
    ['Physical health · 24.9% · model estimate','Higher than all 151 other tracts in Miami'],
  ]),`${name}: exact Miami value/model/directional strings`)
  check(info.names[0]==='Switch map to Income, lower than all 151 other tracts in Miami, $19,394' && info.names[1]==='Switch map to Diabetes, higher than all 151 other tracts in Miami, 28.9%, model estimate',`${name}: meaningful action names convey values and models`)
  check(info.trees && info.zero==='Tree canopy · 10.5% of land' && info.tie==='More tree canopy than 69% of other tracts in Miami',`${name}: separate measured-canopy context, never numbered fourth`)
  check(info.mapping==='USFS satellite-based canopy estimate for 2025; open water excluded. Ties count halfway. Small or scattered urban canopy can be underestimated.',`${name}: measured-canopy helper always visible`)
  check(info.status && !info.help && info.current===0 && info.wrong===0,`${name}: empty persistent polite status, collapsed help, outside-shortlist metric has no current item`)
  check(info.helpGap==='8px',`${name}: Designer-locked collapsed help gap is 8px`)
  check(!info.overflow && info.sizes && info.summary,`${name}: no horizontal overflow; >=64px multiline buttons and >=44px summary`)
}
async function dualSuite() {
  await focus('income')
  await evaluate('window.__stores().ui.setDualView(true)')
  check(await waitFor(`!document.querySelector('${section} button') && document.activeElement===document.querySelector('#tract-snapshot-heading') && window.__status()==='Dual view is on. Turn off dual view to switch the map from here.'`),'dual controlled focus-repair: disappearing button -> heading + exact one-off status')
  check(await evaluate(`(()=>{const s=document.querySelector('${section}');return s.querySelectorAll('ol > li').length===3 && s.querySelector('.snapshot-dual-note').textContent==='Turn off dual view to switch the map from here.' && !s.querySelector('[role="button"],a,[aria-current],[aria-label^="Switch map"],.snapshot-marker,[tabindex]:not(h3)') && [...s.querySelectorAll('[data-snapshot-metric]')].every(r=>!r.onclick && !r.hasAttribute('tabindex'))})()`),'dual: same ol/li text + note; no action roles, click handlers, tabindex, aria-current or On map')
  await waitFor(`window.__stableCamera()`)
  const before=await evaluate(`({invariants:window.__invariants(),active:window.__stores().ui.activeMetric,dual:[window.__stores().ui.dualView,window.__stores().ui.dualLeft,window.__stores().ui.dualRight,window.__stores().ui.dualPrimary]})`)
  await evaluate(`window.__row('income').click();window.__row('canopy').click()`)
  const after=await evaluate(`({invariants:window.__invariants(),active:window.__stores().ui.activeMetric,dual:[window.__stores().ui.dualView,window.__stores().ui.dualLeft,window.__stores().ui.dualRight,window.__stores().ui.dualPrimary]})`)
  check(JSON.stringify(before)===JSON.stringify(after),'dual plain text activation leaves URL, metric, both panes, selection and all four dual fields untouched')
  await evaluate(`document.querySelector('#map-stage').focus();window.__stores().ui.setDualView(false)`)
  check(await waitFor(`!!window.__button('canopy') && document.activeElement===document.querySelector('#map-stage')`),'dual-off restores actual single-map current state without stealing focus')
  await evaluate(`document.querySelector('#map-stage').focus();window.__outside=document.activeElement;window.__oldStatus=window.__status();window.__stores().ui.setDualView(true)`)
  check(await waitFor(`!document.querySelector('${section} button') && document.activeElement===window.__outside && window.__status()===window.__oldStatus`),'ordinary dual-on with focus elsewhere neither steals focus nor duplicates local announcement')
  // Exit through the existing Layers control; no app menu/dual source changes.
  await evaluate(`document.querySelector('button[aria-label="Layers"]').click()`)
  if(!await waitFor(`!!document.querySelector('#layers-panel .v-switch input')`)) throw new Error('Existing dual control did not render')
  await evaluate(`window.__dualControl=[...document.querySelectorAll('#layers-panel .v-switch')].find(s=>s.textContent.includes('Dual view')).querySelector('input');window.__dualControl.click()`)
  check(await waitFor(`!window.__stores().ui.dualView && !!window.__button('canopy')`),'existing Dual view control returns to single buttons')
  await press('Escape')
  check(await evaluate(`window.__button('canopy').getAttribute('aria-current')==='true'`),'single return preserves the actual activeMetric, not a hidden snapshot selection')
}
async function controlledStates() {
  if(!await evaluate(`!!window.__component('TractDetails')`)) throw new Error('Vue test fixture seam not found')
  await evaluate(`window.__details=window.__component('TractDetails');window.__originalIndex=window.__details.props.snapshotIndex;window.__baseResult=window.__originalIndex.select(window.__stores().city.selectedGeoid)`)
  const cases=[
    [2,23,'insufficient','Only 2 measures here are higher-need than most other tracts in Miami.'],
    [0,23,'missing','No measures here stand out as higher-need than most other tracts in Miami.'],
    [0,23,'mostly-water','No measures here stand out as higher-need than most other tracts in Miami.'],
    [0,0,'insufficient',"There isn't enough data to compare this tract. Each measure needs data for at least 10 tracts."],
  ]
  for(const [count,eligible,reason,message] of cases) {
    await evaluate(`window.__details.props.snapshotIndex={...window.__originalIndex,select:()=>({...window.__baseResult,worst:window.__baseResult.worst.slice(0,${count}),eligibleCount:${eligible},canopy:null,canopyUnavailable:${JSON.stringify(reason)}})}`)
    check(await waitFor(`document.querySelector('.snapshot-few')?.textContent===${JSON.stringify(message)} && document.querySelectorAll('${section} ol > li').length===${count}`),`controlled ${count}/${eligible}: exact few/empty/insufficient copy, no fabricated ranks`)
    check(await evaluate(`!document.querySelector('.snapshot-trees button') && document.querySelector('.snapshot-trees-unavailable')?.textContent===${JSON.stringify(reason==='missing'?'Tree-canopy comparison unavailable for this tract.':reason==='mostly-water'?'Mostly water — no canopy estimate':'Not enough tree-canopy data to compare this tract (10 tracts needed).')} && !!document.querySelector('.snapshot-mapping-note')`),`controlled ${reason}: trees fallback is plain text, helper remains visible`)
  }
  await evaluate('window.__details.props.snapshotIndex=window.__originalIndex')
  check(await waitFor(`document.querySelectorAll('${section} ol > li').length===3`),'controlled fixtures restore the real selected pack')
}
async function contrast(name) {
  await focus('income'); await press('Tab',SHIFT); await press('Tab')
  const values=await evaluate(`(()=>{
    const b=window.__button('income'),css=getComputedStyle(b),surface=getComputedStyle(document.querySelector('#tract-details-panel')).backgroundColor
    function rgb(s){return (s.match(/[0-9.]+/g)||[]).map(Number)}
    function blend(f,b){return f.slice(0,3).map((v,i)=>v*(f[3]??1)+b[i]*(1-(f[3]??1)))}
    function lum(c){const a=c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return .2126*a[0]+.7152*a[1]+.0722*a[2]}
    function ratio(a,b){return (Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05)}
    const bg=blend(rgb(css.backgroundColor),rgb(surface)),text=rgb(css.color),border=blend(rgb(css.borderTopColor),bg),outline=rgb(css.outlineColor)
    const current=getComputedStyle(window.__button('canopy')),currentBg=blend(rgb(current.backgroundColor),rgb(surface))
    const currentBorder=blend(rgb(current.borderTopColor),currentBg)
    return {text:ratio(text,bg),border:ratio(border,bg),focus:ratio(outline,bg),currentText:ratio(rgb(current.color),currentBg),currentBorder:ratio(currentBorder,currentBg),currentFocus:ratio(outline,currentBg),width:css.outlineWidth,offset:css.outlineOffset,style:css.outlineStyle,whiteSpace:getComputedStyle(b.querySelector('.v-btn__content')).whiteSpace}
  })()`)
  check(values.text>=4.5 && values.border>=3 && values.focus>=3 && values.currentText>=4.5 && values.currentBorder>=3 && values.currentFocus>=3,`${name}: computed text/border/focus contrast meets thresholds`,JSON.stringify(values))
  check(values.width==='2px' && values.offset==='2px' && values.style==='solid' && values.whiteSpace==='normal',`${name}: keyboard focus ring 2px/2px and wrapping content`,JSON.stringify(values))
}


// #148 real, native browser downloads; compare EVERY parsed cell with source-driven pure exports.
function parseCsv(csv) {
 const rows=[];let row=[],field='',quoted=false
 for(let i=0;i<csv.length;i++){const c=csv[i];if(c==='"'){if(quoted&&csv[i+1]==='"'){field+='"';i++}else quoted=!quoted}
 else if(c===','&&!quoted){row.push(field);field=''}else if((c==='\r'||c==='\n')&&!quoted){if(c==='\r'&&csv[i+1]==='\n')i++;row.push(field);rows.push(row);row=[];field=''}else field+=c}
 if(field||row.length){row.push(field);rows.push(row)}return rows
}
async function canopyDownloads() {
 await ready(miami.replace('metric=copd','metric=canopy'))
 const dir=mkdtempSync(path.join(tmpdir(),'ste-canopy148-downloads-'))
 await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:dir})
 await evaluate(`window.__originalClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download)window.__lastDownload=this.download;return window.__originalClick.call(this)}`)
 async function download(label) {
  await evaluate(`window.__lastDownload=null;[...document.querySelectorAll('#tract-details-panel button')].find(b=>b.textContent.includes('Download…')).click()`)
  if(!await waitFor(`window.__vis(document.querySelector('#download-menu'))`))throw Error('Download menu did not open')
  await evaluate(`[...document.querySelectorAll('#download-menu .v-list-item')].find(x=>x.textContent.trim()===${JSON.stringify(label)}).click()`)
  if(!await waitFor(`!!window.__lastDownload`))throw Error('No native download started')
  const file=path.join(dir,await evaluate('window.__lastDownload'));let done=false
  for(let i=0;i<100;i++){if(existsSync(file)){done=true;break}await sleep(100)}
  if(!done)throw Error('Native download missing: '+file)
  return readFileSync(file,'utf8')
 }
 const {toCsv,fullCsvHeaders}=await import('../src/utils/fullCsv.ts')
 const {toCurrentViewCsv}=await import('../src/utils/currentViewCsv.ts')
 const fc=JSON.parse(readFileSync('public/data/central-miami-fl/tracts-equity.geojson','utf8'))
 const meta=JSON.parse(readFileSync('public/data/central-miami-fl/meta.json','utf8'))
 const full=parseCsv(await download('All tracts in this city (CSV)'))
 check(full[0].length===fullCsvHeaders().length&&full.every(r=>r.length===fullCsvHeaders().length)&&JSON.stringify(full)===JSON.stringify(parseCsv(toCsv(fc.features.map(f=>f.properties),meta))),`Miami actual full CSV: all ${fc.features.length} rows / ${fullCsvHeaders().length} columns match every source-driven cell`)
 const text=await download('CSV – current view (Tree canopy)'), current=parseCsv(text.split(/\r?\n/).filter(l=>!l.startsWith('#')).join('\r\n'))
 const expected=parseCsv(toCurrentViewCsv({rows:fc.features.map(f=>({cityId:'central-miami-fl',meta,props:f.properties})),metrics:['canopy'],unit:'acre',comments:[]}))
 check(JSON.stringify(current)===JSON.stringify(expected),'Miami actual current-view CSV: all 152 rows match every cell; canopy and mapped-density context separate')
 check(text.includes('2025 map year')&&text.includes('Collection 1.2')&&text.includes('USDA Forest Service. 2026')&&text.includes('U.S. Geological Survey (USGS), 2024'),'Actual current-view download includes both pinned source citations')
 const geo=JSON.parse(await download('All tracts (GeoJSON)'))
 check(geo.features.length===152&&geo.features.every((f,i)=>JSON.stringify(f.geometry)===JSON.stringify(fc.features[i].geometry)&&f.properties.canopy_pct===fc.features[i].properties.canopyPct&&f.properties.plant_need_canopy===fc.features[i].properties.plantNeedParts.T&&!('plant_need_trees'in f.properties)),'Miami actual GeoJSON: all geometry and new canopy/component values match, retired key absent')
 for(const [raw,metric]of [['trees','trees'],['shade','canopy'],['unknown','canopy'],['canopy','canopy']]){
  await ready(miami.replace('metric=copd','metric='+raw))
  check(await evaluate(`window.__stores().ui.activeMetric===${JSON.stringify(metric)} && window.__stores().city.selectedGeoid==='12086002404'`),'URL '+raw+': correct metric, same tract')
  await evaluate(`navigator.clipboard.writeText=async text=>{window.__copied=text};document.querySelector('[aria-label="Copy link to this tract"]').click()`)
  check(await waitFor(`window.__copied && new URL(window.__copied).searchParams.get('metric')===${metric==='canopy'?'null':"'trees'"} && new URL(window.__copied).searchParams.get('audit')==='keep' && new URL(window.__copied).searchParams.get('geoid')==='12086002404'`),'Copied '+metric+' link: correct canonical metric and unrelated flags retained')
 }
 await ready(miami+'&dual=trees,risk')
 await evaluate(`navigator.clipboard.writeText=async text=>{window.__copied=text};document.querySelector('[aria-label="Copy link to this tract"]').click()`)
 check(await waitFor(`window.__copied && new URL(window.__copied).searchParams.get('dual')==='trees,risk'`),'Copied tract link preserves explicit dual trees/risk without changing dual encoding or defaults')
}

if(!existsSync(path.resolve('dist/index.html'))) throw new Error('Build first')
const srv=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,PORT:String(PORT),BASE_PATH:'/'},stdio:['ignore','ignore','inherit']})
const profile=mkdtempSync(path.join(tmpdir(),'ste-snapshot-a11y-'))
const chrome=spawn(findChrome(),['--headless=new',`--remote-debugging-port=${DEBUG_PORT}`,`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--window-size=1400,900','--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox',...(process.getuid?.()===0?['--no-sandbox']:[]),'about:blank'],{stdio:'ignore'})
try {
  let ws=null
  for(let i=0;i<100 && !ws;i++) {
    try {const targets=await(await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();ws=targets.find(t=>t.type==='page')?.webSocketDebuggerUrl}catch{}
    if(!ws) await sleep(100)
  }
  if(!ws) throw new Error('Chrome did not start')
  cdp=await Cdp.connect(ws)
  await cdp.send('Page.enable');await cdp.send('Runtime.enable')
  await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:HELPERS})
  for(const width of [1400,390]) for(const theme of ['light','dark']) {
    const name=`${width}px ${theme}`
    console.log(`\n${name}`)
    await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:900,deviceScaleFactor:1,mobile:false})
    await ready(`${miami}&theme=${theme}`)
    await semantics(name)
    await evaluate('window.__installActions()')
    await evaluate(`document.querySelector('${section} summary').scrollIntoView({block:'nearest'});document.querySelector('${section} summary').focus()`)
    await press('Enter')
    check(await waitFor(`document.querySelector('${section} details').open`),`${name}: native summary Enter expands explanation`)
    await press('Enter');await press('Tab')
    check(await waitFor(`document.activeElement===window.__button('income')`),`${name}: native Tab moves summary -> first ranked button`)
    await press('Tab');await press('Tab',SHIFT)
    check(await evaluate(`document.activeElement===window.__button('income')`),`${name}: Tab/Shift+Tab follow ranked order`)
    await activate('income','Mouse','Income')
    await activate('diabetes','Enter','Diabetes')
    await activate('physicalHealth','Space','Physical health')
    await activate('physicalHealth','Space','Physical health') // idempotent current item
    await activate('canopy','Enter','Tree canopy')
    await contrast(name)
    if(process.env.A11Y_SNAPSHOT_SCREENSHOTS) {
      await evaluate(`document.querySelector('${section}').scrollIntoView({block:'start'})`)
      mkdirSync(process.env.A11Y_SNAPSHOT_SCREENSHOTS,{recursive:true})
      const shot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})
      writeFileSync(path.join(process.env.A11Y_SNAPSHOT_SCREENSHOTS,`snapshot-${width}-${theme}.png`),Buffer.from(shot.data,'base64'))
    }
    const link=await evaluate('location.href')
    await ready(link)
    check(await evaluate(`window.__stores().city.selectedGeoid==='12086002404' && window.__stores().ui.activeMetric==='canopy' && window.__button('canopy').getAttribute('aria-current')==='true'`),`${name}: reload canonical link restores tract/metric`)
    if(theme==='light') await dualSuite()
    if(width===1400 && theme==='dark') await controlledStates()
    // 200% zoom-equivalent CSS viewport, same single-column layout; no horizontal overflow.
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:Math.floor(width/2),height:width===390?422:450,deviceScaleFactor:2,mobile:false})
    check(await waitFor(`document.documentElement.scrollWidth<=document.documentElement.clientWidth && document.querySelector('${section}').scrollWidth<=document.querySelector('${section}').clientWidth`),`${name}: 200%-equivalent reflow stays single-column without horizontal overflow`)
    await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:900,deviceScaleFactor:1,mobile:false})
    await focus('income');await press('Escape')
    check(await waitFor(`!window.__stores().city.selectedGeoid`),`${name}: Escape retains existing drawer-close behavior`)
  }
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1400,height:900,deviceScaleFactor:1,mobile:false})
  await ready(`${BASE}?city=orlando-fl&geoid=12095010201&metric=copd`)
  check(await evaluate(`document.querySelectorAll('${section} ol>li').length===1 && document.querySelector('.snapshot-few').textContent==='Only 1 measure here is higher-need than most other tracts in Orlando.' && window.__row('groceries').querySelector('.snapshot-line1').textContent==='No grocery stores mapped' && window.__row('canopy').querySelector('.snapshot-line1').textContent==='Tree canopy · 14.6% of land' && !document.querySelector('${section} [aria-current]')`),'real Orlando: one honest floor-passing grocery item + canopy context; outside current has no arbitrary marker')
  await ready(`${miami}&compare=central-miami-fl,orlando-fl`)
  check(await waitFor(`window.__vis(document.querySelector('#compare-panel'))`),'Compare modal opens over existing selected-city drawer')
  await evaluate(`document.querySelector('#compare-panel .compare-close').focus()`)
  for(let i=0;i<10;i++) {await press('Tab');check(await evaluate(`!!document.activeElement.closest('#compare-panel')`),'Compare native focus trap keeps underlying snapshot unreachable')}
  await evaluate(`document.querySelector('#compare-panel .compare-close').click()`)
  check(await waitFor(`!window.__vis(document.querySelector('#compare-panel')) && window.__stores().city.selectedGeoid==='12086002404' && window.__row('income')?.textContent.includes('$19,394')`),'Compare close leaves snapshot using Miami pack only, not pooled comparison data')
  await evaluate('window.__installActions()')
  await activate('income','Enter','Income')
  await canopyDownloads()
} catch(e) {failed++;console.error('ERROR',e.stack||e.message)} finally {
  try{cdp?.close()}catch{}
  chrome.kill();srv.kill()
  await new Promise(resolve=>chrome.exitCode!==null?resolve():chrome.once('exit',resolve))
  try{rmSync(profile,{recursive:true,force:true})}catch{}
}
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed?1:0)

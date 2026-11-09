#!/usr/bin/env node
// #149: isolated canopy-gap browser, keyboard and state invariants; no new dependencies.
//   npm run build && npm run test:a11y:snapshot
// Zero dependencies: starts server/index.mjs (like test:smoke), launches a local Chrome/Chromium
// in headless mode and drives it over the DevTools protocol with Node's built-in WebSocket.
// Set CHROME_PATH to override the browser binary.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const PORT = Number(process.env.A11Y_PORT || 3149)
const DEBUG_PORT = Number(process.env.A11Y_DEBUG_PORT || 9349)
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
const GAP_HELPERS = `
window.__tractPosts=[]
const originalWorkerPost=Worker.prototype.postMessage
Worker.prototype.postMessage=function(message,...rest){
 try {if(message?.data?.source==='tracts'&&message.data.data?.features){const f=message.data.data.features.find(f=>f.properties.geoid==='12086002404')||message.data.data.features[0];window.__tractPosts.push({map:message.sourceMapId,props:f.properties})}}catch{}
 return originalWorkerPost.call(this,message,...rest)
}
window.__gapInput=()=>document.querySelector('.canopy-gap-target input')
window.__gapStatus=()=>document.querySelector('.canopy-gap-status')?.textContent
window.__gapInvariant=()=>{const {ui,city}=window.__stores(),state={...ui.$state};delete state.canopyGapTarget;const q=new URL(location.href);q.searchParams.delete('gapTarget');const drawer=document.querySelector('#tract-details-panel')?.closest('.v-navigation-drawer__content');return{state:JSON.stringify(state),url:q.href,city:city.cityId,geoid:city.selectedGeoid,camera:localStorage.getItem('ste-view'),scroll:drawer?.scrollTop,history:history.length}}
window.__gapObserve=()=>{window.__gapActions=0;window.__gapMessages=[];window.__stores().ui.$onAction(({name})=>{if(name==='setCanopyGapTarget')window.__gapActions++});new MutationObserver(()=>{const text=window.__gapStatus();if(text)window.__gapMessages.push(text)}).observe(document.querySelector('.canopy-gap-status'),{childList:true,subtree:true,characterData:true})}
`
const URL_MIAMI=`${BASE}?city=central-miami-fl&geoid=12086002404&metric=canopyGap&audit=keep&layers=parks,roads&unit=acre`
async function ready(url=URL_MIAMI) {
 await goto(url)
 if(!await waitFor(`!!window.__stores()?.ui && window.__vis(document.querySelector('.canopy-gap-detail'))`,25000))throw Error('Canopy-gap details did not render')
 await waitFor('window.__stableCamera()',10000)
 await waitFor('!document.querySelector(".v-navigation-drawer--is-booting")')
}
async function layers(){await evaluate(`document.querySelector('button[aria-label="Layers"]').click()`);if(!await waitFor('window.__vis(window.__gapInput()) && window.__gapInput().closest(".v-selection-control").getBoundingClientRect().height>=43.99'))throw Error('Canopy-gap target input not visible')}
async function mouse(selector){const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const b=e.getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2}})()`);await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p})}
async function semantics(name){
 const info=await evaluate(`(()=>{const input=window.__gapInput(),d=document.getElementById(input.getAttribute('aria-describedby')),label=document.querySelector('.canopy-gap-target label'),row=input.closest('.v-selection-control');return {name:label.textContent,checked:input.checked,description:d?.textContent,inputs:document.querySelectorAll('.canopy-gap-target input').length,row:row.getBoundingClientRect().height,label:label.getBoundingClientRect().height,role:input.getAttribute('role'),status:window.__gapStatus()}})()`)
 check(info.name==='Use a fixed 30% target'&&info.inputs===1&&!info.checked&&info.row>=44&&info.label>=44,`${name}: one native, correctly named unchecked VSwitch and >=44px labelled touch row`,JSON.stringify(info))
 check(info.description==="Target: 11.1% canopy — your city's leafier neighborhoods (75th percentile of tract estimates in this pack)."&&info.status==='',`${name}: visible stable input description, empty persistent status on restore`,JSON.stringify(info))
 const ax=await cdp.send('Accessibility.getFullAXTree'),controls=ax.nodes.filter(n=>n.name?.value==='Use a fixed 30% target'&&['switch','checkbox'].includes(n.role?.value))
 check(controls.length===1&&controls[0].properties.some(p=>p.name==='checked'&&['false',false].includes(p.value.value)),`${name}: accessibility tree has one named boolean control, no duplicate wrapper state`)
 await evaluate(`window.__gapObserve();window.__originalInput=window.__gapInput();window.__originalCanvas=document.querySelector('canvas.maplibregl-canvas');window.__originalIndex=window.__component('TractDetails').props.snapshotIndex;window.__originalRows=JSON.stringify([...document.querySelectorAll('.snapshot-list li')].map(x=>x.textContent));window.__originalCanopy=window.__component('TractDetails').props.tract.canopyPct;window.__originalPlantNeed=window.__component('TractDetails').props.tract.plantNeed;window.__gapInput().focus()`)
 await press('Tab');await press('Tab',SHIFT)
 check(await evaluate('document.activeElement===window.__gapInput()'),`${name}: native Tab/Shift+Tab returns to input`)
 const before=await evaluate('window.__gapInvariant()')
 await press('Space')
 check(await waitFor(`window.__gapInput()?.checked && window.__gapStatus()==='Canopy-gap target set to 30% canopy.' && document.querySelector('.snapshot-gap')?.textContent==='About 44 acres of canopy short of the 30% canopy target'`),`${name}: Space toggles once; fixed target/details/snapshot update together`)
 check(await waitFor(`window.__tractPosts.at(-1)?.props.canopyTargetMode==='30' && window.__tractPosts.at(-1)?.props.canopyGapAcres===44.236558284870476`),`${name}: actual MapLibre worker receives the fixed-scenario tract data`)
 check(await evaluate(`document.activeElement===window.__originalInput && window.__originalInput.isConnected && window.__gapActions===1 && JSON.stringify(window.__gapMessages)===JSON.stringify(['Canopy-gap target set to 30% canopy.'])`),`${name}: same connected focus and one exact live announcement after fixed view updates`)
 check(JSON.stringify(before)===JSON.stringify(await evaluate('window.__gapInvariant()')),`${name}: target leaves camera/GEOID/scroll/history/metric/dual/unit/overlays unchanged`)
 check(await evaluate(`window.__originalCanvas===document.querySelector('canvas.maplibregl-canvas') && window.__component('TractDetails').props.snapshotIndex===window.__originalIndex && window.__originalRows===JSON.stringify([...document.querySelectorAll('.snapshot-list li')].map(x=>x.textContent)) && window.__originalCanopy===window.__component('TractDetails').props.tract.canopyPct && window.__originalPlantNeed===window.__component('TractDetails').props.tract.plantNeed`),`${name}: no map remount, rank-index rebuild, shortlist/canopy/Planting-need change`)
 check(await evaluate(`new URL(location.href).searchParams.get('gapTarget')==='30' && document.getElementById('canopy-gap-target-description').textContent==='Target: 30% canopy — a fixed comparison, not an official recommendation.'`),`${name}: URL and fixed comparison description agree`)
 await press('Enter')
 check(await evaluate(`window.__gapInput().checked && window.__gapActions===1 && window.__vis(document.querySelector('#layers-panel'))`),`${name}: Enter harmless, no shim/unrelated action/panel close`)
 await mouse('.canopy-gap-target label')
 check(await waitFor(`!window.__gapInput().checked && window.__gapActions===2 && window.__gapStatus()==="Canopy-gap target set to 11.1% canopy: your city's leafier neighborhoods." && document.querySelector('.snapshot-gap').textContent==="About 2 acres of canopy short of the city's leafier neighborhoods"`),`${name}: label click returns once to city p75 and exact context`)
 check(await evaluate(`document.activeElement===window.__originalInput && window.__gapMessages.length===2 && !new URL(location.href).searchParams.has('gapTarget')`),`${name}: p75 focus retained, one additional announcement, canonical URL omits default`)
 await evaluate(`window.__component('CanopyGapTarget').emit('change','p75')`)
 check(await evaluate(`window.__gapActions===2 && window.__gapMessages.length===2`),`${name}: idempotent target event is quiet`)
 await press('Tab');await press('Tab',SHIFT)
 const contrast=await evaluate(`(()=>{const e=document.querySelector('.canopy-gap-target'),bg=getComputedStyle(document.querySelector('#layers-panel')).backgroundColor,label=getComputedStyle(e.querySelector('label')),helper=getComputedStyle(e.querySelector('p')),row=getComputedStyle(e.querySelector('.v-selection-control')),track=getComputedStyle(e.querySelector('.v-switch__track'));function rgb(s){return(s.match(/[0-9.]+/g)||[]).map(Number)}function lum(c){const a=c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return.2126*a[0]+.7152*a[1]+.0722*a[2]}function ratio(a,b){return(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05)}return{label:ratio(rgb(label.color),rgb(bg)),helper:ratio(rgb(helper.color),rgb(bg)),focus:ratio(rgb(row.outlineColor),rgb(bg)),control:ratio(rgb(track.backgroundColor),rgb(bg)),opacity:label.opacity,trackOpacity:track.opacity,width:row.outlineWidth,offset:row.outlineOffset}})()`)
 check(contrast.label>=4.5&&contrast.helper>=4.5&&contrast.focus>=3&&contrast.control>=3&&contrast.opacity==='1'&&contrast.trackOpacity==='1',`${name}: measured label/helper/focus/control contrast`,JSON.stringify(contrast))
 check(contrast.width==='2px'&&contrast.offset==='2px',`${name}: visible 2px/2px keyboard focus ring`,JSON.stringify(contrast))
 check(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1 && document.querySelector('.canopy-gap-target').scrollWidth<=document.querySelector('.canopy-gap-target').clientWidth+1`),`${name}: target/helper wrap without horizontal scrolling`)
 await press('Escape')
 await evaluate(`if(!document.querySelector('.legend'))document.querySelector('#tract-details-panel .tract-close')?.click()`);await waitFor(`!!document.querySelector('.map-legend-box')`);await evaluate(`if(!document.querySelector('.legend'))document.querySelector('.map-legend-box .legend-toggle')?.click()`);await waitFor(`!!document.querySelector('.legend')`)
 check(await evaluate(`document.querySelectorAll('.legend').length>0 && [...document.querySelectorAll('.legend')].some(e=>e.textContent.includes("Target: 11.1% canopy · city's leafier neighborhoods")&&e.textContent.includes('0 acres = At or above target.'))`),`${name}: legend shows active target, acres and zero/larger-tract meaning`)
}
function parseCsv(csv){const rows=[];let row=[],field='',quoted=false;for(let i=0;i<csv.length;i++){const c=csv[i];if(c==='"'){if(quoted&&csv[i+1]==='"'){field+='"';i++}else quoted=!quoted}else if(c===','&&!quoted){row.push(field);field=''}else if((c==='\r'||c==='\n')&&!quoted){if(c==='\r'&&csv[i+1]==='\n')i++;row.push(field);rows.push(row);row=[];field=''}else field+=c}if(field||row.length){row.push(field);rows.push(row)}return rows}
const csvBody=t=>parseCsv(t.split(/\r?\n/).filter(l=>!l.startsWith('#')).join('\r\n'))
const downloads=mkdtempSync(path.join(tmpdir(),'ste-gap149-downloads-'))
async function installDownloads(){await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});await evaluate(`if(!window.__originalClick){window.__originalClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){window.__lastDownload=this.download;this.download=Date.now()+'-'+this.download;window.__lastDownload=this.download}return window.__originalClick.call(this)}}`)}
async function nativeDownload(action){await evaluate('window.__lastDownload=null');await action();if(!await waitFor('!!window.__lastDownload'))throw Error('No native download');const file=path.join(downloads,await evaluate('window.__lastDownload'));for(let i=0;i<100;i++){if(existsSync(file))return readFileSync(file,'utf8');await sleep(100)}throw Error('Download missing: '+file)}
async function tractDownload(label){return nativeDownload(async()=>{await evaluate(`[...document.querySelectorAll('#tract-details-panel button')].find(b=>b.textContent.includes('Download…')).click()`);if(!await waitFor(`window.__vis(document.querySelector('#download-menu'))`))throw Error('Download menu closed');await evaluate(`[...document.querySelectorAll('#download-menu .v-list-item')].find(x=>x.textContent.trim()===${JSON.stringify(label)}).click()`)})}
async function allDownloads(){
 const {toCsv,fullCsvHeaders}=await import('../src/utils/fullCsv.ts'),{toCurrentViewCsv}=await import('../src/utils/currentViewCsv.ts'),{gapValues}=await import('../src/utils/canopyGap.ts')
 const fc=JSON.parse(readFileSync('public/data/central-miami-fl/tracts-equity.geojson','utf8')),meta=JSON.parse(readFileSync('public/data/central-miami-fl/meta.json','utf8'))
 for(const mode of ['p75','30']){
 await ready(URL_MIAMI+(mode==='30'?'&gapTarget=30':''));await installDownloads()
 const full=parseCsv(await tractDownload('All tracts in this city (CSV)'))
 check(full[0].length===fullCsvHeaders().length&&full.every(r=>r.length===fullCsvHeaders().length)&&JSON.stringify(full)===JSON.stringify(parseCsv(toCsv(fc.features.map(f=>f.properties),meta,mode))),`${mode}: native full CSV all${fc.features.length} rows/${fullCsvHeaders().length} columns preserve every source and scenario cell`)
 const text=await tractDownload('CSV – current view (Canopy gap (acres))'),current=csvBody(text),expected=csvBody(toCurrentViewCsv({rows:fc.features.map(f=>({cityId:'central-miami-fl',meta,props:f.properties})),metrics:['canopyGap'],unit:'acre',gapTarget:mode,comments:[]}))
 check(current[0].length===14&&current.every(r=>r.length===14)&&JSON.stringify(current)===JSON.stringify(expected),`${mode}: native current CSV all152 rows/14 columns, raw context vs1dp metric, acres units`)
 check(text.includes('Collection 1.2')&&text.includes('v2025-6')&&text.includes('plant_need_canopy: relative low-canopy score (0–100)')&&(mode!=='30'||text.includes('gapTarget=30')),`${mode}: native current preamble retains both sources, target/share URL and independent component meaning`)
 const geo=JSON.parse(await tractDownload('All tracts (GeoJSON)')),target=mode==='30'?30:meta.canopyGap.p75
 check(geo.features.length===152&&geo.features.every((f,i)=>{const p=fc.features[i].properties,g=gapValues(p,target);return JSON.stringify(f.geometry)===JSON.stringify(fc.features[i].geometry)&&f.properties.canopy_target_mode===mode&&f.properties.land_acres===p.landAcres&&f.properties.canopy_target_pct===target&&f.properties.canopy_gap_pct===g.canopyGapPct&&f.properties.canopy_gap_acres===g.canopyGapAcres&&f.properties.plant_need_canopy===p.plantNeedParts.T}),`${mode}: native GeoJSON all geometry, land/scenario/unchanged Planting need keys correct`)
 await layers()
 const slim=csvBody(await nativeDownload(()=>evaluate(`document.querySelector('[aria-label="Export all tracts CSV"]').click()`)))
 check(slim[0].length===13&&slim.slice(1).every(r=>r.length===13&&r[slim[0].indexOf('canopy_target_mode')]===mode&&Number(r[slim[0].indexOf('canopy_target_pct')])===target),`${mode}: Layers all-tract CSV preserves its eight honest OSM fields plus five scenario fields`)
 const layerView=csvBody(await nativeDownload(async()=>{await evaluate(`[...document.querySelectorAll('#layers-panel button')].find(b=>b.textContent.includes('Export…')).click()`);await waitFor(`window.__vis(document.querySelector('#view-export-menu'))`);await evaluate(`document.querySelector('#view-export-menu .v-list-item').click()`)}))
 check(JSON.stringify(layerView)===JSON.stringify(expected),`${mode}: actual Layers and Details current-view downloads agree on every cell`)
 }
 await ready(URL_MIAMI.replace('metric=canopyGap','metric=trees')+'&dual=trees,canopyGap&gapTarget=30');await installDownloads()
 check(await evaluate(`window.__stores().ui.dualView&&window.__stores().ui.dualPrimary==='left'&&window.__stores().ui.activeMetric==='trees'`),'dual gap non-primary pane retains original left primary and metric')
 await layers();check(await evaluate('window.__vis(window.__gapInput())&&window.__gapInput().checked'),'target remains available when canopyGap is only non-primary dual pane')
 await press('Escape')
 const dual=csvBody(await tractDownload('CSV – current view (Mapped street trees (OSM))'))
 check(dual[0].length===18&&dual.slice(1).every(r=>r.length===18&&r[dual[0].indexOf('metric_a_id')]==='trees'&&r[dual[0].indexOf('metric_b_id')]==='canopyGap'&&r[dual[0].indexOf('metric_b_unit')]==='acres'&&r[dual[0].indexOf('canopy_target_mode')]==='30'),'native dual CSV: scenario context once, two honest active groups, every row/header parity')
 await ready(URL_MIAMI+'&compare=central-miami-fl,orlando-fl');await installDownloads()
 if(!await waitFor(`window.__vis(document.querySelector('#compare-panel'))&&!!document.querySelector('#compare-panel [aria-label^="Download compare-view CSV"]')`,25000))throw Error('Compare did not derive results')
 await evaluate(`window.__compareFetches=0;window.__oldFetch=window.fetch;window.fetch=function(...args){window.__compareFetches++;return window.__oldFetch.apply(this,args)}`)
 for(const mode of ['p75','30']){await evaluate(`window.__stores().ui.setCanopyGapTarget(${JSON.stringify(mode)})`);await waitFor(`window.__stores().ui.canopyGapTarget===${JSON.stringify(mode)}`);const text=await nativeDownload(()=>evaluate(`document.querySelector('#compare-panel [aria-label^="Download compare-view CSV"]').click()`)),rows=csvBody(text),h=rows[0],orlando=JSON.parse(readFileSync('public/data/orlando-fl/meta.json','utf8'))
 check(h.length===16&&rows.length===196&&rows.every(r=>r.length===16)&&rows.slice(1).every(r=>r[h.indexOf('canopy_target_mode')]===mode&&Number(r[h.indexOf('canopy_target_pct')])===(mode==='30'?30:r[h.indexOf('city_id')]==='central-miami-fl'?meta.canopyGap.p75:orlando.canopyGap.p75)),`${mode}: native Compare196 rows includes each pack's own unpooled target and header/cell parity`)
 }
 check(await evaluate('window.__compareFetches===0'),'Compare mode changes reuse already loaded packs without fetches')
 await press('Escape')
}
async function contexts(){
 await ready(URL_MIAMI+'&gapTarget=30');check(await evaluate(`window.__stores().ui.canopyGapTarget==='30'&&window.__gapStatus()===''`),'fixed URL restore is quiet')
 await evaluate(`navigator.clipboard.writeText=async text=>{window.__copied=text};document.querySelector('[aria-label="Copy link to this tract"]').click()`)
 check(await waitFor(`window.__copied&&new URL(window.__copied).searchParams.get('gapTarget')==='30'&&new URL(window.__copied).searchParams.get('audit')==='keep'`),'actual copied tract link round-trips fixed mode and unrelated flags')
 await evaluate(`window.__stores().ui.setActiveMetric('trees')`)
 check(await waitFor(`new URL(location.href).searchParams.get('metric')==='trees'&&new URL(location.href).searchParams.get('gapTarget')==='30'`),'hidden target retained when another metric is selected; actual URL sync includes metric')
 await evaluate(`window.__component('PlacePicker').emit('select','orlando-fl')`)
 check(await waitFor(`window.__component('MapView')?.props.meta.cityName?.includes('Orlando') && window.__component('MapView')?.props.meta.canopyGapTarget?.target===30`,25000),'city change loads its own pack and retains fixed target quietly')
 await evaluate(`window.__stores().ui.setCanopyGapTarget('p75');window.__stores().city.select('12095010201')`)
 check(await waitFor(`window.__component('TractDetails')?.props.meta.canopyGapTarget?.target===20.69223154579695 && document.querySelector('.snapshot-gap')?.textContent==="About 13 acres of canopy short of the city's leafier neighborhoods" && window.__gapStatus()===''`),'new city recalculates its own p75; restoration and city transitions do not announce a user target switch')
 await ready(URL_MIAMI)
 check(await evaluate(`window.__stores().ui.canopyGapTarget==='p75'&&window.__gapStatus()===''&&!Object.keys(localStorage).some(k=>/gap.?target/i.test(k))`),'fresh bare scenario defaults p75, no persisted target preference')
 await evaluate(`const url=new URL(location.href);url.searchParams.set('gapTarget','30');history.replaceState(history.state,'',url);dispatchEvent(new PopStateEvent('popstate'))`)
 check(await waitFor(`window.__stores().ui.canopyGapTarget==='30'&&window.__gapStatus()===''&&document.querySelector('.snapshot-gap')?.textContent==='About 44 acres of canopy short of the 30% canopy target'`),'popstate restores fixed target and derived details quietly without a user announcement')
 const fixtures=[
  [{canopyPct:30,canopyStatus:'ok',landAcres:10},'0 acres','At or above target'],
  [{canopyPct:29.999,canopyStatus:'ok',landAcres:1},'<0.1 acres short of target',null],
  [{canopyPct:null,canopyStatus:'mostly-water',landAcres:0},'Mostly water — no canopy-gap estimate',null],
  [{canopyPct:null,canopyStatus:'missing',landAcres:null},'Canopy gap unavailable — canopy estimate missing',null],
  [{canopyPct:10,canopyStatus:'ok',landAcres:null},'Canopy gap unavailable — land area missing',null],
 ]
 await evaluate(`window.__stores().ui.setCanopyGapTarget('30');window.__details=window.__component('TractDetails');window.__sourceTract=window.__details.props.tract`)
 for(const [props,text,status]of fixtures){await evaluate(`window.__details.props.tract={...window.__sourceTract,...${JSON.stringify(props)}}`);check(await waitFor(`document.querySelector('.canopy-gap-detail').textContent.includes(${JSON.stringify(text)})`),'controlled fixture exact value/reason: '+text);if(status)check(await evaluate(`document.querySelector('.canopy-gap-detail').textContent.includes('At or above target')&&!document.querySelector('.snapshot-gap')`),'zero status explicit and snapshot sentence omitted');else if(props.landAcres===null||props.canopyStatus!=='ok')check(await evaluate(`!document.querySelector('.snapshot-gap')&&!document.querySelector('.canopy-gap-detail').textContent.includes('At or above target')`),'missing/water never becomes zero/At or above target')}
 await evaluate(`window.__details.props.tract=window.__sourceTract;window.__legend=window.__component('MapLegend');window.__legendTracts=window.__legend.props.tracts;window.__legend.props.tracts={...window.__legendTracts,features:window.__legendTracts.features.map((f,i)=>i?f:{...f,properties:{...f.properties,canopyGapAcres:null}})}`)
 check(await waitFor(`document.querySelector('.legend').textContent.includes('No canopy-gap estimate')`),'controlled null legend has a labelled neutral swatch distinct from valid zero')
 await evaluate(`window.__legend.props.tracts=window.__legendTracts`)
}
// Hold a real pack request to exercise App's pending props and preserve the same native input.
async function pendingTarget(){
 await ready(URL_MIAMI)
 // Let the existing drawer-close focus contract finish before testing target-control focus.
 await evaluate(`window.__stores().city.select(null)`)
 if(!await waitFor(`document.activeElement?.id==='map-stage'`))throw Error('Drawer-close focus did not settle')
 await layers()
 await evaluate(`window.__gapObserve();window.__pendingInput=window.__gapInput();window.__pendingInput.focus();window.__realPendingFetch=window.fetch;window.fetch=async function(...args){if(String(args[0]).includes('/orlando-fl/meta.json')){window.__packHeld=true;await new Promise(resolve=>window.__releasePack=resolve)}return window.__realPendingFetch.apply(this,args)};window.__component('PlacePicker').emit('select','orlando-fl')`)
 check(await waitFor(`window.__packHeld&&window.__component('CanopyGapTarget')?.props.loading===true&&document.getElementById('canopy-gap-target-description')?.textContent==='Loading canopy-gap estimate…'`),'pending pack shows the locked loading copy through App loading props')
 check(await evaluate(`!document.getElementById('canopy-gap-target-description').textContent.includes('City target unavailable')&&window.__gapStatus()===''`),'pending pack never renders or announces a completed-unavailable target')
 await press('Space')
 check(await waitFor(`window.__gapInput().checked&&document.getElementById('canopy-gap-target-description').textContent==='Loading canopy-gap estimate…'`),'fixed-mode control still toggles normally while the pack is pending')
 await press('Space')
 check(await waitFor(`!window.__gapInput().checked&&document.getElementById('canopy-gap-target-description').textContent==='Loading canopy-gap estimate…'&&window.__gapActions===2`),'p75 control still toggles normally without misclassifying pending data')
 check(await evaluate(`document.activeElement===window.__pendingInput&&window.__pendingInput.isConnected&&window.__gapMessages.length===0&&window.__gapStatus()===''`),'pending target changes preserve the same focus and never announce unavailable')
 await evaluate(`window.fetch=window.__realPendingFetch;window.__releasePack()`)
 check(await waitFor(`window.__component('CanopyGapTarget')?.props.loading===false&&document.getElementById('canopy-gap-target-description')?.textContent==="Target: 20.7% canopy — your city's leafier neighborhoods (75th percentile of tract estimates in this pack)."`,25000),'completed valid pack replaces loading copy with its own city target')
 check(await evaluate(`document.activeElement===window.__pendingInput&&window.__pendingInput.isConnected&&window.__gapMessages.length===0`),'completion keeps target input focus and remains quiet')
 await evaluate(`window.__pendingTarget=window.__component('CanopyGapTarget');window.__loadedTarget=window.__pendingTarget.props.target;window.__pendingTarget.props.target=null`)
 check(await waitFor(`document.getElementById('canopy-gap-target-description')?.textContent==='City target unavailable. Use a fixed 30% target to choose a comparison.'&&!document.getElementById('canopy-gap-target-description').textContent.includes('Loading canopy-gap estimate')`),'completed-empty target retains exact unavailable copy, never loading copy')
 await evaluate(`window.__pendingTarget.props.target=window.__loadedTarget`)
}
// #150: exercise the locked depression row/copy, shared source, registry control and snapshot action.
async function depressionUI(){
 const {getTractSnapshotIndex}=await import('../src/utils/tractSnapshot.ts')
 const {DEPRESSION_METHODS,placesMetricCitation}=await import('../src/utils/placesMeasures.ts')
 const fc=JSON.parse(readFileSync('public/data/central-miami-fl/tracts-equity.geojson','utf8')),meta=JSON.parse(readFileSync('public/data/central-miami-fl/meta.json','utf8'))
 const caption='Lifetime history, not necessarily current depression. Mental health (MHLTH) measures 14+ days of poor mental health in the past 30 days.'
 const url=URL_MIAMI.replace('metric=canopyGap','metric=depression')
 for(const width of [1400,390])for(const mode of ['light','dark','contrast']){
  const name=`depression ${width}px ${mode}`
  await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:900,deviceScaleFactor:1,mobile:false})
  await ready(url+'&theme='+(mode==='dark'?'dark':'light')+(mode==='contrast'?'&hc=1':''))
  check(await evaluate(`document.querySelector('.depression-detail')?.textContent==='Adults ever told they had a depressive disorder · 14.1% (95% CI 11.8–16.4) · model estimate'&&document.querySelector('.depression-caption')?.textContent===${JSON.stringify(caption)}`),`${name}: exact lifetime row, 95% CI/model marker and readable MHLTH distinction`)
  check(await evaluate(`(!document.querySelector('.legend')||document.querySelector('.legend').textContent.includes('Adults ever told they had a depressive disorder'))&&document.documentElement.scrollWidth<=innerWidth+1&&[document.querySelector('.depression-detail'),document.querySelector('.depression-detail .v-list-subheader__text'),document.querySelector('.depression-caption'),document.querySelector('.legend')].filter(Boolean).every(e=>e.scrollWidth<=e.clientWidth+1)`),`${name}: exact legend and long text wrap without horizontal overflow`)
  const contrast=await evaluate(`(()=>{const e=document.querySelector('.depression-detail'),bg=getComputedStyle(e).getPropertyValue('--v-theme-surface').split(',').map(Number),fg=(getComputedStyle(e).color.match(/[0-9.]+/g)||[]).map(Number),alpha=fg[3]??1;const rgb=fg.slice(0,3).map((v,i)=>v*alpha+bg[i]*(1-alpha));function lum(c){const a=c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return.2126*a[0]+.7152*a[1]+.0722*a[2]}return(Math.max(lum(rgb),lum(bg))+.05)/(Math.min(lum(rgb),lum(bg))+.05)})()`)
  check(contrast>=4.5,`${name}: measured normal-text contrast >=4.5`,String(contrast))
  if(process.env.A11Y_SCREENSHOT_DIR){
   await evaluate(`document.querySelector('.depression-caption').scrollIntoView({block:'center'})`)
   const dir=path.resolve(process.env.A11Y_SCREENSHOT_DIR);mkdirSync(dir,{recursive:true});const shot=await cdp.send('Page.captureScreenshot',{format:'png'});writeFileSync(path.join(dir,`depression-${width}-${mode}.png`),Buffer.from(shot.data,'base64'))
  }
  await evaluate(`document.querySelector('button[aria-label="Layers"]').click()`)
  if(!await waitFor(`window.__vis(document.querySelector('#layers-panel'))`))throw Error('Layers did not open')
  check(await evaluate(`(()=>{const b=[...document.querySelectorAll('#layers-panel button')].find(b=>b.textContent.trim()==='Depression history'),labels=[...b.parentElement.children].filter(e=>e.tagName==='BUTTON').map(e=>e.textContent.trim()),i=labels.indexOf('Depression history');window.__depressionControl=b;return labels.length===32&&labels[i-1]==='Mental health'&&labels[i+1]==='Physical health'&&!b.disabled})()`),`${name}: one enabled native option immediately after MHLTH, 32 locked options`)
  await evaluate(`window.__stores().ui.setActiveMetric('mentalHealth');window.__depressionControl.focus()`)
  await press('Space')
  check(await waitFor(`window.__stores().ui.activeMetric==='depression'&&document.activeElement===window.__depressionControl&&window.__depressionControl.isConnected`),`${name}: native Space selects depression and retains same connected focus`)
  await press('Escape')
  if(width===390){
   // Existing mobile design hides the legend while details are open: close the drawer first.
   await evaluate(`document.querySelector('#tract-details-panel .tract-close').click()`)
   if(!await waitFor(`window.__vis(document.querySelector('.map-legend-box'))`))throw Error('Mobile legend box did not return')
   if(!await evaluate(`!!document.querySelector('.legend')`))await evaluate(`document.querySelector('.map-legend-box .legend-toggle').click()`)
   check(await waitFor(`document.querySelector('.legend')?.textContent.includes('Adults ever told they had a depressive disorder')&&document.querySelector('.legend').scrollWidth<=document.querySelector('.legend').clientWidth+1&&document.documentElement.scrollWidth<=innerWidth+1`),`${name}: mobile legend opens in its existing no-drawer context with exact wrapped title`)
  }
  await cdp.send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'h',code:'KeyH',windowsVirtualKeyCode:72})
  await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'h',code:'KeyH',windowsVirtualKeyCode:72})
  check(await waitFor(`window.__vis(document.querySelector('#hotspots-panel'))&&document.querySelector('#hotspots-panel .v-card-title').textContent.includes('Highest share reporting a depression history')&&document.querySelector('#hotspots-panel .v-card-title').scrollWidth<=document.querySelector('#hotspots-panel .v-card-title').clientWidth+1`),`${name}: existing Hotspots action shows the exact untruncated wrapped title`)
  await press('Escape')
 }
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1400,height:900,deviceScaleFactor:1,mobile:false});await ready(url);await installDownloads()
 const current=csvBody(await tractDownload('CSV – current view (Depression history)')),h=current[0],r=current.find(r=>r[h.indexOf('geoid')]==='12086002404')
 check(h.length===16&&current.every(r=>r.length===16)&&r[h.indexOf('metric_value')]==='14.1'&&r[h.indexOf('metric_ci_lo')]==='11.8'&&r[h.indexOf('metric_ci_hi')]==='16.4', 'depression: actual current-view native download has 16 aligned columns and exact check CI')
 const geo=JSON.parse(await tractDownload('All tracts (GeoJSON)'))
 check(geo.features.length===152&&geo.features.every((f,i)=>['pct_depression','pct_depression_ci_lo','pct_depression_ci_hi'].every((k,j)=>f.properties[k]===fc.features[i].properties[['pctDepression','pctDepressionLo','pctDepressionHi'][j]])),'depression: native GeoJSON includes all152 numeric source triples')
 await evaluate(`navigator.clipboard.writeText=async text=>window.__depressionCitations=text;document.querySelector('button[aria-label="About"]').click()`)
 check(await waitFor(`window.__vis(document.querySelector('.about-sources'))&&document.querySelector('.about-sources').textContent.includes(${JSON.stringify(placesMetricCitation('depression',meta.cdcPlaces.years))})&&document.querySelector('.about-sources').textContent.includes(${JSON.stringify(DEPRESSION_METHODS)})`),'depression: About renders the shared 2023 source and exact methods distinction')
 await evaluate(`[...document.querySelectorAll('.v-overlay--active button')].find(b=>b.textContent.trim()==='Copy citations').click()`)
 check(await waitFor(`window.__depressionCitations?.includes(${JSON.stringify(DEPRESSION_METHODS)})&&window.__depressionCitations.includes(${JSON.stringify(placesMetricCitation('depression',meta.cdcPlaces.years))})`),'depression: actual Copy citations reuses the exact source year and methods text')
 await press('Escape')
 await evaluate(`window.__depressionDetails=window.__component('TractDetails');window.__depressionOriginal=window.__depressionDetails.props.tract`)
 for(const [props,expected]of [[{pctDepression:0,pctDepressionLo:0,pctDepressionHi:0},'Adults ever told they had a depressive disorder · 0.0% (95% CI 0.0–0.0) · model estimate'],[{pctDepression:14.1,pctDepressionLo:null,pctDepressionHi:null},'Adults ever told they had a depressive disorder · 14.1% · model estimate']]){
  await evaluate(`window.__depressionDetails.props.tract={...window.__depressionOriginal,...${JSON.stringify(props)}}`)
  check(await waitFor(`document.querySelector('.depression-detail')?.textContent===${JSON.stringify(expected)}`),'depression controlled zero/missing-CI exact copy: '+expected)
 }
 await evaluate(`window.__depressionDetails.props.tract={...window.__depressionOriginal,pctDepression:null}`)
 check(await waitFor(`!document.querySelector('.depression-detail')&&!document.querySelector('.depression-caption')&&document.querySelector('#tract-details-panel').textContent.includes('No depression-history estimate for this tract')`),'depression null omits routine row/caption, never zero-fills; exact active no-data text')
 await evaluate(`window.__depressionDetails.props.tract=window.__depressionOriginal`)
 const index=getTractSnapshotIndex(fc,meta),winner=fc.features.find(f=>index.select(f.properties.geoid)?.worst.some(s=>s.metricId==='depression'))
 if(!winner)throw Error('No real depression snapshot winner found')
 await evaluate(`window.__stores().ui.setActiveMetric('copd');window.__stores().city.select(${JSON.stringify(winner.properties.geoid)})`)
 if(!await waitFor(`!!document.querySelector('button[data-snapshot-metric="depression"]')`))throw Error('Depression snapshot winner did not render')
 await evaluate(`window.__depSnapshot=document.querySelector('button[data-snapshot-metric="depression"]');window.__depSnapshot.scrollIntoView({block:'center'});window.__depSnapshot.focus();window.__depCanvas=document.querySelector('canvas.maplibregl-canvas')`)
 await press('Space')
 check(await waitFor(`window.__stores().ui.activeMetric==='depression'&&window.__status()==='Map now showing Depression history'&&document.activeElement===window.__depSnapshot&&window.__depSnapshot.isConnected`),'depression real snapshot winner: native Space, exact polite status and same connected focus')
 check(await evaluate(`window.__depSnapshot.textContent.includes('model estimate')&&document.querySelector('canvas.maplibregl-canvas')===window.__depCanvas&&window.__depSnapshot.getAttribute('aria-current')==='true'`),'depression snapshot model/current marker retained without map remount')
 await evaluate(`window.__stores().ui.setDualView(true)`)
 check(await waitFor(`!document.querySelector('button[data-snapshot-metric="depression"]')&&document.querySelector('[data-snapshot-metric="depression"]')?.tagName==='DIV'`),'depression snapshot remains noninteractive plain text in dual mode')
}
async function generalHealthUI(){
 const {getTractSnapshotIndex}=await import('../src/utils/tractSnapshot.ts')
 const {GHLTH_METHODS,placesMetricCitation}=await import('../src/utils/placesMeasures.ts')
 const fc=JSON.parse(readFileSync('public/data/central-miami-fl/tracts-equity.geojson','utf8')),meta=JSON.parse(readFileSync('public/data/central-miami-fl/meta.json','utf8'))
 const caption='Self-rated overall health, not an objective health assessment. Physical health (PHLTH) measures 14+ days of poor physical health in the past 30 days.'
 const url=URL_MIAMI.replace('metric=canopyGap','metric=generalHealth')
 for(const width of [1400,390])for(const mode of ['light','dark','contrast']){
  const name=`generalHealth ${width}px ${mode}`
  await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:900,deviceScaleFactor:1,mobile:false})
  await ready(url+'&theme='+(mode==='dark'?'dark':'light')+(mode==='contrast'?'&hc=1':''))
  check(await evaluate(`document.querySelector('.general-health-detail')?.textContent==='Adults rating their overall health as fair or poor · 44.8% (95% CI 39.2–50.7) · model estimate'&&document.querySelector('.general-health-caption')?.textContent===${JSON.stringify(caption)}`),`${name}: exact self-rated row, 95% CI/model marker and readable PHLTH distinction`)
  check(await evaluate(`(!document.querySelector('.legend')||document.querySelector('.legend').textContent.includes('Adults rating their overall health as fair or poor'))&&document.documentElement.scrollWidth<=innerWidth+1&&[document.querySelector('.general-health-detail'),document.querySelector('.general-health-detail .v-list-subheader__text'),document.querySelector('.general-health-caption'),document.querySelector('.legend')].filter(Boolean).every(e=>e.scrollWidth<=e.clientWidth+1)`),`${name}: exact legend and long text wrap without horizontal overflow`)
  const contrast=await evaluate(`(()=>{const e=document.querySelector('.general-health-detail'),bg=getComputedStyle(e).getPropertyValue('--v-theme-surface').split(',').map(Number),fg=(getComputedStyle(e).color.match(/[0-9.]+/g)||[]).map(Number),alpha=fg[3]??1;const rgb=fg.slice(0,3).map((v,i)=>v*alpha+bg[i]*(1-alpha));function lum(c){const a=c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return.2126*a[0]+.7152*a[1]+.0722*a[2]}return(Math.max(lum(rgb),lum(bg))+.05)/(Math.min(lum(rgb),lum(bg))+.05)})()`)
  check(contrast>=4.5,`${name}: measured normal-text contrast >=4.5`,String(contrast))
  if(process.env.A11Y_SCREENSHOT_DIR){
   await evaluate(`document.querySelector('.general-health-caption').scrollIntoView({block:'center'})`)
   const dir=path.resolve(process.env.A11Y_SCREENSHOT_DIR);mkdirSync(dir,{recursive:true});const shot=await cdp.send('Page.captureScreenshot',{format:'png'});writeFileSync(path.join(dir,`generalHealth-${width}-${mode}.png`),Buffer.from(shot.data,'base64'))
  }
  await evaluate(`document.querySelector('button[aria-label="Layers"]').click()`)
  if(!await waitFor(`window.__vis(document.querySelector('#layers-panel'))`))throw Error('Layers did not open')
  check(await evaluate(`(()=>{const b=[...document.querySelectorAll('#layers-panel button')].find(b=>b.textContent.trim()==='Fair or poor health'),labels=[...b.parentElement.children].filter(e=>e.tagName==='BUTTON').map(e=>e.textContent.trim()),i=labels.indexOf('Fair or poor health');window.__generalHealthControl=b;return labels.length===32&&labels[i-1]==='Physical health'&&labels[i+1]==='Blood pressure'&&!b.disabled})()`),`${name}: one enabled native option immediately after PHLTH, 32 locked options`)
  await evaluate(`window.__stores().ui.setActiveMetric('physicalHealth');window.__generalHealthControl.focus()`)
  await press('Space')
  check(await waitFor(`window.__stores().ui.activeMetric==='generalHealth'&&document.activeElement===window.__generalHealthControl&&window.__generalHealthControl.isConnected`),`${name}: native Space selects generalHealth and retains same connected focus`)
  await press('Escape')
  if(width===390){
   // Existing mobile design hides the legend while details are open: close the drawer first.
   await evaluate(`document.querySelector('#tract-details-panel .tract-close').click()`)
   if(!await waitFor(`window.__vis(document.querySelector('.map-legend-box'))`))throw Error('Mobile legend box did not return')
   if(!await evaluate(`!!document.querySelector('.legend')`))await evaluate(`document.querySelector('.map-legend-box .legend-toggle').click()`)
   check(await waitFor(`document.querySelector('.legend')?.textContent.includes('Adults rating their overall health as fair or poor')&&document.querySelector('.legend').scrollWidth<=document.querySelector('.legend').clientWidth+1&&document.documentElement.scrollWidth<=innerWidth+1`),`${name}: mobile legend opens in its existing no-drawer context with exact wrapped title`)
  }
  await cdp.send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'h',code:'KeyH',windowsVirtualKeyCode:72})
  await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'h',code:'KeyH',windowsVirtualKeyCode:72})
  check(await waitFor(`window.__vis(document.querySelector('#hotspots-panel'))&&document.querySelector('#hotspots-panel .v-card-title').textContent.includes('Highest share rating overall health as fair or poor')&&document.querySelector('#hotspots-panel .v-card-title').scrollWidth<=document.querySelector('#hotspots-panel .v-card-title').clientWidth+1`),`${name}: existing Hotspots action shows the exact untruncated wrapped title`)
  await press('Escape')
 }
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1400,height:900,deviceScaleFactor:1,mobile:false});await ready(url);await installDownloads()
 const current=csvBody(await tractDownload('CSV – current view (Fair or poor health)')),h=current[0],r=current.find(r=>r[h.indexOf('geoid')]==='12086002404')
 check(h.length===16&&current.every(r=>r.length===16)&&r[h.indexOf('metric_value')]==='44.8'&&r[h.indexOf('metric_ci_lo')]==='39.2'&&r[h.indexOf('metric_ci_hi')]==='50.7', 'generalHealth: actual current-view native download has 16 aligned columns and exact check CI')
 const geo=JSON.parse(await tractDownload('All tracts (GeoJSON)'))
 check(geo.features.length===152&&geo.features.every((f,i)=>['pct_general_health','pct_general_health_ci_lo','pct_general_health_ci_hi'].every((k,j)=>f.properties[k]===fc.features[i].properties[['pctGeneralHealth','pctGeneralHealthLo','pctGeneralHealthHi'][j]])),'generalHealth: native GeoJSON includes all152 numeric source triples')
 await evaluate(`navigator.clipboard.writeText=async text=>window.__generalHealthCitations=text;document.querySelector('button[aria-label="About"]').click()`)
 check(await waitFor(`window.__vis(document.querySelector('.about-sources'))&&document.querySelector('.about-sources').textContent.includes(${JSON.stringify(placesMetricCitation('generalHealth',meta.cdcPlaces.years))})&&document.querySelector('.about-sources').textContent.includes(${JSON.stringify(GHLTH_METHODS)})`),'generalHealth: About renders the shared 2023 source and exact methods distinction')
 await evaluate(`[...document.querySelectorAll('.v-overlay--active button')].find(b=>b.textContent.trim()==='Copy citations').click()`)
 check(await waitFor(`window.__generalHealthCitations?.includes(${JSON.stringify(GHLTH_METHODS)})&&window.__generalHealthCitations.includes(${JSON.stringify(placesMetricCitation('generalHealth',meta.cdcPlaces.years))})`),'generalHealth: actual Copy citations reuses the exact source year and methods text')
 await press('Escape')
 await evaluate(`window.__generalHealthDetails=window.__component('TractDetails');window.__generalHealthOriginal=window.__generalHealthDetails.props.tract`)
 for(const [props,expected]of [[{pctGeneralHealth:0,pctGeneralHealthLo:0,pctGeneralHealthHi:0},'Adults rating their overall health as fair or poor · 0.0% (95% CI 0.0–0.0) · model estimate'],[{pctGeneralHealth:44.8,pctGeneralHealthLo:null,pctGeneralHealthHi:null},'Adults rating their overall health as fair or poor · 44.8% · model estimate']]){
  await evaluate(`window.__generalHealthDetails.props.tract={...window.__generalHealthOriginal,...${JSON.stringify(props)}}`)
  check(await waitFor(`document.querySelector('.general-health-detail')?.textContent===${JSON.stringify(expected)}`),'generalHealth controlled zero/missing-CI exact copy: '+expected)
 }
 await evaluate(`window.__generalHealthDetails.props.tract={...window.__generalHealthOriginal,pctGeneralHealth:null}`)
 check(await waitFor(`!document.querySelector('.general-health-detail')&&!document.querySelector('.general-health-caption')&&document.querySelector('#tract-details-panel').textContent.includes('No self-rated general-health estimate for this tract')`),'generalHealth null omits routine row/caption, never zero-fills; exact active no-data text')
 await evaluate(`window.__generalHealthDetails.props.tract=window.__generalHealthOriginal`)
 const index=getTractSnapshotIndex(fc,meta),winner=fc.features.find(f=>index.select(f.properties.geoid)?.worst.some(s=>s.metricId==='generalHealth'))
 if(!winner)throw Error('No real generalHealth snapshot winner found')
 await evaluate(`window.__stores().ui.setActiveMetric('copd');window.__stores().city.select(${JSON.stringify(winner.properties.geoid)})`)
 if(!await waitFor(`!!document.querySelector('button[data-snapshot-metric="generalHealth"]')`))throw Error('Depression snapshot winner did not render')
 await evaluate(`window.__ghlthSnapshot=document.querySelector('button[data-snapshot-metric="generalHealth"]');window.__ghlthSnapshot.scrollIntoView({block:'center'});window.__ghlthSnapshot.focus();window.__ghlthCanvas=document.querySelector('canvas.maplibregl-canvas')`)
 await press('Space')
 check(await waitFor(`window.__stores().ui.activeMetric==='generalHealth'&&window.__status()==='Map now showing Fair or poor health (self-rated)'&&document.activeElement===window.__ghlthSnapshot&&window.__ghlthSnapshot.isConnected`),'generalHealth real snapshot winner: native Space, exact polite status and same connected focus')
 check(await evaluate(`window.__ghlthSnapshot.textContent.includes('model estimate')&&document.querySelector('canvas.maplibregl-canvas')===window.__ghlthCanvas&&window.__ghlthSnapshot.getAttribute('aria-current')==='true'`),'generalHealth snapshot model/current marker retained without map remount')
 await evaluate(`window.__stores().ui.setDualView(true)`)
 check(await waitFor(`!document.querySelector('button[data-snapshot-metric="generalHealth"]')&&document.querySelector('[data-snapshot-metric="generalHealth"]')?.tagName==='DIV'`),'generalHealth snapshot remains noninteractive plain text in dual mode')
}

async function genericHotspotsHeadings(){
 const {METRICS,metricAvailable}=await import('../src/utils/metrics.ts')
 const fc=JSON.parse(readFileSync('public/data/central-miami-fl/tracts-equity.geojson','utf8')),meta=JSON.parse(readFileSync('public/data/central-miami-fl/meta.json','utf8'))
 const ids=[...new Set([...Object.values(METRICS).sort((a,b)=>b.hotspotTitle.length-a.hotspotTitle.length).slice(0,6).map(d=>d.id),'generalHealth','depression','uninsured','disability','shortSleep'])].filter(id=>metricAvailable(id,meta,fc))
 check(ids.includes('generalHealth')&&ids.includes('uninsured'),`generic heading runtime longest-six union: ${ids.join(', ')}`)
 async function open(){
  await evaluate(`window.__wrapOpener=document.querySelector('button[aria-label="Layers"]');window.__wrapOpener.focus()`)
  await cdp.send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'h',code:'KeyH',windowsVirtualKeyCode:72});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'h',code:'KeyH',windowsVirtualKeyCode:72})
  if(!await waitFor(`window.__vis(document.querySelector('#hotspots-panel'))&&document.activeElement===document.querySelector('#hotspots-panel .hotspots-close')`,4000))throw Error('Existing Hotspots keyboard autofocus did not settle')
 }
 const layout=title=>`(()=>{const card=document.querySelector('#hotspots-panel'),head=card.querySelector('.hotspots-heading'),text=card.querySelector('.hotspots-heading-text'),close=card.querySelector('.hotspots-close'),t=text.getBoundingClientRect(),b=close.getBoundingClientRect(),c=card.getBoundingClientRect(),cs=getComputedStyle(text);return text.textContent===${JSON.stringify(title)}&&cs.whiteSpace!=='nowrap'&&(!cs.webkitLineClamp||cs.webkitLineClamp==='none')&&getComputedStyle(head).whiteSpace!=='nowrap'&&text.scrollWidth<=text.clientWidth+1&&text.scrollHeight<=text.clientHeight+1&&head.scrollWidth<=head.clientWidth+1&&card.scrollWidth<=card.clientWidth+1&&document.documentElement.scrollWidth<=innerWidth+1&&t.right<=b.left+1&&b.left>=0&&b.right<=innerWidth&&b.top>=0&&b.bottom<=innerHeight&&b.width>=31.9&&b.height>=31.9&&close.getAttribute('aria-label')==='Close'&&getComputedStyle(close).flexShrink==='0'&&(innerWidth<=600||c.width<=381)})()`
 for(const width of [390,1400])for(const mode of ['light','dark','contrast']){
  await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:900,deviceScaleFactor:1,mobile:false})
  await ready(URL_MIAMI+'&theme='+(mode==='dark'?'dark':'light')+(mode==='contrast'?'&hc=1':''))
  await evaluate(`document.querySelector('#tract-details-panel .tract-close').click()`)
  if(!await waitFor(`!window.__vis(document.querySelector('#tract-details-panel'))`))throw Error('Existing drawer close did not settle')
  for(const id of ids){
   await evaluate(`window.__stores().ui.setActiveMetric(${JSON.stringify(id)})`)
   let geometry=true,keyboard=true
   for(const key of ['Enter','Space','Escape']){
    // Focus can settle before the existing bottom-sheet transition finishes.
    await open();const settled=await waitFor(layout(METRICS[id].hotspotTitle),4000);geometry=geometry&&settled
    if(!settled)console.error('HEADING LAYOUT',await evaluate(`(()=>{const card=document.querySelector('#hotspots-panel'),head=card.querySelector('.hotspots-heading'),text=card.querySelector('.hotspots-heading-text'),close=card.querySelector('.hotspots-close');return {title:text.textContent,text:{clientWidth:text.clientWidth,scrollWidth:text.scrollWidth,clientHeight:text.clientHeight,scrollHeight:text.scrollHeight,rect:text.getBoundingClientRect().toJSON(),whiteSpace:getComputedStyle(text).whiteSpace,clamp:getComputedStyle(text).webkitLineClamp},head:{client:head.clientWidth,scroll:head.scrollWidth,whiteSpace:getComputedStyle(head).whiteSpace},card:{client:card.clientWidth,scroll:card.scrollWidth,rect:card.getBoundingClientRect().toJSON()},close:{rect:close.getBoundingClientRect().toJSON(),flexShrink:getComputedStyle(close).flexShrink},document:{scroll:document.documentElement.scrollWidth,width:innerWidth,height:innerHeight}}})()`))
    if(key==='Enter'&&width===390&&mode!=='contrast'&&['uninsured','generalHealth'].includes(id)&&process.env.A11Y_SCREENSHOT_DIR){
     const dir=path.resolve(process.env.A11Y_SCREENSHOT_DIR);mkdirSync(dir,{recursive:true});const shot=await cdp.send('Page.captureScreenshot',{format:'png'});writeFileSync(path.join(dir,`hotspots-${id}-${width}-${mode}.png`),Buffer.from(shot.data,'base64'))
    }
    await press(key);const restored=await waitFor(`!window.__vis(document.querySelector('#hotspots-panel'))&&document.activeElement===window.__wrapOpener&&window.__wrapOpener.isConnected`,4000);keyboard=keyboard&&restored
    if(!restored)throw Error(`${width}px ${mode} ${id}: existing ${key}/focus return failed`)
   }
   check(geometry,`${width}px ${mode} ${id}: full generic title wraps without clipping/overflow or overlap; unchanged visible Close target`)
   check(keyboard,`${width}px ${mode} ${id}: native Enter/Space/Escape close and restore the same connected opener`)
  }
  await open()
  // The registry is static: cycle existing reactive selection to render the controlled title.
  const unbroken='W'.repeat(120)
  await evaluate(`window.__wrapClose=document.querySelector('#hotspots-panel .hotspots-close');window.__wrapId=window.__stores().ui.activeMetric;window.__wrapMetric=window.__stores().ui.metric;window.__wrapTitle=window.__wrapMetric.hotspotTitle;window.__wrapMetric.hotspotTitle=${JSON.stringify(unbroken)};window.__stores().ui.setActiveMetric('generalHealth')`)
  await waitFor(`document.querySelector('.hotspots-heading-text')?.textContent===${JSON.stringify(METRICS.generalHealth.hotspotTitle)}`)
  await evaluate(`window.__stores().ui.setActiveMetric(window.__wrapId)`)
  if(!await waitFor(`document.querySelector('.hotspots-heading-text')?.textContent===${JSON.stringify(unbroken)}`))throw Error('Controlled unbroken title did not render')
  check(await waitFor(layout(unbroken)+`&&document.querySelector('#hotspots-panel .hotspots-close')===window.__wrapClose`,4000),`${width}px ${mode}: generic anywhere fallback wraps unbroken title without remounting Close`)
  await evaluate(`window.__wrapMetric.hotspotTitle=window.__wrapTitle;window.__stores().ui.setActiveMetric('generalHealth')`);await waitFor(`document.querySelector('.hotspots-heading-text')?.textContent===${JSON.stringify(METRICS.generalHealth.hotspotTitle)}`);await evaluate(`window.__stores().ui.setActiveMetric(window.__wrapId)`);await press('Escape')
 }
}
if(!existsSync(path.resolve('dist/index.html')))throw Error('Build first')
const srv=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,PORT:String(PORT),BASE_PATH:'/'},stdio:['ignore','ignore','inherit']})
const profile=mkdtempSync(path.join(tmpdir(),'ste-gap-a11y-'))
const chrome=spawn(findChrome(),['--headless=new',`--remote-debugging-port=${DEBUG_PORT}`,`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--window-size=1400,900','--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox',...(process.getuid?.()===0?['--no-sandbox']:[]),'about:blank'],{stdio:'ignore'})
try{
 let ws=null;for(let i=0;i<100&&!ws;i++){try{const targets=await(await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();ws=targets.find(t=>t.type==='page')?.webSocketDebuggerUrl}catch{}if(!ws)await sleep(100)}if(!ws)throw Error('Chrome did not start')
 cdp=await Cdp.connect(ws);await cdp.send('Page.enable');await cdp.send('Runtime.enable');await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:HELPERS+GAP_HELPERS})
 for(const width of [1400,390])for(const theme of ['light','dark']){await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:900,deviceScaleFactor:1,mobile:false});await ready(URL_MIAMI+'&theme='+theme);await layers();await semantics(`${width}px ${theme}`)}
 for(const width of [700,195])for(const theme of ['light','dark']){await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:450,deviceScaleFactor:2,mobile:false});await ready(URL_MIAMI+'&theme='+theme);await layers();check(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1&&document.querySelector('.canopy-gap-target').scrollWidth<=document.querySelector('.canopy-gap-target').clientWidth+1`),`${width}px ${theme}: 200%-equivalent target/helper reflow without overflow`)}
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1400,height:900,deviceScaleFactor:1,mobile:false});await allDownloads();await contexts();await pendingTarget();await depressionUI();await generalHealthUI();await genericHotspotsHeadings()
}catch(e){failed++;console.error('ERROR',e.stack||e.message)}finally{try{cdp?.close()}catch{}chrome.kill();srv.kill();await new Promise(r=>chrome.exitCode!==null?r():chrome.once('exit',r));for(const dir of [profile,downloads])try{rmSync(dir,{recursive:true,force:true})}catch{}}
console.log(`\n${passed} passed, ${failed} failed`);process.exit(failed?1:0)

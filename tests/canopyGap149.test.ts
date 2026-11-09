import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { stripTypeScriptTypes } from 'node:module'
import { computed, reactive } from 'vue'
import { createExpression } from '@maplibre/maplibre-gl-style-spec'
import type { Meta,TractCollection,TractProps } from '../src/types.ts'
import { canopyGapView,packP75,type7,gapValues,gapReason,gapNumber,gapSnapshotSentence,gapBreaks,parseGapTarget,GAP_COLUMNS,SQM_PER_ACRE } from '../src/utils/canopyGap.ts'
import { METRICS,METRIC_SWITCH_ORDER,DEFAULT_METRIC,resolveMetric,metricAvailable,metricMeta,fmtUnitless } from '../src/utils/metrics.ts'
import { hotspotTracts } from '../src/utils/hotspots.ts'
import { CSV_HEADERS,toCsv } from '../src/utils/fullCsv.ts'
import { toCurrentViewCsv,currentViewComments,metricUnitToken } from '../src/utils/currentViewCsv.ts'
import { readDeepLink,writeDeepLink } from '../src/composables/useDeepLink.ts'
import { tractShareUrl } from '../src/utils/clipboard.ts'
import { getTractSnapshotIndex,SNAPSHOT_EXCLUDED_METRICS,SNAPSHOT_CANDIDATE_METRICS } from '../src/utils/tractSnapshot.ts'
// @ts-ignore build-only source; no raster/Python/cache dependency at test time
import { zonalCanopy,samplingLandAcres } from '../scripts/lib/canopy.mjs'
// @ts-ignore independent build implementation
import { densityBreaks } from '../scripts/lib/geo-utils.mjs'
const hash=(s:string)=>createHash('sha256').update(s).digest('hex')
const packs=[
 ['public/data',98,28.756140666187395,25,21,'48dab47e8b75a884a7fa3ca0d7fb905fc4ee7578c04055eec64da548554c0193'],
 ['public/data/central-miami-fl',152,11.145167934979426,38,0,'77bdffe9d6fa201594f392716ecd17b2b465c19ce65d25a9587d7fc4c992fa61'],
 ['public/data/melbourne-fl',19,14.607451485320016,5,0,'bb15caa6f8213ba37ca0a2c8d7aca0ee2d12f44277d418f62560dd29b384e4c3'],
 ['public/data/pembroke-pines-fl',50,16.786041056259435,13,0,'2b58bbe823df719d6913e7a75783775edb70cbf28c176dbf4749b0f55dde7407'],
 ['public/data/orlando-fl',43,20.69223154579695,11,0,'648543df908dc0fbfe3bff87a4b993fa4933b503d07527b78dc43e89e992fc5b'],
 ['public/data/tampa-fl',60,19.09362047399995,15,0,'9b33948012eef7ad599b28883bbf46cb42717f5f2f49a74c860577a0748d2551'],
 ['public/data/central-jacksonville-fl',42,23.856296026686426,11,0,'fafb0b2b10f3b99a8913632fdef7cffee9ff0d4977a5b375876afb5bce0b540b'],
] as const
const supportFingerprints:Record<string,string> = {
  "public/data": "8121dcdecd4e85fa0eed7d1149a4704d699f2595c13721633f437797d607252a",
  "public/data/central-miami-fl": "fcdbbf6d80d8721a742581952f640779ae2221caa21ad3f73cae45d3df0bd762",
  "public/data/melbourne-fl": "29ed4c4df2039bdef5dc6eaa8301c4221dbc0296ff1898cab841a9d06af8bb16",
  "public/data/pembroke-pines-fl": "eea30aea0e54b67483d383651ca268b60f52e230c9c479456755e75933ac1e64",
  "public/data/orlando-fl": "fa6bed8047293af5b4a35d2fbf7219b9fddf413dfba11b6fc4c1be51da5fb997",
  "public/data/tampa-fl": "8275e4ba9ba0913330e7f0da21cae50fa89681e83c0397954a77598a46c2d159",
  "public/data/central-jacksonville-fl": "5d273d84c55e45ed1c838b8a89a4e56e52a21bd4c6146d03bd5970794394e9bd"
}
const load=(p:string):{fc:TractCollection;meta:Meta}=>({fc:JSON.parse(readFileSync(`${p}/tracts-equity.geojson`,'utf8')),meta:JSON.parse(readFileSync(`${p}/meta.json`,'utf8'))})
const collection=(rows:Record<string,unknown>[]):TractCollection=>({type:'FeatureCollection',features:rows.map((p,i)=>({type:'Feature',geometry:{type:'Point',coordinates:[0,0]},properties:{geoid:String(i),name:`Tract ${i}`,...p} as TractProps}))})
const metadata=()=>({colors:['#d9f0a3','#addd8e','#78c679','#31a354','#006837'],breaks:[],overall:{treesPerAcre:1},metricBreaks:{}} as unknown as Meta)
function parse(csv:string):string[][] {const rows:string[][]=[];let row:string[]=[],field='',quoted=false;for(let i=0;i<csv.length;i++){const c=csv[i];if(c==='"'){if(quoted&&csv[i+1]==='"'){field+='"';i++}else quoted=!quoted}else if(c===','&&!quoted){row.push(field);field=''}else if((c==='\r'||c==='\n')&&!quoted){if(c==='\r'&&csv[i+1]==='\n')i++;row.push(field);rows.push(row);row=[];field=''}else field+=c}if(field||row.length){row.push(field);rows.push(row)}return rows}
const plain=(csv:string)=>parse(csv.split(/\r?\n/).filter(l=>!l.startsWith('#')).join('\r\n'))
const approx=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-11,`${a} != ${b}`)
test('#149 exact type-7 quantile: zeros, unrounded interpolation, singleton/constants/empty; not a peer minimum',()=>{
 assert.equal(type7([0,10,20,30]),22.5);assert.equal(type7([0,100]),75);assert.equal(type7([0]),0);assert.equal(type7([7]),7);assert.equal(type7([12,12,12]),12);assert.equal(type7([]),null)
 const rows=[0,10,20,30,null,undefined,'99',NaN,Infinity,-1,101].map(canopyPct=>({canopyPct,landAcres:1}))
 rows.push({canopyPct:100,canopyStatus:'missing'} as any,{canopyPct:100,canopyStatus:'mostly-water'} as any)
 assert.equal(packP75(collection(rows)),22.5)
 assert.equal(packP75(collection([{canopyPct:0,landAcres:9999999},{canopyPct:100,landAcres:1}])),75)
 assert.equal(packP75(collection([{canopyPct:27.001},{canopyPct:27.003}])),27.0025)
})
test('#149 below/equal/above, fixed 30 not max(p75,30), zero vs missing acreage, tiny and >100 acres',()=>{
 const t={canopyPct:10,canopyStatus:'ok',landAcres:2000} as TractProps
 assert.deepEqual(gapValues(t,30),{canopyGapPct:20,canopyGapAcres:400})
 assert.deepEqual(gapValues({...t,canopyPct:30},30),{canopyGapPct:0,canopyGapAcres:0})
 assert.deepEqual(gapValues({...t,canopyPct:100},30),{canopyGapPct:0,canopyGapAcres:0})
 for(const landAcres of [null,undefined,0,-1,NaN,Infinity])assert.deepEqual(gapValues({...t,landAcres},30),{canopyGapPct:20,canopyGapAcres:null})
 for(const canopyPct of [null,undefined,NaN,Infinity,-1,101])assert.deepEqual(gapValues({...t,canopyPct},30),{canopyGapPct:null,canopyGapAcres:null})
 assert.equal(gapValues(t,null).canopyGapAcres,null);assert.equal(gapNumber(.001),'<0.1');assert.equal(gapNumber(1),'1')
 const fc=collection([{canopyPct:50,landAcres:1},{canopyPct:90,landAcres:1}]),m=metadata()
 assert.equal(canopyGapView(fc,m).target,80);assert.equal(canopyGapView(fc,m,'30').target,30)
})
test('#149 exact shared null precedence: mostly water, canopy, target, support; never Census fallback',()=>{
 const t={canopyPct:10,canopyStatus:'ok',landAcres:10,areaAcres:100} as TractProps
 assert.deepEqual(gapReason({...t,canopyPct:null,canopyStatus:'mostly-water',landAcres:null},null),['Mostly water — no canopy-gap estimate','At least 99% of this tract is open water; no canopy-gap estimate is shown.'])
 assert.equal(gapReason({...t,canopyPct:null},null)![0],'Canopy gap unavailable — canopy estimate missing')
 assert.equal(gapReason(t,null)![0],'Canopy gap unavailable — city target missing')
 assert.equal(gapReason({...t,landAcres:undefined},30)![0],'Canopy gap unavailable — land area missing')
 assert.equal(gapValues({...t,landAcres:undefined},30).canopyGapAcres,null);assert.equal(gapReason(t,30),null)
})
for(const [dir,n,p75,aboveP75,above30,fingerprint] of packs)test(`#149 ${dir}: exact targets/zeros, complete support, source canopy/geometry/Planting need byte-identical to 709037b`,()=>{
 const {fc,meta}=load(dir),before=JSON.stringify(fc),mBefore=JSON.stringify(meta)
 assert.equal(hash(JSON.stringify(fc.features.map(f=>[f.properties.geoid,f.properties.landAcres]))),supportFingerprints[dir],'all464 support values match the verified build inventory; no raw cache is read')
 assert.equal(fc.features.length,n);assert.equal(packP75(fc),p75);assert.equal(meta.canopyGap!.p75,p75)
 assert.deepEqual(meta.canopyGap!.percentile,{type:7,p:.75,nValid:n,weighted:false})
 assert.equal(meta.canopyGap!.landArea.squareMetresPerAcre,SQM_PER_ACRE)
 assert.equal(meta.canopy!.landAreaMethod,'landAcres is the NLCD non-water sampling support and differs from Census land area.')
 assert.deepEqual(fc.features.filter(f=>typeof f.properties.landAcres!=='number'||!Number.isFinite(f.properties.landAcres)||f.properties.landAcres<=0).map(f=>f.properties.geoid),[])
 for(const f of fc.features)approx(f.properties.landAcres!*SQM_PER_ACRE/900,Math.round(f.properties.landAcres!*SQM_PER_ACRE/900))
 const v=canopyGapView(fc,meta),fixed=canopyGapView(fc,meta,'30')
 assert.equal(v.collection.features.filter(f=>f.properties.canopyGapAcres===0).length,aboveP75)
 assert.equal(fixed.collection.features.filter(f=>f.properties.canopyGapAcres===0).length,above30)
 for(const view of [v,fixed]){const vals=view.collection.features.map(f=>f.properties.canopyGapAcres!);assert.deepEqual(view.meta.metricBreaks!.canopyGap,densityBreaks(vals,5));assert.equal(metricMeta(view.meta,'canopyGap').colors.length,view.meta.metricBreaks!.canopyGap!.length+1)}
 const stripped=structuredClone(fc);for(const f of stripped.features){delete f.properties.landAcres;for(const k of ['pctDepression','pctDepressionLo','pctDepressionHi','depressionAdultPop','pctGeneralHealth','pctGeneralHealthLo','pctGeneralHealthHi','generalHealthAdultPop'])delete (f.properties as unknown as Record<string,unknown>)[k]}
 assert.equal(hash(JSON.stringify(stripped)),fingerprint,'all pre-existing properties AND geometry match main, not only rounded values')
 assert.equal(JSON.stringify(fc),before);assert.equal(JSON.stringify(meta),mBefore)
 for(let i=0;i<n;i++)for(const view of [v,fixed]){assert.equal(view.collection.features[i].geometry,fc.features[i].geometry);assert.equal(view.collection.features[i].properties.plantNeed,fc.features[i].properties.plantNeed);assert.equal(view.collection.features[i].properties.plantNeedParts,fc.features[i].properties.plantNeedParts)}
})
for(const [dir,geoid,centers,land,pct,acres,fixedPct,fixedAcres,sentence,fixedSentence]of [
 ['public/data','41051003100',1422,316.2454672016782,1.1471392597176333,3.6277759113479022,2.390998593530238,7.561424672895256,"About 4 acres of canopy short of the city's leafier neighborhoods",'About 8 acres of canopy short of the 30% canopy target'],
 ['public/data/central-miami-fl','12086002404',1019,226.62034534353734,.6652856974916936,1.5076727451768372,19.520117762512267,44.236558284870476,"About 2 acres of canopy short of the city's leafier neighborhoods",'About 44 acres of canopy short of the 30% canopy target'],
 ['public/data/orlando-fl','12095010201',931,207.04959913133783,6.084283103262042,12.597483775319779,15.392051557465091,31.869181047820312,"About 13 acres of canopy short of the city's leafier neighborhoods",'About 32 acres of canopy short of the 30% canopy target'],
]as const)test(`#149 sheet worked tract ${geoid}: both raw targets, pp/acres and exact snapshot sentences`,()=>{
 const {fc,meta}=load(dir),a=canopyGapView(fc,meta).collection.features.find(f=>f.properties.geoid===geoid)!.properties,b=canopyGapView(fc,meta,'30').collection.features.find(f=>f.properties.geoid===geoid)!.properties
 assert.equal(a.landAcres,centers*900/SQM_PER_ACRE);assert.equal(a.landAcres,land);assert.equal(a.canopyGapPct,pct);assert.equal(a.canopyGapAcres,acres);assert.equal(b.canopyGapPct,fixedPct);assert.equal(b.canopyGapAcres,fixedAcres)
 assert.equal(gapSnapshotSentence(a.canopyGapAcres,'p75'),sentence);assert.equal(gapSnapshotSentence(b.canopyGapAcres,'30'),fixedSentence)
})
test('#149 support uses same center/overlap estimator: 10/9/0 centers, zero canopy, class11, nodata, incomplete mask',()=>{
 const polygon=(x:number)=>({type:'Polygon',coordinates:[[[15,15],[x,15],[x,45],[15,45],[15,15]]]})
 for(const n of [10,9]){const grid={bbox:[15,15,15+n*30,45],width:n,height:1},r=zonalCanopy(polygon(15+n*30),grid,new Uint8Array(n),new Uint8Array(n).fill(21));assert.equal(r.canopyPct,0);assert.equal(r.landPixels,n);assert.equal(r.totalPixels,n);assert.equal(r.totalOverlap,n*900);assert.equal(samplingLandAcres(r),n*900/SQM_PER_ACRE)}
 const grid={bbox:[15,15,45,45],width:1,height:1},r=zonalCanopy(polygon(20),grid,Uint8Array.of(30),Uint8Array.of(21))
 assert.equal(r.landPixels,0);assert.equal(r.validLandArea,150);assert.equal(samplingLandAcres(r),150/SQM_PER_ACRE)
 const water=zonalCanopy(polygon(45),grid,Uint8Array.of(30),Uint8Array.of(11));assert.equal(water.canopyStatus,'mostly-water');assert.equal(samplingLandAcres(water),0)
 for(const [tcc,mask]of [[254,21],[255,21],[30,0],[30,255]]){const missing=zonalCanopy(polygon(45),grid,Uint8Array.of(tcc),Uint8Array.of(mask));assert.equal(samplingLandAcres(missing),null)}
})
test('#149 WeakMap caches two immutable paired views; source identity invalidation, mean includes zero, breaks exactly match build densityBreaks',()=>{
 const fc=collection([{canopyPct:0,landAcres:100},{canopyPct:100,landAcres:100}]),meta=metadata(),v=canopyGapView(fc,meta),fixed=canopyGapView(fc,meta,'30')
 assert.equal(canopyGapView(fc,meta),v);assert.equal(canopyGapView(fc,meta,'30'),fixed);assert.notEqual(v,fixed);assert.notEqual(canopyGapView(structuredClone(fc),meta),v)
 assert.equal(v.target,75);assert.equal(v.meta.overall.canopyGapAcres,37.5);assert.equal(fixed.meta.overall.canopyGapAcres,15)
 for(const x of [v,v.collection,v.collection.features,v.collection.features[0].properties,v.meta,v.meta.overall])assert.ok(Object.isFrozen(x))
 for(const values of [[],[0,0],[1],[1,1,1],[0,1,2,3,4,5],[.00001,.00002,999999,Infinity,NaN],Array.from({length:464},(_,i)=>((i*19)%77)/13)])assert.deepEqual(gapBreaks(values),densityBreaks(values,5))
})
test('#149 registry 31-order/default/aliases, honest acres, all-zero availability and no 100-acre cap',()=>{
 assert.equal(DEFAULT_METRIC,'canopy');assert.equal(METRIC_SWITCH_ORDER.length,31);assert.deepEqual(METRIC_SWITCH_ORDER.slice(0,4),['canopy','canopyGap','trees','plantNeed'])
 for(const s of ['canopyGap','canopygap',' CANOPY GAP ','canopy deficit','tree canopy gap'])assert.equal(resolveMetric(s),'canopyGap')
 for(const s of ['gap','deficit'])assert.equal(resolveMetric(s),null)
 for(const s of ['canopy','tree canopy','tcc','shade'])assert.equal(resolveMetric(s),'canopy')
 const fc=collection([{canopyPct:10,landAcres:100}]),view=canopyGapView(fc,metadata())
 assert.equal(view.collection.features[0].properties.canopyGapAcres,0);assert.equal(metricAvailable('canopyGap',view.meta,view.collection),true)
 assert.deepEqual(metricMeta(view.meta,'canopyGap').colors,['#d9f0a3']);assert.deepEqual(view.meta.metricBreaks!.canopyGap,[])
 assert.equal(fmtUnitless(METRICS.canopyGap,1234.567),'1,234.6');assert.equal(fmtUnitless(METRICS.canopyGap,.001),'<0.1');assert.equal(metricUnitToken(METRICS.canopyGap,'km2'),'acres')
 assert.equal(metricAvailable('canopyGap',metadata(),collection([{canopyPct:10,areaAcres:100}])),false)
})
test('#149 actual MapLibre gap expression: neutral invalid/null, distinct zero and valid >100 acres in both themes',()=>{
 const source=readFileSync('src/components/MapView.vue','utf8'),body=source.match(/function fillColor\(\): ExpressionSpecification[\s\S]*?\n}/)![0]
 const build=new Function('props','choroplethColors','choroplethMode','choroplethPalette','pm','isDark',stripTypeScriptTypes(body)+';return fillColor()')
 for(const dark of [false,true]){const expr=build({meta:{breaks:[1,2,10,100]}},()=>['#d9f0a3','#addd8e','#78c679','#31a354','#006837'],{value:'green'},{value:'default'},{value:METRICS.canopyGap},{value:dark}),compiled=createExpression(expr,{type:'color',default:'#ff00ff'}as any);assert.equal(compiled.result,'success');const val=(canopyGapAcres:unknown)=>(compiled.value as any).evaluate({zoom:0},{type:3,properties:{canopyGapAcres}}).toString(),neutral=val(null)
 for(const x of [null,undefined,-1,'0',NaN,Infinity])assert.equal(val(x),neutral)
 assert.notEqual(val(0),neutral);assert.notEqual(val(99999),neutral);assert.notEqual(val(0),val(99999))}
})
test('#149 snapshot: seven exclusions, exact24 candidates and original cached ranking independent of mode; sentence null/zero/sub-acre/singular',()=>{
 assert.equal(SNAPSHOT_EXCLUDED_METRICS.length,7);assert.ok(SNAPSHOT_EXCLUDED_METRICS.includes('canopyGap'));assert.equal(SNAPSHOT_CANDIDATE_METRICS.length,24)
 const {fc,meta}=load('public/data/central-miami-fl'),index=getTractSnapshotIndex(fc,meta),before=index.select('12086002404')
 canopyGapView(fc,meta);canopyGapView(fc,meta,'30');assert.equal(getTractSnapshotIndex(fc,meta),index);assert.deepEqual(index.select('12086002404'),before)
 assert.equal(gapSnapshotSentence(0,'p75'),null);assert.equal(gapSnapshotSentence(null,'30'),null);assert.equal(gapSnapshotSentence(.1,'p75'),"Less than 1 acre of canopy short of the city's leafier neighborhoods");assert.equal(gapSnapshotSentence(.5,'30'),'About 1 acre of canopy short of the 30% canopy target')
 const s=readFileSync('src/components/TractDetails.vue','utf8');assert.ok(s.indexOf('class="text-caption mt-2 snapshot-gap"')>s.indexOf('snapshot-mapping-note'));assert.ok(s.indexOf('class="text-caption mt-2 snapshot-gap"')>s.indexOf('</ol>'))
 assert.equal(hash(readFileSync('scripts/add-plant-need.mjs','utf8')),'a6c300e34e07e1f70e41938d61a3a4c985447b5c05a75077d4024184ddf79111','formula file byte-identical to main')
})
test('#149 actual gapTarget URL round-trip grammar, canonical omission, unrelated flags and explicit dual/tract share',()=>{
 for(const s of [null,undefined,'','p75',' P75 ','0.3','30%','31','garbage'])assert.equal(parseGapTarget(s),'p75')
 assert.equal(parseGapTarget(' 30 '),'30');assert.equal(readDeepLink('?metric=canopyGap&gapTarget=30').gapTarget,'30')
 const original=(globalThis as any).window
 const win={location:new URL('https://example.test/?audit=keep&gapTarget=p75'),history:{state:{x:1},replaceState(_s:unknown,_t:string,url:URL){win.location=new URL(url)}}};(globalThis as any).window=win
 try {const view={city:'central-miami-fl',geoid:'12086002404',basemap:'streets',theme:'dark',layers:{trees:true,parks:true,roads:true,bq:false},unit:'km2',metric:'canopyGap',dual:{left:'trees',right:'canopyGap'},choroplethMode:'contrast',legend:false,bin:2,gapTarget:'30'} as const
 writeDeepLink(view as any);let q=win.location.searchParams;assert.equal(q.get('gapTarget'),'30');assert.equal(q.get('metric'),'canopyGap');assert.equal(q.get('dual'),'trees,canopygap');assert.equal(q.get('audit'),'keep');assert.equal(readDeepLink(win.location.search).gapTarget,'30')
 const url=new URL(tractShareUrl({...view,metric:'trees'} as any));assert.equal(url.searchParams.get('gapTarget'),'30');assert.equal(url.searchParams.get('metric'),'trees');assert.equal(url.searchParams.get('dual'),'trees,canopygap');assert.equal(url.searchParams.get('audit'),'keep')
 writeDeepLink({...view,gapTarget:'p75'} as any);q=win.location.searchParams;assert.equal(q.has('gapTarget'),false);assert.equal(q.get('dual'),'trees,canopygap')
 }finally{(globalThis as any).window=original}
})
test('#149 full109/current14/dual/compare headers and every cell in both scenarios; independent pack p75, unit invariant, raw precision/null vs0',()=>{
 const a=load('public/data/central-miami-fl'),b=load('public/data'),props=a.fc.features.map(f=>f.properties)
 assert.equal(CSV_HEADERS.length,109);assert.equal(new Set(CSV_HEADERS).size,109);assert.deepEqual(CSV_HEADERS.slice(-5),GAP_COLUMNS)
 for(const mode of ['p75','30']as const){const [h,...rows]=parse(toCsv(props,a.meta,mode));for(let i=0;i<rows.length;i++){assert.equal(rows[i].length,109);const p=props[i],v=canopyGapView(a.fc,a.meta,mode).collection.features[i].properties;for(const [k,val]of Object.entries({land_acres:p.landAcres,canopy_target_mode:mode,canopy_target_pct:v.canopyTargetPct,canopy_gap_pct:v.canopyGapPct,canopy_gap_acres:v.canopyGapAcres,plant_need_canopy:p.plantNeedParts!.T,area_acres:p.areaAcres}))assert.equal(rows[i][h.indexOf(k)],String(val))}
 for(const unit of ['acre','km2']as const)for(const metrics of [['canopyGap'],['trees','canopyGap'],['canopyGap','copd']]as const)for(const compare of [false,true]){const rr=[a,...compare?[b]:[]].flatMap((pack,i)=>pack.fc.features.map(f=>({cityId:String(i),meta:pack.meta,props:f.properties}))),[header,...data]=plain(toCurrentViewCsv({rows:rr,metrics:[...metrics],unit,compare,gapTarget:mode,comments:[]}));assert.equal(data.length,rr.length);assert.equal(new Set(header).size,header.length);if(metrics.length===1&&!compare)assert.equal(header.length,14)
 for(const row of data){assert.equal(row.length,header.length);const source=rr.find(r=>r.props.geoid===row[header.indexOf('geoid')])!,target=mode==='30'?30:source.meta.canopyGap!.p75!,g=gapValues(source.props,target);assert.equal(row[header.indexOf('canopy_target_pct')],String(target));assert.equal(row[header.indexOf('canopy_gap_acres')],String(g.canopyGapAcres));assert.equal(row[header.indexOf(metrics.length===1?'metric_unit':'metric_b_unit')],metrics.length===1||metrics[1]==='canopyGap'?'acres':'%')}
 }}
 const comments=currentViewComments([{id:'miami',meta:a.meta},{id:'portland',meta:b.meta}],['trees'],'url').join('\n');assert.ok(comments.includes('USFS NLCD Percent Tree Canopy CONUS v2025-6'));assert.ok(comments.includes('Annual NLCD Collection 1.2'));assert.ok(comments.includes('canopy_target (miami): p75=11.145167934979426'));assert.ok(comments.includes('plant_need_canopy: relative low-canopy score (0–100)'))
 const fixture=[{...props[0],canopyPct:30,landAcres:10},{...props[0],canopyPct:30,landAcres:null},{...props[0],canopyPct:null,landAcres:10}];const [h,...r]=parse(toCsv(fixture,a.meta,'30'));assert.equal(r[0][h.indexOf('canopy_gap_acres')],'0');assert.equal(r[1][h.indexOf('canopy_gap_acres')],'');assert.equal(r[2][h.indexOf('canopy_gap_pct')],'');assert.equal(r[2][h.indexOf('canopy_target_pct')],'30')
})

test('#149 hotspots: positive finite gaps descending only, including >100 acres, never zero-fill',()=>{
 const fc=collection([0,1,200,2,null,undefined,-1,NaN,Infinity].map(canopyGapAcres=>({canopyGapAcres})))
 assert.deepEqual(hotspotTracts(fc.features,'canopyGapAcres',false).map(f=>f.properties.canopyGapAcres),[200,2,1])
 assert.equal(hotspotTracts(collection([{canopyGapAcres:0}]).features,'canopyGapAcres',false).length,0)
})

// Execute the actual SFC computed description, not a duplicated text implementation.
function targetDescription(props: { mode: 'p75' | '30'; target: number | null; loading?: boolean }) {
 const source=readFileSync('src/components/CanopyGapTarget.vue','utf8')
 const script=source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1].replace(/^import .*$/gm,'')
 const setup=new Function('defineProps','defineEmits','computed','gapNumber',stripTypeScriptTypes(script)+';return description')
 return setup(()=>props,()=>()=>{},computed,gapNumber) as { readonly value: string }
}
test('#149 target description distinguishes pending data from an unavailable completed target',()=>{
 const props=reactive<{ mode:'p75'|'30'; target:number|null; loading:boolean }>({mode:'p75',target:null,loading:true})
 const description=targetDescription(props)
 assert.equal(description.value,'Loading canopy-gap estimate…')
 assert.doesNotMatch(description.value,/City target unavailable/)
 props.mode='30'
 assert.equal(description.value,'Loading canopy-gap estimate…')
 assert.doesNotMatch(description.value,/City target unavailable/)
 props.loading=false
 assert.equal(description.value,'Target: 30% canopy — a fixed comparison, not an official recommendation.')
})
test('#149 completed-empty city target retains its exact unavailable copy; loaded data leaves loading copy',()=>{
 const props=reactive<{ mode:'p75'|'30'; target:number|null; loading:boolean }>({mode:'p75',target:null,loading:false})
 const description=targetDescription(props)
 assert.equal(description.value,'City target unavailable. Use a fixed 30% target to choose a comparison.')
 assert.doesNotMatch(description.value,/Loading canopy-gap estimate/)
 props.target=20.69223154579695
 assert.equal(description.value,"Target: 20.7% canopy — your city's leafier neighborhoods (75th percentile of tract estimates in this pack).")
})

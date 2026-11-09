import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { stripTypeScriptTypes } from 'node:module'
import { createExpression } from '@maplibre/maplibre-gl-style-spec'
import type { Meta, TractCollection, TractProps } from '../src/types.ts'
import { DEFAULT_METRIC, METRICS, METRIC_SWITCH_ORDER, normalizeMetric, resolveMetric, metricAvailable, metricMeta, fmtUnitless, defaultDualPair, METRIC_IDS } from '../src/utils/metrics.ts'
import { canopyCitation, canopyHelper, canopyTooltip, canopyValue, canopyMissing, canopyMissingExplanation } from '../src/utils/canopySource.ts'
import { currentViewComments, toCurrentViewCsv, metricHasCi } from '../src/utils/currentViewCsv.ts'
import { CSV_HEADERS, toCsv } from '../src/utils/fullCsv.ts'
import { snapshotMetric, snapshotRow, tractSnapshot, snapshotCanopyUnavailable, SNAPSHOT_CANOPY_METRIC, SNAPSHOT_EXCLUDED_METRICS } from '../src/utils/tractSnapshot.ts'
// @ts-ignore build-only JavaScript module, never part of the browser bundle
import { canopyStatus, zonalCanopy, snappedGrid, projectedGeometry, geometryArea, overlap } from '../scripts/lib/canopy.mjs'
const packs = [
 ['public/data',98,'20700f24f411fe5eaa7f413aa8c622da37be086fa1ef02fce8454424e6859433'],
 ['public/data/central-miami-fl',152,'a148153cc338faa4427cdba3e2ac8a88d5fc41555dadc29811935769ba90467c'],
 ['public/data/melbourne-fl',19,'114f346ae0e26682e1c7c5e4c374f65d5366ef326007592e009ba7de292027d9'],
 ['public/data/pembroke-pines-fl',50,'7d32c1a48b128a2b177ff2abc5c7769d4fbc1302e7b62ceaf46535aa79a6292d'],
 ['public/data/orlando-fl',43,'dcb8010500f069049cd47372a9a5807b52eaacd6a44499e3612b2ba5427e8b0a'],
 ['public/data/tampa-fl',60,'68aee8c16ebeeec68b957aff964bb2d3d307cb71e975bb6af813092176affd3f'],
 ['public/data/central-jacksonville-fl',42,'04262bff7c6e8c22c2aa498f3f6ac67b09a81947f459a81dad020d6190734525'],
] as const
const load=(p:string):{fc:TractCollection,meta:Meta}=>({fc:JSON.parse(readFileSync(`${p}/tracts-equity.geojson`,'utf8')),meta:JSON.parse(readFileSync(`${p}/meta.json`,'utf8'))})
/** Real RFC4180 parser: embedded comma, doubled quote and CR/LF are data inside quoted cells. */
function parse(csv:string):string[][] {
 const rows:string[][]=[];let row:string[]=[],field='',quoted=false
 for(let i=0;i<csv.length;i++){const c=csv[i];if(c==='"'){if(quoted&&csv[i+1]==='"'){field+='"';i++}else quoted=!quoted}
 else if(c===','&&!quoted){row.push(field);field=''}else if((c==='\r'||c==='\n')&&!quoted){if(c==='\r'&&csv[i+1]==='\n')i++;row.push(field);rows.push(row);row=[];field=''}else field+=c}
 if(field||row.length){row.push(field);rows.push(row)}return rows
}
const polygon=(x0:number,y0:number,x1:number,y1:number)=>({type:'Polygon',coordinates:[[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]]]})
const score=(values:number[],x:number)=>snapshotMetric('canopy',x,[...values].sort((a,b)=>a-b))!
test('#148 registry default, exact aliases, collisions and 30-id order',()=>{
 assert.equal(DEFAULT_METRIC,'canopy');for(const s of [undefined,'unknown',''])assert.equal(normalizeMetric(s),'canopy')
 for(const a of ['canopy',' tree canopy ','TCC','shade'])assert.equal(resolveMetric(a),'canopy')
 assert.equal(resolveMetric('trees'),'trees');assert.equal(resolveMetric('tree'),null);assert.equal(resolveMetric('access'),null)
 assert.equal(resolveMetric('parks'),'parks');assert.equal(resolveMetric('need'),'plantNeed')
 assert.deepEqual(defaultDualPair(METRIC_IDS),['trees','risk']);assert.equal(METRIC_SWITCH_ORDER.length,30);assert.equal(new Set(METRIC_SWITCH_ORDER).size,30)
 assert.deepEqual(METRIC_SWITCH_ORDER.slice(0,4),['canopy','canopyGap','trees','plantNeed'])
 assert.equal(METRICS.canopy.usesDensityUnit,false);assert.equal(METRICS.canopy.valueKey,'canopyPct');assert.equal(metricHasCi('canopy'),false)
 assert.equal(METRICS.trees.shortLabel,'Mapped street trees (OSM)');assert.equal(METRICS.trees.valueKey,'treesPerAcre')
})
test('#148 valid zero, raw precision and max-1dp formatting; all-zero pack is available',()=>{
 const meta={metricBreaks:{canopy:[]},colors:['#006837'],breaks:[1]} as unknown as Meta
 const fc={features:[{properties:{canopyPct:0}}]} as unknown as TractCollection
 assert.equal(metricAvailable('canopy',meta,fc),true);assert.deepEqual(metricMeta(meta,'canopy').breaks,[])
 assert.equal(metricMeta(meta,'canopy').colors.length,1)
 assert.equal(canopyValue(18),'18');assert.equal(canopyValue(18.37),'18.4');assert.equal(canopyValue(0),'0');assert.equal(canopyValue(0.001),'<0.1')
 assert.equal(fmtUnitless(METRICS.canopy,0.001),'<0.1%')
})
test('#148 99.0% exact water threshold, no rounding and unknown mask is missing',()=>{
 assert.equal(canopyStatus(99,100,100,1),'mostly-water')
 assert.equal(canopyStatus(98.999,100,100,1.001),'ok')
 assert.equal(canopyStatus(99,100,99,0),'missing')
 assert.equal(canopyStatus(0,100,100,0),'missing')
 assert.equal(canopyMissing({canopyStatus:'mostly-water'}),'Mostly water — no canopy estimate')
 assert.match(canopyMissingExplanation({canopyStatus:'missing'}),/missing data is not zero canopy/)
})
test('#148 fractional touch for fewer than 10 land centers; holes and exact overlap',()=>{
 const grid={bbox:[15,15,75,45],width:2,height:1},g=polygon(30,15,75,45)
 const result=zonalCanopy(g,grid,Uint8Array.from([0,60]),Uint8Array.from([21,21]))
 assert.equal(result.areaWeighted,true);assert.equal(result.landPixels,2);assert.equal(result.canopyPct,40)
 assert.equal(geometryArea(g),1350);assert.equal(overlap(g,[15,15,45,45]),450)
 const water=zonalCanopy(polygon(15,15,75,45),grid,Uint8Array.from([0,60]),Uint8Array.from([11,21]))
 assert.equal(water.canopyPct,60);assert.equal(water.waterShare,0.5)
 const nodata=zonalCanopy(g,grid,Uint8Array.from([254,255]),Uint8Array.from([21,21]))
 assert.equal(nodata.canopyPct,null);assert.equal(nodata.canopyStatus,'missing')
 const outer=polygon(0,0,60,60);outer.coordinates.push(polygon(15,15,45,45).coordinates[0]);assert.equal(geometryArea(outer),2700)
 assert.equal(overlap(outer,[15,15,45,45]),0)
})
test('#148 exactly 10 land centers uses pixel-center mean, no nonzero-only filter',()=>{
 const g=polygon(15,15,315,45),grid={bbox:[15,15,315,45],width:10,height:1}
 const result=zonalCanopy(g,grid,Uint8Array.from([0,10,20,30,40,50,60,70,80,90]),new Uint8Array(10).fill(21))
 assert.equal(result.landPixels,10);assert.equal(result.areaWeighted,false);assert.equal(result.canopyPct,45)
 const zero=zonalCanopy(g,grid,new Uint8Array(10),new Uint8Array(10).fill(21));assert.equal(zero.canopyPct,0);assert.equal(zero.canopyStatus,'ok')
})
test('#148 proj4js EPSG5070 and CONUS 30m grid corners',()=>{
 const g=projectedGeometry(polygon(-122.7,45.5,-122.69,45.51)),grid=snappedGrid([g])
 for(const n of grid.bbox)assert.equal(((n%30)+30)%30,15)
 assert.equal(grid.width,(grid.bbox[2]-grid.bbox[0])/30);assert.equal(grid.height,(grid.bbox[3]-grid.bbox[1])/30)
})
for(const [dir,total,fingerprint]of packs)test(`#148 ${dir}: complete outcomes, pinned null/low-land lists, immutable preexisting data`,()=>{
 const {fc,meta}=load(dir);assert.equal(fc.features.length,total);assert.equal(meta.canopy!.qa!.valid,total)
 assert.deepEqual(meta.canopy!.qa!.mostlyWater,[]);assert.deepEqual(meta.canopy!.qa!.lowLand,[])
 assert.equal(meta.canopy!.qa!.missing,0);assert.ok(meta.canopy!.qa!.unobservedAreaM2<0.001)
 assert.equal(meta.canopy!.vintage,2025);assert.equal(meta.canopy!.version,'2025.6');assert.equal(meta.canopy!.waterMask!.vintage,2025)
 assert.equal(meta.canopy!.waterMask!.waterClass,11);assert.equal(meta.canopy!.waterMask!.collection,'1.2')
 assert.equal(meta.canopy!.qa!.alignedExactly,true);assert.equal(meta.canopy!.qa!.crs,'EPSG:5070');assert.ok(meta.canopy!.qa!.validLandAreaM2>0)
 if(dir!=='public/data'){const zeroOsm=fc.features.filter(f=>f.properties.treesPerAcre===0);assert.ok(zeroOsm.length>0);assert.ok(zeroOsm.some(f=>f.properties.canopyPct!>0))}
 const values=fc.features.map(f=>f.properties.canopyPct!);assert.ok(values.every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=100))
 const breaks=meta.metricBreaks!.canopy!;assert.ok(breaks.every((x,i)=>i===0||x>breaks[i-1]));assert.equal(metricMeta(meta,'canopy').colors.length,breaks.length+1)
 assert.deepEqual(meta.plantNeed!.inputs,['canopyPct','pctPoverty','pctAsthma?']);assert.equal(meta.plantNeed!.canopyVersion,'2025.6')
 const originals=structuredClone(fc);for(const f of originals.features){delete f.properties.landAcres;delete f.properties.canopyPct;delete f.properties.canopyStatus;delete f.properties.plantNeed;delete f.properties.plantNeedParts}
 assert.equal(createHash('sha256').update(JSON.stringify(originals)).digest('hex'),fingerprint)
})
test('#148 formula preserved: pack minmax inverted canopy, same poverty/asthma and rounding',()=>{
 for(const [dir]of packs){const {fc}=load(dir), props=fc.features.map(f=>f.properties)
  const scale=(key:'canopyPct'|'pctPoverty'|'pctAsthma')=>{const values=props.map(p=>p[key]).filter((v):v is number=>typeof v==='number'&&Number.isFinite(v)),lo=Math.min(...values),hi=Math.max(...values);return (x:number)=>hi===lo?50:100*(x-lo)/(hi-lo)}
  const t=scale('canopyPct'),p=scale('pctPoverty'),a=scale('pctAsthma'),round=(v:number)=>Math.round(v*10)/10
  for(const row of props){if(row.canopyPct==null||row.pctPoverty==null){assert.equal(row.plantNeed,undefined);continue}
   const T=100-t(row.canopyPct),P=p(row.pctPoverty),A=row.pctAsthma==null?null:a(row.pctAsthma),parts=A==null?[T,P]:[T,P,A]
   assert.equal(row.plantNeed,round(Math.max(0,Math.min(100,parts.reduce((s,x)=>s+x,0)/parts.length))))
   assert.equal(row.plantNeedParts!.T,round(T)||0)
  }
 }
})
test('#148 sources match loaded versions, omitted missing clauses, both packs and no CDC early-return',()=>{
 const {meta}=load('public/data');assert.equal(canopyTooltip(meta),METRICS.canopy.tooltip)
 assert.match(canopyCitation(meta),/v2025-6, 2025 map year, 30 m/);assert.match(canopyCitation(meta),/Collection 1.2 Land Cover, 2025 map year, class 11/)
 assert.match(canopyCitation(meta),/USDA Forest Service. 2026/);assert.match(canopyCitation(meta),/USGS\), 2024/)
 assert.doesNotMatch(canopyTooltip({}),/undefined|2025|v2025/)
 const noCdc={...meta,cdcPlaces:undefined},second=structuredClone(noCdc);second.canopy!.vintage=2030;second.canopy!.waterMask!.vintage=2029
 const comments=currentViewComments([{id:'first',meta:noCdc},{id:'second',meta:second}],['trees'],'url').join('\n')
 assert.match(comments,/2025 map year/);assert.match(comments,/2030 map year/);assert.match(comments,/2029 map year/);assert.match(comments,/\(pack second\)/)
 assert.match(canopyHelper(meta),/USFS satellite-based canopy estimate for 2025/)
})
test('#148 snapshot flip, floor, exact all/ties/zero/missing/water and separate 23-id shortlist',()=>{
 assert.equal(SNAPSHOT_CANOPY_METRIC,'canopy');assert.ok(SNAPSHOT_EXCLUDED_METRICS.includes('trees')&&SNAPSHOT_EXCLUDED_METRICS.includes('canopy'))
 const row=snapshotRow(score(Array.from({length:19},(_,i)=>i),12),'Example','acre');assert.equal(row.line2,'More tree canopy than 66% of other tracts in Example')
 assert.equal(snapshotRow(score(new Array(10).fill(0),0),'Example','km2').line2,'Same estimated tree canopy as all 9 other tracts in Example')
 assert.equal(snapshotRow(score([0,0,1,2,3,4,5,6,7,8],0),'Example','acre').line2,'Tied with 1 other tracts in Example at 0% estimated tree canopy')
 assert.equal(snapshotRow(score([0,1,2,3,4,5,6,7,8,9],0),'Example','acre').line2,'Less tree canopy than all 9 other tracts in Example')
 assert.equal(snapshotRow(score([0,1,2,3,4,5,6,7,8,9],9),'Example','acre').line2,'More tree canopy than all 9 other tracts in Example')
 const {fc,meta}=load('public/data');fc.features[0].properties.canopyPct=null;fc.features[0].properties.canopyStatus='mostly-water'
 const s=tractSnapshot(fc,fc.features[0].properties.geoid,meta)!;assert.equal(s.canopy,null);assert.equal(snapshotCanopyUnavailable(s),'Mostly water — no canopy estimate')
})
for(const [dir,geoid,value,n,L,H,display]of [
 ['public/data','41051003100',27.609001406469762,98,70,27,'Tree canopy · 27.6% of land'],
 ['public/data/central-miami-fl','12086002404',10.479882237487733,152,105,46,'Tree canopy · 10.5% of land'],
 ['public/data/orlando-fl','12095010201',14.607948442534909,43,14,28,'Tree canopy · 14.6% of land'],
] as const)test(`#148 actual dry-run check ${geoid}`,()=>{
 const {fc,meta}=load(dir),s=tractSnapshot(fc,geoid,meta)!.canopy!;assert.equal(s.value,value);assert.deepEqual([s.validCount,s.lower,s.higher,s.tied],[n,L,H,0])
 assert.equal(snapshotRow(s,meta.cityName.replace(/, [A-Z]{2}$/,''),'acre').line1,display);assert.equal(s.modelEstimate,false)
})
test('#148 parsed full/current/dual/compare CSV parity and row-by-row Miami mappings, units and null fixtures',()=>{
 const {fc,meta}=load('public/data/central-miami-fl'),rows=fc.features.map(f=>f.properties),[header,...full]=parse(toCsv(rows,meta))
 assert.equal(header.length,103);assert.equal(new Set(header).size,103);assert.equal(header.at(-1),'canopy_gap_acres');assert.ok(header.includes('plant_need_canopy')&&!header.includes('plant_need_trees'))
 for(let i=0;i<rows.length;i++){const t=rows[i],r=full[i];assert.equal(r.length,header.length);for(const [key,value]of Object.entries({tree_count:t.treeCount,trees_per_acre:t.treesPerAcre,trees_per_km2:t.treesPerKm2,canopy_pct:t.canopyPct,plant_need_canopy:t.plantNeedParts!.T,pct_uninsured:t.pctUninsured,sidewalk_km:t.sidewalkKm})){assert.equal(r[header.indexOf(key)],value==null?'':String(value))}}
 const fixtures=[...rows,{...rows[0],geoid:'zero',name:'Elm, "Oak"\nSt',canopyPct:0},{...rows[0],geoid:'water',canopyPct:null,canopyStatus:'mostly-water'},{...rows[0],geoid:'missing',canopyPct:null,canopyStatus:'missing'}] as TractProps[]
 for(const unit of ['acre','km2']as const)for(const metrics of [['canopy'],['canopy','uninsured'],['trees']] as const)for(const compare of [false,true]){
  const viewRows=fixtures.map(props=>({props,cityId:'miami',cityName:'Miami, FL'})),[h,...data]=parse(toCurrentViewCsv({rows:viewRows,metrics:[...metrics],unit,compare,comments:[]}))
  assert.equal(new Set(h).size,h.length);assert.equal(data.length,fixtures.length)
  for(const r of data){assert.equal(r.length,h.length);const t=fixtures.find(t=>t.geoid===r[h.indexOf('geoid')])!;assert.equal(r[h.indexOf('canopy_pct')],t.canopyPct==null?'':String(t.canopyPct));assert.equal(r[h.indexOf('tract_name')],t.name)}
 }
 const fullFixtures=parse(toCsv(fixtures.slice(-3),meta));assert.equal(fullFixtures[1][header.indexOf('canopy_pct')],'0');assert.equal(fullFixtures[2][header.indexOf('canopy_pct')],'');assert.equal(fullFixtures[3][header.indexOf('canopy_pct')],'')
})

test('#148 actual MapView paint expression: missing/water invalids neutral, numeric zero low green, 100 high green',()=>{
 const source=readFileSync('src/components/MapView.vue','utf8'),body=source.match(/function fillColor\(\): ExpressionSpecification[\s\S]*?\n}/)![0]
 const build=new Function('props','choroplethColors','choroplethMode','choroplethPalette','pm','isDark',stripTypeScriptTypes(body)+';return fillColor()')
 for(const dark of [false,true]){
  const expr=build({meta:{breaks:[10,20,30,40]}},()=>['#d9f0a3','#addd8e','#78c679','#31a354','#006837'],{value:'green'},{value:'default'},{value:{id:'canopy',valueKey:'canopyPct'}},{value:dark})
  const compiled=createExpression(expr,{type:'color',default:'#ff00ff'} as any);assert.equal(compiled.result,'success')
  const evaluate=(properties:Record<string,unknown>)=>(compiled.value as any).evaluate({zoom:0},{type:3,properties}).toString()
  const neutral=evaluate({canopyPct:null,canopyStatus:'mostly-water'})
  for(const canopyPct of [undefined,null,-1,101,'0',NaN,Infinity])assert.equal(evaluate({canopyPct}),neutral)
  assert.notEqual(evaluate({canopyPct:0}),neutral);assert.notEqual(evaluate({canopyPct:100}),neutral);assert.notEqual(evaluate({canopyPct:0}),evaluate({canopyPct:100}))
 }
})

test('#148 build-time constant range 50, optional asthma, missing poverty and no OSM fallback on null canopy',()=>{
 const dir=mkdtempSync(join(tmpdir(),'canopy148-need-'))
 try{
  const properties=[{canopyPct:10,pctPoverty:2,pctAsthma:4,treesPerAcre:0},{canopyPct:10,pctPoverty:2,treesPerAcre:999},{canopyPct:null,pctPoverty:2,treesPerAcre:999},{canopyPct:10,pctPoverty:null,treesPerAcre:999}]
  writeFileSync(join(dir,'tracts-equity.geojson'),JSON.stringify({type:'FeatureCollection',features:properties.map(properties=>({type:'Feature',properties,geometry:null}))}))
  writeFileSync(join(dir,'meta.json'),JSON.stringify({overall:{},canopy:{version:'2025.6'}}))
  execFileSync(process.execPath,['scripts/add-plant-need.mjs',dir])
  const rows=JSON.parse(readFileSync(join(dir,'tracts-equity.geojson'),'utf8')).features.map((f:any)=>f.properties)
  assert.equal(rows[0].plantNeed,50);assert.deepEqual(rows[0].plantNeedParts,{T:50,P:50,A:50})
  assert.equal(rows[1].plantNeed,50);assert.deepEqual(rows[1].plantNeedParts,{T:50,P:50})
  for(const i of [2,3]){assert.equal('plantNeed'in rows[i],false);assert.equal('plantNeedParts'in rows[i],false)}
 }finally{rmSync(dir,{recursive:true,force:true})}
})

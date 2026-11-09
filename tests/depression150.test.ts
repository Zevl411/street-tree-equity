import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { readFileSync,writeFileSync,mkdtempSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { Meta,TractCollection,TractProps } from '../src/types.ts'
import { METRIC_IDS,METRIC_SWITCH_ORDER } from '../src/utils/metrics.ts'
import { PLACES_MEASURES,PLACES_DATA_IDS,PLACES_METRIC_IDS,placesMetricCitation } from '../src/utils/placesMeasures.ts'
import { SNAPSHOT_EXCLUDED_METRICS } from '../src/utils/tractSnapshot.ts'
import { CSV_HEADERS,toCsv } from '../src/utils/fullCsv.ts'
// @ts-ignore build-only generic CSV reader; never needs data-raw/network/Python at test time.
import { readPlaces,placesNum,parseCi,splitCsv } from '../scripts/lib/places.mjs'

const baseline=JSON.parse(readFileSync(new URL('fixtures/depression150-baseline.json',import.meta.url),'utf8'))
const fields=['pctDepression','pctDepressionLo','pctDepressionHi','depressionAdultPop'] as const
const hash=(s:string)=>createHash('sha256').update(s).digest('hex')
const load=(dir:string):{fc:TractCollection;meta:Meta}=>({fc:JSON.parse(readFileSync(`${dir}/tracts-equity.geojson`,'utf8')),meta:JSON.parse(readFileSync(`${dir}/meta.json`,'utf8'))})
for(const dir of Object.keys(baseline.packs))test(`#150 ${dir}: complete value/CI coverage, only four new props, unchanged geometry/canopy/gap/Planting need`,()=>{
 const {fc,meta:m}=load(dir),p=baseline.packs[dir]
 assert.equal(fc.features.length,p.n)
 for(const f of fc.features){const t=f.properties
  for(const k of fields)assert.ok(typeof t[k]==='number'&&Number.isFinite(t[k]),`${t.geoid} ${k}`)
  assert.ok(t.pctDepression!>=0&&t.pctDepression!<=100&&t.pctDepressionLo!<=t.pctDepression!&&t.pctDepressionHi!>=t.pctDepression!&&t.depressionAdultPop!>0)
 }
 const stripped=structuredClone(fc);for(const f of stripped.features)for(const k of fields)delete f.properties[k]
 assert.equal(hash(JSON.stringify(stripped)),p.collectionSha256,'every original property and geometry, including precision and key order, matches main 6e0996d')
 assert.equal(hash(JSON.stringify(fc.features.map(f=>f.geometry))),p.geometrySha256)
 assert.equal(hash(JSON.stringify([m.canopy,m.canopyGap,m.plantNeed,m.metricBreaks!.canopy,m.metricBreaks!.canopyGap,m.metricBreaks!.plantNeed,m.overall.canopyPct,m.overall.canopyGapAcres,m.overall.plantNeed])),p.protectedMetaSha256)
 assert.equal(m.cdcPlaces!.years!.DEPRESSION,2023);assert.equal('dataYear'in m.cdcPlaces!,false)
 assert.ok(m.metricBreaks!.depression!.length>0);assert.ok(Number.isFinite(m.overall.pctDepression));assert.ok(Number.isFinite(m.overall.pctDepressionMedian))
})
test('#150 shared data order/polarity/eligibility prepared; no UI metric, order or About/citation activation before lock',()=>{
 assert.equal(PLACES_DATA_IDS.at(-1),'depression')
 assert.deepEqual(PLACES_MEASURES.depression![3],{valueKey:'pctDepression',higherIsBetter:false})
 assert.equal((SNAPSHOT_EXCLUDED_METRICS as readonly string[]).includes('depression'),false)
 assert.match(readFileSync('src/utils/tractSnapshot.ts','utf8'),/'mentalHealth', 'depression', 'physicalHealth'/)
 assert.equal((METRIC_IDS as readonly string[]).includes('depression'),false)
 assert.equal((METRIC_SWITCH_ORDER as readonly string[]).includes('depression'),false)
 assert.equal((PLACES_METRIC_IDS as readonly string[]).includes('depression'),false)
 assert.equal(PLACES_DATA_IDS.length,15);assert.equal(PLACES_METRIC_IDS.length,14)
 assert.match(readFileSync('src/utils/currentViewCsv.ts','utf8'),/const CI_KEYS[^\n]*'pctDepression'/)
})
test('#150 direct Socrata yjkw-uj5s check: 12086002404 = 14.1, 95% CI 11.8–16.4; year from column metadata',()=>{
 const t=load('public/data/central-miami-fl').fc.features.find(f=>f.properties.geoid==='12086002404')!.properties
 const raw=baseline.source.checkRow
 assert.equal(baseline.source.dataset,'yjkw-uj5s');assert.equal(raw.tractfips,t.geoid)
 assert.equal(t.pctDepression,Number(raw.depression_crudeprev));assert.deepEqual([t.pctDepressionLo,t.pctDepressionHi],parseCi(raw.depression_crude95ci))
 assert.deepEqual([t.pctDepression,t.pctDepressionLo,t.pctDepressionHi,t.depressionAdultPop],[14.1,11.8,16.4,4491])
 assert.equal(baseline.source.yearColumn.fieldName,'depression_crudeprev');assert.match(baseline.source.yearColumn.description,/2023/)
 assert.match(placesMetricCitation('depression',{DEPRESSION:2023})!,/2023/)
 assert.doesNotMatch(placesMetricCitation('depression',{})!,/BRFSS|2023|undefined/)
})
test('#150 full CSV is exactly 106 unique columns; legacy 103 headers unchanged, depression values and every row align in all 7 packs/both targets',()=>{
 assert.equal(CSV_HEADERS.length,106);assert.equal(new Set(CSV_HEADERS).size,106)
 assert.deepEqual(CSV_HEADERS.filter(h=>!h.startsWith('pct_depression')),baseline.legacyCsvHeaders)
 assert.deepEqual(CSV_HEADERS.slice(84,87),['pct_depression','pct_depression_ci_lo','pct_depression_ci_hi'])
 let count=0
 for(const dir of Object.keys(baseline.packs)){const {fc,meta}=load(dir)
  for(const mode of ['p75','30']as const){const [h,...rows]=toCsv(fc.features.map(f=>f.properties),meta,mode).trimEnd().split('\r\n').map(splitCsv)
   assert.equal(rows.length,fc.features.length)
   rows.forEach((row:string[],i:number)=>{assert.equal(row.length,106);for(const [header,key]of [['pct_depression','pctDepression'],['pct_depression_ci_lo','pctDepressionLo'],['pct_depression_ci_hi','pctDepressionHi']]as const)assert.equal(row[h.indexOf(header)],String(fc.features[i].properties[key]))})
  }count+=fc.features.length
 }assert.equal(count,464)
})
function fixture(dir:string,missing=false){
 const fc={type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]},properties:{geoid:'12086002404',name:'Tract 24.04',canopyPct:10.479882237487733,landAcres:226.6226626943888,pctMentalHealth:99,plantNeed:42,plantNeedParts:{T:1,P:2,A:3}}}]}
 const meta={overall:{pctMentalHealth:99},metricBreaks:{mentalHealth:[1,2]},cdcPlaces:{measures:['MHLTH'],years:{MHLTH:2023},columns:{pctMentalHealth:'mhlth_crudeprev'}}}
 writeFileSync(join(dir,'tracts-equity.geojson'),JSON.stringify(fc));writeFileSync(join(dir,'meta.json'),JSON.stringify(meta))
 const csv=join(dir,'source.csv')
 writeFileSync(csv,'TractFIPS,DEPRESSION_CrudePrev,DEPRESSION_Crude95CI,TotalPop18plus\n12086002404,'+(missing?'':14.1)+',"(11.8, 16.4)",4491\n')
 const env={...process.env,PLACES_MEASURES:'DEPRESSION',PLACES_DEPRESSION_YEAR:'2023',PLACES_CSV:csv,PLACES_DIR:dir,PLACES_RETRIEVED:'2026-11-09'}
 return{fc,env}
}
test('#150 generic places.mjs handles DEPRESSION headers case-insensitively, quoted CI, and zero vs missing',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ste-depression-reader-'))
 try{const {env}=fixture(dir),{columns,rows}=await readPlaces(env.PLACES_CSV,['depression_crudeprev','depression_crude95ci','totalpop18plus'],new Set(['12086002404']))
  assert.equal(columns.depression_crudeprev,'DEPRESSION_CrudePrev')
  const row=rows.get('12086002404');assert.equal(placesNum(row.depression_crudeprev),14.1);assert.deepEqual(parseCi(row.depression_crude95ci),[11.8,16.4])
  assert.equal(placesNum('0'),0);assert.equal(placesNum(''),null);assert.equal(placesNum('NaN'),null);assert.equal(parseCi(''),null)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('#150 incremental join uses the existing pipeline without touching old fields; metadata years merge and no dataYear returns',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ste-depression-join-'))
 try{const {fc,env}=fixture(dir)
  execFileSync(process.execPath,['scripts/add-cdc-places.mjs',dir],{env,stdio:'pipe'})
  const actual=load(dir),t=actual.fc.features[0].properties
  assert.deepEqual([t.pctDepression,t.pctDepressionLo,t.pctDepressionHi,t.depressionAdultPop],[14.1,11.8,16.4,4491])
  for(const k of fields)delete t[k]
  assert.equal(JSON.stringify(actual.fc),JSON.stringify(fc))
  assert.deepEqual(actual.meta.cdcPlaces!.measures,['MHLTH','DEPRESSION']);assert.deepEqual(actual.meta.cdcPlaces!.years,{MHLTH:2023,DEPRESSION:2023})
  assert.equal(actual.meta.overall.pctMentalHealth,99);assert.equal('dataYear'in actual.meta.cdcPlaces!,false)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('#150 incomplete DEPRESSION coverage stops before writing a pack, never silently switches to GHLTH',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ste-depression-missing-'))
 try{const {env}=fixture(dir,true),before=readFileSync(join(dir,'tracts-equity.geojson'),'utf8'),metaBefore=readFileSync(join(dir,'meta.json'),'utf8')
  assert.throws(()=>execFileSync(process.execPath,['scripts/add-cdc-places.mjs',dir],{env,stdio:'pipe'}),/STOP: DEPRESSION coverage 0\/1/)
  assert.equal(readFileSync(join(dir,'tracts-equity.geojson'),'utf8'),before);assert.equal(readFileSync(join(dir,'meta.json'),'utf8'),metaBefore)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('#150 unknown incremental measure is rejected instead of silently writing incomplete metadata',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ste-depression-unknown-'))
 try{const {env}=fixture(dir)
  assert.throws(()=>execFileSync(process.execPath,['scripts/add-cdc-places.mjs',dir],{env:{...env,PLACES_MEASURES:'NOT_A_MEASURE'},stdio:'pipe'}),/Unknown PLACES_MEASURES/)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

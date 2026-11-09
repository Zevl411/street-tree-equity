import assert from 'node:assert/strict'
import { test } from 'node:test'
import { stripTypeScriptTypes } from 'node:module'
import { createHash } from 'node:crypto'
import { readFileSync,writeFileSync,mkdtempSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { Meta,TractCollection,TractProps } from '../src/types.ts'
import { METRIC_IDS,METRIC_SWITCH_ORDER,METRICS,DEFAULT_METRIC,resolveMetric,normalizeMetric,metricAvailable,fmtUnitless,hotspotAscending } from '../src/utils/metrics.ts'
import { PLACES_MEASURES,PLACES_METRIC_IDS,placesMetricCitation,DEPRESSION_METHODS } from '../src/utils/placesMeasures.ts'
import { SNAPSHOT_EXCLUDED_METRICS,SNAPSHOT_CANDIDATE_METRICS,snapshotMetric,snapshotRow,tractSnapshot } from '../src/utils/tractSnapshot.ts'
import { toCurrentViewCsv,currentViewComments,metricHasCi,metricValueCell,metricUnitToken } from '../src/utils/currentViewCsv.ts'
import { GAP_COLUMNS,gapCells,scenarioProps } from '../src/utils/canopyGap.ts'
import { readDeepLink } from '../src/composables/useDeepLink.ts'
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
 const stripped=structuredClone(fc);for(const f of stripped.features)for(const k of [...fields,'pctGeneralHealth','pctGeneralHealthLo','pctGeneralHealthHi','generalHealthAdultPop'] as const)delete f.properties[k]
 assert.equal(hash(JSON.stringify(stripped)),p.collectionSha256,'every original property and geometry, including precision and key order, matches main 6e0996d')
 assert.equal(hash(JSON.stringify(fc.features.map(f=>f.geometry))),p.geometrySha256)
 assert.equal(hash(JSON.stringify([m.canopy,m.canopyGap,m.plantNeed,m.metricBreaks!.canopy,m.metricBreaks!.canopyGap,m.metricBreaks!.plantNeed,m.overall.canopyPct,m.overall.canopyGapAcres,m.overall.plantNeed])),p.protectedMetaSha256)
 assert.equal(m.cdcPlaces!.years!.DEPRESSION,2023);assert.equal('dataYear'in m.cdcPlaces!,false)
 assert.ok(m.metricBreaks!.depression!.length>0);assert.ok(Number.isFinite(m.overall.pctDepression));assert.ok(Number.isFinite(m.overall.pctDepressionMedian))
})
test('#150 locked registry, append-only data order, switch adjacency, lower-is-better polarity and explicit snapshot eligibility',()=>{
 assert.equal(PLACES_METRIC_IDS.at(-1),'depression')
 assert.equal(METRICS.depression.valueKey,'pctDepression');assert.equal(METRICS.depression.higherIsBetter,false)
 assert.equal((SNAPSHOT_EXCLUDED_METRICS as readonly string[]).includes('depression'),false)
 assert.match(readFileSync('src/utils/tractSnapshot.ts','utf8'),/'mentalHealth', 'depression', 'physicalHealth'/)
 assert.equal(METRIC_IDS.at(-1),'depression')
 assert.deepEqual(METRIC_SWITCH_ORDER.slice(METRIC_SWITCH_ORDER.indexOf('mentalHealth'),METRIC_SWITCH_ORDER.indexOf('mentalHealth')+3),['mentalHealth','depression','physicalHealth'])
 assert.ok(SNAPSHOT_CANDIDATE_METRICS.includes('depression'));assert.equal(SNAPSHOT_CANDIDATE_METRICS.length,24)
 assert.equal(PLACES_METRIC_IDS.length,15);assert.equal(DEFAULT_METRIC,'canopy')
 assert.match(readFileSync('src/utils/currentViewCsv.ts','utf8'),/const CI_KEYS[^\n]*'pctDepression'/)
})
test('#150 direct Socrata yjkw-uj5s check: 12086002404 = 14.1, 95% CI 11.8–16.4; year from column metadata',()=>{
 const t=load('public/data/central-miami-fl').fc.features.find(f=>f.properties.geoid==='12086002404')!.properties
 const expected=baseline.source.expected
 assert.equal(baseline.source.dataset,'yjkw-uj5s');assert.equal(expected.geoid,t.geoid)
 assert.equal(t.pctDepression,expected.value);assert.deepEqual([t.pctDepressionLo,t.pctDepressionHi],expected.ci)
 assert.deepEqual([t.pctDepression,t.pctDepressionLo,t.pctDepressionHi,t.depressionAdultPop],[14.1,11.8,16.4,4491])
 assert.equal(load('public/data/central-miami-fl').meta.cdcPlaces!.years!.DEPRESSION,expected.brfssYear)
 assert.match(placesMetricCitation('depression',{DEPRESSION:2023})!,/2023/)
 assert.doesNotMatch(placesMetricCitation('depression',{})!,/BRFSS|2023|undefined/)
})
test('#150 full CSV is 109 unique columns after #151; legacy 103 headers unchanged, depression values and every row align in all 7 packs/both targets',()=>{
 assert.equal(CSV_HEADERS.length,109);assert.equal(new Set(CSV_HEADERS).size,109)
 assert.deepEqual(CSV_HEADERS.filter(h=>!h.startsWith('pct_depression')&&!h.startsWith('pct_general_health')),baseline.legacyCsvHeaders)
 assert.deepEqual(CSV_HEADERS.slice(84,87),['pct_depression','pct_depression_ci_lo','pct_depression_ci_hi'])
 let count=0
 for(const dir of Object.keys(baseline.packs)){const {fc,meta}=load(dir)
  for(const mode of ['p75','30']as const){const [h,...rows]=toCsv(fc.features.map(f=>f.properties),meta,mode).trimEnd().split('\r\n').map(splitCsv)
   assert.equal(rows.length,fc.features.length)
   rows.forEach((row:string[],i:number)=>{assert.equal(row.length,109);for(const [header,key]of [['pct_depression','pctDepression'],['pct_depression_ci_lo','pctDepressionLo'],['pct_depression_ci_hi','pctDepressionHi']]as const)assert.equal(row[h.indexOf(header)],String(fc.features[i].properties[key]))})
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

test('#150 exact locked registry/copy, aliases and preserved MHLTH links; no current-state alias or unit conversion',()=>{
 const d=METRICS.depression
 assert.equal(d.label,'Depression history (adults)');assert.equal(d.shortLabel,'Depression history')
 assert.equal(d.legendTitle('acre'),'Adults ever told they had a depressive disorder');assert.equal(d.hotspotTitle,'Highest share reporting a depression history')
 assert.equal(d.bmCaption,'Dims tracts below this city’s median share of adults ever told they had a depressive disorder')
 assert.equal(d.missingCaption,'This pack has no depression-history estimate yet');assert.equal(d.percentPoints,true);assert.notEqual(d.percent,true)
 for(const token of ['depression','DEPRESSION',' DePrEsSiVe ',' DEPRESSIVE DISORDER '])assert.equal(resolveMetric(token),'depression')
 for(const token of ['mental','mentalhealth','mhlth'])assert.equal(resolveMetric(token),'mentalHealth')
 for(const token of ['depressed','depression symptoms','current depression rate'])assert.equal(resolveMetric(token),null)
 assert.equal(normalizeMetric(undefined),'canopy');assert.equal(hotspotAscending(d),false);assert.equal(metricHasCi('depression'),true)
 for(const unit of ['acre','km2']as const){assert.equal(metricUnitToken(d,unit),'%');assert.equal(metricValueCell(d,{pctDepression:14.1}as TractProps,unit),'14.1')}
 assert.equal(fmtUnitless(d,14.1),'14.1%');assert.equal(fmtUnitless(d,0),'0.0%')
 assert.match(d.tooltip!,/lifetime history measure, not necessarily current depression/)
})
test('#150 dynamic citation year, exact shared methods and readable details/migration/docs copy',()=>{
 const expected='Depression among adults (tract) — CDC PLACES: Local Data for Better Health, 2025 release (BRFSS 2023 model-based estimates). Centers for Disease Control and Prevention, National Center for Chronic Disease Prevention and Health Promotion, Division of Population Health. This product uses CDC PLACES data but is not endorsed by CDC or HHS. Estimates are model-based small-area estimates of self-reported depression history (ever told of a depressive disorder), not diagnoses or direct measurements, and should not be used for clinical decisions.'
 assert.equal(placesMetricCitation('depression',{DEPRESSION:2023}),expected)
 assert.equal(placesMetricCitation('depression',{DEPRESSION:2042}),expected.replace('BRFSS 2023','BRFSS 2042'))
 assert.equal(placesMetricCitation('depression',{DEPRESSION:NaN}),expected.replace('BRFSS 2023 model-based estimates','model-based estimates'))
 assert.equal(DEPRESSION_METHODS,'Depression history is the estimated share of adults aged 18+ who report ever being told by a doctor, nurse, or other health professional that they had a depressive disorder. It is a lifetime measure, not necessarily current depression, and does not describe severity or duration. Mental health (MHLTH) measures 14+ days of poor mental health in the past 30 days. These measures describe communities, not individuals.')
 const details=readFileSync('src/components/TractDetails.vue','utf8'),app=readFileSync('src/App.vue','utf8')
 assert.ok(details.indexOf('tract.pctDepression)')>details.indexOf('Adults with frequent mental distress'))
 assert.ok(details.indexOf('class="depression-detail"')<details.indexOf('Adults with frequent physical distress'))
 assert.ok(details.includes('Lifetime history, not necessarily current depression. Mental health (MHLTH) measures 14+ days of poor mental health in the past 30 days.'))
 assert.ok(app.includes('Nov 2026: Added Depression history (CDC PLACES 2025), a model estimate of adults ever told they had a depressive disorder. Mental health still shows 14+ days of poor mental health in the past 30 days.'))
 for(const file of ['README.md','docs/user-guide.md'])assert.ok(readFileSync(file,'utf8').includes("Depression history can appear among the snapshot's three comparisons, where it is marked as a model estimate."))
})
test('#150 all seven locked break/weighted-overall values and availability/null/zero rules',()=>{
 const expected:Record<string,[number[],number]>={'public/data':[[26.7,29.2,30.6,31.8],30.6],'central-miami-fl':[[11.5,12.9,13.8,15],13.9],'melbourne-fl':[[15.7,18.2,19.2,20.2],19.1],'pembroke-pines-fl':[[11.7,14.1,14.8,15.6],14.8],'orlando-fl':[[14.3,16.6,17.4,18.2],17.3],'tampa-fl':[[13.7,15.7,16.7,17.8],16.8],'central-jacksonville-fl':[[17.8,19.6,20.1,20.9],20.2]}
 for(const [name,[breaks,mean]]of Object.entries(expected)){const {fc,meta}=load(name==='public/data'?name:'public/data/'+name);assert.deepEqual(meta.metricBreaks!.depression,breaks);assert.equal(meta.overall.pctDepression,mean);assert.equal(metricAvailable('depression',meta,fc),true)}
 const {fc,meta}=load('public/data/central-miami-fl'),zeros={...fc,features:fc.features.map(f=>({...f,properties:{...f.properties,pctDepression:0}}))}
 assert.equal(metricAvailable('depression',meta,zeros),true)
 assert.equal(metricAvailable('depression',{...meta,metricBreaks:{...meta.metricBreaks,depression:undefined}},fc),false)
 assert.equal(metricAvailable('depression',meta,{...fc,features:fc.features.map(f=>({...f,properties:{...f.properties,pctDepression:undefined}}))}),false)
})
test('#150 real Miami depression snapshot score is model-based, B85/T0/n152 =>56%, eligible24 but not forced into top3',()=>{
 const {fc,meta}=load('public/data/central-miami-fl'),t=fc.features.find(f=>f.properties.geoid==='12086002404')!.properties
 const score=snapshotMetric('depression',t.pctDepression!,fc.features.map(f=>f.properties.pctDepression!).sort((a,b)=>a-b))!
 assert.deepEqual([score.validCount,score.lower,score.tied,score.higher],[152,85,0,66]);assert.ok(Math.abs(score.badness-56.29139072847682)<1e-10)
 const row=snapshotRow(score,'Miami','acre');assert.equal(row.line1,'Depression history · 14.1% · model estimate');assert.equal(row.line2,'Higher than 56% of other tracts in Miami')
 assert.equal(row.ariaLabel,'Switch map to Depression history, higher than 56% of other tracts in Miami, 14.1%, model estimate')
 const s=tractSnapshot(fc,t.geoid,meta)!;assert.equal(s.eligibleCount,24);assert.deepEqual(s.worst.map(v=>v.metricId),['income','diabetes','physicalHealth'])
 const zero=snapshotMetric('depression',0,[0,1,2,3,4,5,6,7,8,9])!;assert.equal(snapshotRow(zero,'Example','acre').line1,'Depression history · 0.0% · model estimate')
 assert.equal(snapshotMetric('depression',1,[0,1,2,3,4,5,6,7,8]),null)
})
test('#150 active single/dual/compare CSVs preserve CI slots, raw values/null/zero, both units/targets and dynamic source year',()=>{
 const {fc,meta}=load('public/data/central-miami-fl'),t=fc.features.find(f=>f.properties.geoid==='12086002404')!.properties
 const props=[t,{...t,geoid:'zero',pctDepression:0,pctDepressionLo:0,pctDepressionHi:0},{...t,geoid:'missing',pctDepression:undefined,pctDepressionLo:undefined,pctDepressionHi:undefined}]
 for(const unit of ['acre','km2']as const)for(const gapTarget of ['p75','30']as const)for(const compare of [false,true])for(const metrics of [['depression'],['depression','trees'],['depression','mentalHealth'],['depression','income']]as const){
  const text=toCurrentViewCsv({rows:props.map(props=>({cityId:'miami',cityName:'Miami, FL',meta,props})),metrics:[...metrics],unit,compare,gapTarget,comments:[]})
  const [h,...rows]=text.trimEnd().split('\r\n').filter(l=>!l.startsWith('#')).map(splitCsv)
  const n=(metrics.length===1?16:metrics[1]==='income'?24:22)+(compare?2:0)
  assert.equal(h.length,n);assert.ok(rows.every((r:string[])=>r.length===n))
  const key=metrics.length===1?'metric':'metric_a'
  assert.equal(rows[0][h.indexOf(key+'_value')],'14.1');assert.equal(rows[0][h.indexOf(key+'_ci_lo')],'11.8');assert.equal(rows[0][h.indexOf(key+'_ci_hi')],'16.4');assert.equal(rows[0][h.indexOf(key+'_unit')],'%')
  assert.equal(rows.find((r:string[])=>r[h.indexOf('geoid')]==='zero')![h.indexOf(key+'_value')],'0.0');assert.equal(rows.find((r:string[])=>r[h.indexOf('geoid')]==='missing')![h.indexOf(key+'_value')],'')
 }
 const comments=currentViewComments([{id:'miami',meta:{...meta,cdcPlaces:{...meta.cdcPlaces!,years:{...meta.cdcPlaces!.years,DEPRESSION:2042}}}}],['depression'],'https://example.test/?gapTarget=30').join('\n')
 assert.match(comments,/BRFSS 2042/);assert.match(comments,/depression history \(ever told of a depressive disorder\)/)
})
test('#150 GeoJSON snake-case triple numeric/null/zero and old geometry/canopy/gap context match full exports',()=>{
 const source=readFileSync('src/utils/exportData.ts','utf8'),fn=source.slice(source.indexOf('export function toGeoJson('),source.indexOf('/** #64:'))
 const geo=new Function('GAP_COLUMNS','gapCells','scenarioProps','ODBL_NOTICE',stripTypeScriptTypes(fn.replace('export function','function'))+';return toGeoJson')(GAP_COLUMNS,gapCells,scenarioProps,'ODbL')
 const {fc,meta}=load('public/data/central-miami-fl')
 for(const mode of ['p75','30']as const){const out=JSON.parse(geo(fc,meta,mode));for(let i=0;i<fc.features.length;i++){const t=fc.features[i].properties,p=out.features[i].properties;assert.deepEqual([p.pct_depression,p.pct_depression_ci_lo,p.pct_depression_ci_hi],[t.pctDepression,t.pctDepressionLo,t.pctDepressionHi]);assert.deepEqual(out.features[i].geometry,fc.features[i].geometry);assert.equal(p.canopy_pct,t.canopyPct);assert.equal(p.land_acres,t.landAcres)}}
 const f=fc.features[0],out=JSON.parse(geo({...fc,features:[{...f,properties:{...f.properties,pctDepression:undefined,pctDepressionLo:undefined,pctDepressionHi:undefined}},{...f,properties:{...f.properties,pctDepression:0,pctDepressionLo:0,pctDepressionHi:0}}]},meta))
 assert.deepEqual(out.features.map((f:any)=>[f.properties.pct_depression,f.properties.pct_depression_ci_lo,f.properties.pct_depression_ci_hi]),[[null,null,null],[0,0,0]])
})
test('#150 canonical/alias single and dual deep links keep gapTarget and old mentalHealth meaning',()=>{
 for(const token of ['DEPRESSION',' depressive ','depressive disorder']){const link=readDeepLink('?metric='+encodeURIComponent(token)+'&gapTarget=30&dual=trees,depression&audit=keep');assert.equal(link.metric,'depression');assert.equal(link.gapTarget,'30');assert.deepEqual(link.dual,{left:'trees',right:'depression'})}
 assert.equal(readDeepLink('?metric=mhlth').metric,'mentalHealth');assert.equal(readDeepLink('?metric=depressed').metric,'canopy')
})

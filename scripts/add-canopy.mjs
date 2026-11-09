#!/usr/bin/env node
/** #148. Build-time only, no national download or client request. python venv: pip install rasterio rasterstats. */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {projectedGeometry,snappedGrid,zonalCanopy,samplingLandAcres} from './lib/canopy.mjs'
import {checkFile} from './lib/size-guard.mjs'
import {packP75} from '../src/utils/canopyGap.ts'
import {densityBreaks} from './lib/geo-utils.mjs'
const TCC='https://imagery.geoplatform.gov/iipp/rest/services/Vegetation/USFS_EDW_NLCD_TCC_CONUS/ImageServer'
const LC='https://dmsdata.cr.usgs.gov/geoserver/mrlc_Land-Cover-Native_conus_year_data/wcs'
const PY=process.env.CANOPY_PYTHON||'data-raw/venv/bin/python'
const start=performance.now(), dirs=process.argv.slice(2)
if(!dirs.length)throw Error('Usage: add-canopy.mjs <packDir> ...')
fs.mkdirSync('data-raw/canopy148',{recursive:true})
async function request(url,params) { const u=new URL(url);for(const [k,v]of Object.entries(params))u.searchParams.set(k,typeof v==='object'?JSON.stringify(v):String(v));const r=await fetch(u,{signal:AbortSignal.timeout(180000)});if(!r.ok)throw Error(`${r.status} ${u}`);return r }
const catalog=await(await request(TCC+'/query',{f:'json',where:'beginyear=2025',outFields:'objectid,name,beginyear,endyear,resolution',returnGeometry:false})).json()
const attrs=catalog.features?.[0]?.attributes
if(catalog.features?.length!==1||attrs?.objectid!==80||!attrs.name.includes('v2025_6')||attrs.resolution!==30)throw Error('Wrong TCC version: STOP '+JSON.stringify(catalog))
// Resolve the advertised annual range, then enforce the locked 2025 source, never auto-upgrade.
const description=await(await request(LC,{service:'WCS',version:'2.0.1',request:'DescribeCoverage',coverageId:'mrlc_Land-Cover-Native_conus_year_data__Land-Cover-Native_conus_year_data'})).text()
const maskYears=[...description.matchAll(/<gml:timePosition>([0-9]{4})-/g)].map(m=>Number(m[1]))
if(Math.max(...maskYears)!==2025||!description.includes('EPSG/0/5070'))throw Error('Wrong Land Cover vintage/native CRS: STOP '+description)
fs.writeFileSync('data-raw/canopy148/land-cover-description.xml',description)
fs.writeFileSync('data-raw/canopy148/tcc-catalog.json',JSON.stringify(catalog,null,2))
const reports=[]
for(const dir of dirs) {
 const id=dir==='public/data'?'portland':path.basename(dir)
 const fc=JSON.parse(fs.readFileSync(`${dir}/tracts-equity.geojson`)),meta=JSON.parse(fs.readFileSync(`${dir}/meta.json`))
 const projected={...fc,features:fc.features.map(f=>({...f,geometry:projectedGeometry(f.geometry)}))},grid=snappedGrid(projected.features.map(f=>f.geometry))
 const baseCache=`data-raw/canopy148/${id}`, oldGrid=`${baseCache}/grid.json`
 const cache=fs.existsSync(oldGrid)&&fs.readFileSync(oldGrid,'utf8')!==JSON.stringify(grid)?`${baseCache}-${crypto.createHash('sha256').update(JSON.stringify(grid)).digest('hex').slice(0,12)}`:baseCache
 fs.mkdirSync(cache,{recursive:true})
 fs.writeFileSync(`${cache}/projected.geojson`,JSON.stringify(projected));fs.writeFileSync(`${cache}/grid.json`,JSON.stringify(grid))
 const tcc=`${cache}/tcc-2025-v2025-6.tif`,lc=`${cache}/lc-2025-c1-2.tif`
 const params={f:'pjson',bbox:grid.bbox.join(','),bboxSR:5070,imageSR:5070,size:`${grid.width},${grid.height}`,format:'tiff',pixelType:'U8',interpolation:'RSP_NearestNeighbor',adjustAspectRatio:false,mosaicRule:{mosaicMethod:'esriMosaicLockRaster',lockRasterIds:[80]},renderingRule:{rasterFunction:'None'}}
 const maskParams={service:'WCS',version:'1.0.0',request:'GetCoverage',coverage:'mrlc_Land-Cover-Native_conus_year_data:Land-Cover-Native_conus_year_data',crs:'EPSG:5070',bbox:grid.bbox.join(','),width:grid.width,height:grid.height,response_crs:'EPSG:5070',format:'GeoTIFF',time:'2025-01-01T00:00:00.000Z',interpolation:'nearest neighbor'}
 fs.writeFileSync(`${cache}/requests.json`,JSON.stringify({tcc:params,landCover:maskParams},null,2))
 if(!fs.existsSync(tcc)){const out=await(await request(TCC+'/exportImage',params)).json();if(!out.href)throw Error('TCC export failed: STOP '+JSON.stringify(out));fs.writeFileSync(`${cache}/export.json`,JSON.stringify(out));fs.writeFileSync(tcc,Buffer.from(await(await request(out.href,{})).arrayBuffer()))}
 if(!fs.existsSync(lc))fs.writeFileSync(lc,Buffer.from(await(await request(LC,maskParams)).arrayBuffer()))
 const qa=JSON.parse(execFileSync(PY,['scripts/lib/canopy.raster.py',tcc,lc,`${cache}/grid.json`],{encoding:'utf8'}))
 console.log(`[canopy] ${id} alignment: ${JSON.stringify(qa)}`)
 const canopy=fs.readFileSync(tcc+'.bin'),mask=fs.readFileSync(lc+'.bin')
 const results=projected.features.map(f=>{const r=zonalCanopy(f.geometry,grid,canopy,mask);return {geoid:f.properties.geoid,...r,landAcres:samplingLandAcres(r)}})
 fs.writeFileSync(`${cache}/support-input.json`,JSON.stringify(results))
 execFileSync(PY,['scripts/lib/canopy.support.py',`${cache}/projected.geojson`,`${cache}/support-input.json`,`${cache}/support-bounds.json`],{stdio:'inherit'})
 for(let i=0;i<fc.features.length;i++){fc.features[i].properties.canopyPct=results[i].canopyPct;fc.features[i].properties.canopyStatus=results[i].canopyStatus;fc.features[i].properties.landAcres=results[i].landAcres}
 const valid=results.filter(r=>r.canopyStatus==='ok'),weightedSum=valid.reduce((s,r)=>s+r.weightedSum,0),landArea=valid.reduce((s,r)=>s+r.validLandArea,0)
 const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
 meta.canopy={source:'USFS NLCD Tree Canopy Cover',vintage:2025,resolution:30,version:'2025.6',sourceUrl:'https://data.fs.usda.gov/geodata/rastergateway/treecanopycover/',imageServer:TCC,rasterId:80,sha256:sha(tcc),waterMask:{source:'Annual NLCD Land Cover',vintage:2025,collection:'1.2',waterClass:11,sourceUrl:'https://doi.org/10.5066/P143HE8T',serviceUrl:LC,sha256:sha(lc)},method:'EPSG:5070 equal-area 30 m CONUS grid; pixel centers; <10 valid land centers use exact polygon/pixel overlap; class 11 excluded; >=99% overlap water null; overall exact valid-land overlap weighted',qa:{...qa,valid:valid.length,missing:results.filter(r=>r.canopyStatus==='missing').length,mostlyWater:results.filter(r=>r.canopyStatus==='mostly-water').map(r=>r.geoid),lowLand:results.filter(r=>r.landPixels<10).map(r=>r.geoid),validLandAreaM2:landArea,unobservedAreaM2:results.reduce((s,r)=>s+r.unobservedArea,0),excludedFraction:1-landArea/results.reduce((s,r)=>s+r.tractArea,0),invalidLandAreaM2:results.reduce((s,r)=>s+r.invalidLandArea,0),bytes:fs.statSync(tcc).size+fs.statSync(lc).size}}
 meta.canopy.landAreaMethod='landAcres is the NLCD non-water sampling support and differs from Census land area.'
 meta.canopyGap={version:1,defaultTarget:'p75',p75:packP75(fc),percentile:{type:7,p:0.75,nValid:valid.length,weighted:false},fixedTarget:30,landArea:{field:'landAcres',squareMetresPerAcre:4046.8564224,method:'canopy-estimator-support',centers:'valid non-water landPixels * 900 m2 when count >= 10',smallTracts:'fractional valid non-water overlap when count < 10'}}
 meta.metricBreaks={...meta.metricBreaks,canopy:densityBreaks(valid.map(r=>r.canopyPct),5)};meta.overall.canopyPct=landArea?weightedSum/landArea:null
 for(const [name,value] of [['tracts-equity.geojson',fc],['meta.json',meta]]) { const text=JSON.stringify(value);checkFile(`${dir}/${name}`,Buffer.byteLength(text));fs.writeFileSync(`${dir}/${name}`,text) }
 const report={id,cache,grid,qa:meta.canopy.qa,min:Math.min(...valid.map(r=>r.canopyPct)),max:Math.max(...valid.map(r=>r.canopyPct)),breaks:meta.metricBreaks.canopy,results};reports.push(report)
 fs.writeFileSync(`${cache}/report.json`,JSON.stringify(report,null,2));console.log(`[canopy] ${id}: ${valid.length}/${results.length} valid; excluded fraction ${meta.canopy.qa.excludedFraction}; null ${JSON.stringify(results.filter(r=>r.canopyPct===null))}; low-land ${JSON.stringify(results.filter(r=>r.landPixels<10))}`)
 // Existing #135 guard is run by pack builds and report:sizes; canopy outputs are checked here too.
}
fs.writeFileSync('data-raw/canopy148/report.json',JSON.stringify({runtimeSeconds:(performance.now()-start)/1000,rssBytes:process.memoryUsage().rss,packs:reports},null,2))

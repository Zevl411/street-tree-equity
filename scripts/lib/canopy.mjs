/** #148: projected equal-area sampling and exact fractional boundary overlap, independent of rasterstats. */
import proj4 from 'proj4'
export const ALBERS = '+proj=aea +lat_1=29.5 +lat_2=45.5 +lat_0=23 +lon_0=-96 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs'
export const project = (point) => proj4('EPSG:4326', ALBERS, point)
export function projectedGeometry(g) {
  const walk = a => typeof a[0] === 'number' ? project(a) : a.map(walk)
  return { type: g.type, coordinates: walk(g.coordinates) }
}
export function ringsOf(g) { return g.type === 'Polygon' ? [g.coordinates] : g.coordinates }
export function geometryBounds(geometries) {
  const xs=[],ys=[]
  for (const g of geometries) for (const polygon of ringsOf(g)) for (const ring of polygon) for (const [x,y] of ring) { xs.push(x); ys.push(y) }
  return [Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]
}
export function snappedGrid(geometries) {
  const [x0,y0,x1,y1] = geometryBounds(geometries), ox=-2493045, oy=3310005
  const bbox=[ox+30*Math.floor((x0-ox)/30),oy+30*Math.floor((y0-oy)/30),ox+30*Math.ceil((x1-ox)/30),oy+30*Math.ceil((y1-oy)/30)]
  return {bbox,width:(bbox[2]-bbox[0])/30,height:(bbox[3]-bbox[1])/30}
}
function ringContains(ring,x,y) {
  let inside=false
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const [xi,yi]=ring[i], [xj,yj]=ring[j]
    if ((yi>y)!==(yj>y) && x < (xj-xi)*(y-yi)/(yj-yi)+xi) inside=!inside
  }
  return inside
}
export function contains(g,x,y) { return ringsOf(g).some(p=>ringContains(p[0],x,y)&&!p.slice(1).some(r=>ringContains(r,x,y))) }
function area(r) {
  if(r.length<3)return 0
  // Translate near the origin to avoid cancellation at CONUS coordinates.
  const [ox,oy]=r[0];let sum=0
  for(let i=0,j=r.length-1;i<r.length;j=i++)sum+=(r[j][0]-ox)*(r[i][1]-oy)-(r[i][0]-ox)*(r[j][1]-oy)
  return Math.abs(sum)/2
}
function clippedArea(r,b) {
  let p=r
  for(const [axis,edge,sign] of [[0,b[0],1],[0,b[2],-1],[1,b[1],1],[1,b[3],-1]]) {
    const q=[]
    for(let i=0,j=p.length-1;i<p.length;j=i++) {
      const a=p[j],c=p[i], ai=sign*(a[axis]-edge)>=0,ci=sign*(c[axis]-edge)>=0
      if(ai!==ci) {const t=(edge-a[axis])/(c[axis]-a[axis]);q.push([a[0]+t*(c[0]-a[0]),a[1]+t*(c[1]-a[1])])}
      if(ci)q.push(c)
    }
    p=q;if(!p.length)return 0
  }
  return area(p)
}
export function overlap(g,b) { return ringsOf(g).reduce((s,p)=>s+clippedArea(p[0],b)-p.slice(1).reduce((a,r)=>a+clippedArea(r,b),0),0) }
export function geometryArea(g) { return ringsOf(g).reduce((s,p)=>s+area(p[0])-p.slice(1).reduce((a,r)=>a+area(r),0),0) }
export const LAND_CLASSES = new Set([12,21,22,23,24,31,41,42,43,52,71,81,82,90,95])
export function canopyStatus(waterArea,tractArea,maskArea,validLandArea) {
  if(maskArea < tractArea * (1-1e-7))return 'missing'
  if(waterArea/tractArea>=0.99)return 'mostly-water'
  return validLandArea>0 ? 'ok' : 'missing'
}
export function zonalCanopy(g,grid,tcc,lc) {
  const [x0,y0,,y1]=grid.bbox, {width:w,height:h}=grid, b=geometryBounds([g])
  const minCol=Math.max(0,Math.floor((b[0]-x0)/30)),maxCol=Math.min(w-1,Math.floor((b[2]-x0)/30))
  const minRow=Math.max(0,Math.floor((y1-b[3])/30)),maxRow=Math.min(h-1,Math.floor((y1-b[1])/30))
  let waterArea=0,maskArea=0,validLandArea=0,weightedSum=0,count=0,sum=0
  const tractArea=geometryArea(g)
  for(let row=minRow;row<=maxRow;row++)for(let col=minCol;col<=maxCol;col++) {
    const i=row*w+col,x=x0+col*30,y=y1-row*30, v=tcc[i],cls=lc[i]
    const a=Math.max(0,overlap(g,[x,y-30,x+30,y]));if(a<=1e-8)continue
    if(cls===11||LAND_CLASSES.has(cls))maskArea+=a
    if(cls===11)waterArea+=a
    if(LAND_CLASSES.has(cls)&&v<=100){validLandArea+=a;weightedSum+=a*v;if(contains(g,x+15,y-15)){count++;sum+=v}}
  }
  const status=canopyStatus(waterArea,tractArea,maskArea,validLandArea)
  return { canopyPct:status==='ok'?(count<10?weightedSum/validLandArea:sum/count):null,canopyStatus:status,
    landPixels:count,areaWeighted:count<10,waterShare:waterArea/tractArea,tractArea,maskArea,validLandArea,weightedSum,
    unobservedArea:Math.max(0,tractArea-maskArea),invalidLandArea:Math.max(0,maskArea-waterArea-validLandArea) }
}

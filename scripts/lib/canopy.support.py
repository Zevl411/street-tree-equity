"""Build-only planar EPSG:5070 support proof. Buffer/areas never enter public data."""
import json,sys,math
from shapely.geometry import shape
features=json.load(open(sys.argv[1]))['features']
results=json.load(open(sys.argv[2]))
out=[]
for f,r in zip(features,results):
    assert f['properties']['geoid']==r['geoid']
    g=shape(f['geometry'])
    area=g.area
    buffered=g.buffer(15*math.sqrt(2),quad_segs=64).area
    land=r['landAcres']
    support=None if land is None else land*4046.8564224
    total=r['totalPixels']*900 if r['landPixels']>=10 else r['totalOverlap']
    bound=buffered if r['landPixels']>=10 else area
    if support is not None:
        assert support<=bound+1e-7, (r['geoid'],'polygon bound',support,bound)
        assert support<=total+1e-7, (r['geoid'],'total pixel support',support,total)
    if r['canopyStatus']=='ok':assert land is not None and land>0,(r['geoid'],'positive ok support',land)
    out.append(dict(geoid=r['geoid'],polygonM2=area,bufferedPolygonM2=buffered,supportM2=support,totalPixelSupportM2=total,supportPolygonRatio=support/area if support is not None else None))
json.dump(out,open(sys.argv[3],'w'),indent=2)
print('Planar support bounds PASS:',len(out),'tracts; radius',15*math.sqrt(2),'m')

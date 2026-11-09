"""Independent rasterstats center-zonal implementation (TL-approved replacement for apt GDAL CLI)."""
from pathlib import Path
import json
import numpy as np
import rasterio
from rasterstats import zonal_stats
checks=[('portland','public/data','41051003100'),('central-miami-fl','public/data/central-miami-fl','12086002404'),('orlando-fl','public/data/orlando-fl','12095010201')]
reports=json.loads(Path('data-raw/canopy148/report.json').read_text())['packs']
results=[]
for city,pack,geoid in checks:
    cache=Path(next(p['cache'] for p in reports if p['id']==city))
    projected=json.loads((cache/'projected.geojson').read_text())
    feature=next(f for f in projected['features'] if f['properties']['geoid']==geoid)
    fc=json.loads((Path(pack)/'tracts-equity.geojson').read_text())
    props=next(f['properties'] for f in fc['features'] if f['properties']['geoid']==geoid)
    with rasterio.open(cache/'tcc-2025-v2025-6.tif') as src:
        lcpath=cache/'lc-2025-c1-2.tif.aligned.tif'
        if not lcpath.exists():lcpath=cache/'lc-2025-c1-2.tif'
        with rasterio.open(lcpath) as mask:
            assert mask.crs==src.crs and mask.transform==src.transform and mask.shape==src.shape
            a=src.read(1);b=mask.read(1)
            raster=np.where((a<=100)&np.isin(b,[12,21,22,23,24,31,41,42,43,52,71,81,82,90,95]),a,255).astype('uint8')
            stats=zonal_stats([feature],raster,affine=src.transform,nodata=255,stats=['mean','count'],all_touched=False)[0]
    delta=abs(stats['mean']-props['canopyPct'])
    assert delta<=1, f'Cross-check outside 1 pp: {geoid} {delta}'
    results.append(dict(city=city,geoid=geoid,canopyPct=props['canopyPct'],rasterstatsMean=stats['mean'],landCenters=stats['count'],absoluteDifferencePp=delta))
Path('data-raw/canopy148/crosscheck.json').write_text(json.dumps(results,indent=2))
print(json.dumps(results,indent=2))

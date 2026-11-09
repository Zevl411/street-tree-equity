"""Build-only TIFF decoding, alignment and independent rasterstats check. Never imported by the app."""
import sys, json
import numpy as np
import rasterio
from rasterio.warp import reproject, Resampling

tcc_path, lc_path, grid_path = sys.argv[1:4]
grid = json.load(open(grid_path))
with rasterio.open(tcc_path) as tcc, rasterio.open(lc_path) as lc:
    expected = rasterio.Affine(30, 0, grid['bbox'][0], 0, -30, grid['bbox'][3])
    assert tcc.crs.to_epsg() == 5070 and tcc.transform == expected, f'TCC wrong grid: {tcc.crs}, {tcc.transform}'
    assert tcc.width == grid['width'] and tcc.height == grid['height'] and tcc.count == 1
    aligned = lc.crs == tcc.crs and lc.transform == tcc.transform and lc.width == tcc.width and lc.height == tcc.height
    canopy = tcc.read(1)
    if aligned:
        mask = lc.read(1)
    else:
        # TL ruling: one explicit nearest-neighbour alignment of the SAME 2025 LC source is allowed.
        mask = np.full(canopy.shape, 250, dtype=np.uint8)
        reproject(rasterio.band(lc, 1), mask, src_transform=lc.transform, src_crs=lc.crs,
                  dst_transform=tcc.transform, dst_crs=tcc.crs, src_nodata=250, dst_nodata=250,
                  resampling=Resampling.nearest)
        profile = tcc.profile.copy(); profile.update(nodata=250, dtype='uint8', count=1)
        with rasterio.open(lc_path + '.aligned.tif', 'w', **profile) as out: out.write(mask, 1)
        with rasterio.open(lc_path + '.aligned.tif') as out:
            assert out.crs == tcc.crs and out.transform == tcc.transform and out.shape == tcc.shape, 'Still misaligned: STOP'
    canopy.astype('uint8').tofile(tcc_path + '.bin')
    mask.astype('uint8').tofile(lc_path + '.bin')
    qa = dict(alignedExactly=True, nativeAlignedExactly=aligned, nearestNeighbourAlignment=not aligned, crs='EPSG:5070',
              originalMaskTransform=list(lc.transform)[:6], originalMaskCrs=str(lc.crs),
              transform=list(tcc.transform)[:6], width=tcc.width, height=tcc.height,
              tccCodes=np.unique(canopy).tolist(), landCoverCodes=np.unique(mask).tolist())
    print(json.dumps(qa))
    if len(sys.argv) > 4:
        from rasterstats import zonal_stats
        fc = json.load(open(sys.argv[4]))
        masked = np.where((canopy <= 100) & np.isin(mask, [12,21,22,23,24,31,41,42,43,52,71,81,82,90,95]), canopy, 255).astype('uint8')
        stats = zonal_stats(fc['features'], masked, affine=tcc.transform, nodata=255, stats=['mean','count'], all_touched=False)
        print(json.dumps([dict(geoid=f['properties']['geoid'], **s) for f,s in zip(fc['features'], stats)]))

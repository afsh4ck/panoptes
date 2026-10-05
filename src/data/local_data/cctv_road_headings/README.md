# CCTV road bearings

This database is distributed under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/), separately from the MIT code.
Derived from road geometry © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), read from [OpenFreeMap](https://openfreemap.org/) vector tiles.

Road-aligned bearings for the highway cameras whose feeds publish no facing:
DGT (Spain), the Servei Català de Trànsit and Open Data Euskadi. The catalog
replaces a camera's synthetic bearing with this one while the camera stays at
the position it was computed for (`server/providers/cctv/roadHeadings.js`); a
surveyed, curated or calibrated pose always wins.

Each bearing is the direction of the nearest stretch of the camera's own road
(same road number within 150 m; otherwise the nearest major road within 60 m)
in z14 tiles. Which way along the road comes from the feed: DGT marks each
camera `positive` (towards increasing kilometre points) or `negative`, and the
nearest camera on the same road with a different kilometre point shows which
way the kilometres grow there. With both the confidence is `medium`; without
them, or when the result points away from the far city DGT names as the
destination ("→ Madrid"), it stays `low` and the app draws it as an estimate.
The rules are in `src/data/cctvRoadHeadings.js`.

Runtime output: `cctv_road_headings.json`

```
{
  "schemaVersion": 1,
  "generatedAt": "<ISO>",
  "geometry": "OpenStreetMap via OpenFreeMap vector tiles, z14",
  "cameras": {
    "<camera id>": {
      "headingDeg": <0–360, clockwise from north>,
      "confidence": "medium" | "low",
      "lat": <camera latitude the bearing was computed for>,
      "lon": <camera longitude>,
      "road": "<road number>",
      "matchedRef": <true when the camera's own road number was found>
    }
  }
}
```

Build of 2026-10-05: 2,241 road cameras, 1,737 `medium`, 496 `low`, 8 with no
road nearby (left out); the camera's own road number was found for 2,120.
Check against an independent signal: of the 437 `medium` DGT cameras whose
named destination is a large city more than 30 km away, 428 (97.9 %) face
within 90° of it and 364 within 45°.

Rebuild (reads the packs live and about 2,300 tiles; `--tile-cache` keeps the
tiles for later runs):

```sh
node scripts/precompute-cctv-road-headings.mjs --tile-cache /tmp/ofm-tiles
```

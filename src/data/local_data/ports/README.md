# Ports (World Port Index)

Bundled for the PALANTIR "Ports" infrastructure layer.

- Source: [NGA Maritime Safety Information — World Port Index, Pub. 150](https://msi.nga.mil/Publications/WPI)
- License: public domain (U.S. Government work); no attribution required, credited anyway
- Feature count: 3,805
- Runtime file: `ports.geojsonl`
- Regenerate: `node scripts/etl/ports.mjs`

`class` is the WPI harbor size (`port_large`, `port_medium`, `port_small`,
`port_very_small`, `port_unknown`); `tags` keep harbor type/use, UN/LOCODE,
region, water body, maximum vessel length and channel depth.
Retrieved 2026-09-30.

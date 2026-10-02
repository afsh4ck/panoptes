# Power plants (≥ 100 MW)

Bundled for the PALANTIR "Power Plants" infrastructure layer.

- Source: [WRI Global Power Plant Database v1.3](https://datasets.wri.org/dataset/globalpowerplantdatabase)
- License: CC BY 4.0 — attribution "Global Power Plant Database, World Resources Institute"
- Filter: primary capacity ≥ 100 MW (all fuels)
- Feature count: 7,832
- Runtime file: `power_plants.geojsonl`
- Regenerate: `node scripts/etl/power-plants.mjs` (`--min-mw 50` to widen)

Properties: `name`, `class` (primary fuel), `subtitle` (fuel · MW),
`country` (ISO2), `tags` (capacity_mw, primary_fuel, owner, year, gppd_idnr).
Retrieved 2026-09-30.

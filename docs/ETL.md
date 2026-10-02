# Strategic dataset ETL

PANOPTES bundles several global reference datasets so its strategic layers
work offline and never depend on a rate-limited public API at runtime. The
scripts in `scripts/etl/` download each upstream, normalize it and write the
files under `src/data/local_data/<dataset>/`.

The scripts are Node-only (Node 24+) and use no npm dependencies. Downloads
are cached in `.gev-cache/etl/` (git-ignored). Pass `--refresh` to bypass the
cache.

## Running

```bash
node scripts/etl/run-all.mjs                 # every dataset, continues on failure
node scripts/etl/run-all.mjs ports airports  # a subset
node scripts/etl/run-all.mjs --refresh       # ignore cached downloads
node scripts/etl/military-bases.mjs --dry-run --limit 50
```

Every script accepts `--dry-run` (build without writing) and `--limit N`.
`military-bases.mjs` also accepts `--skip-land`, and `power-plants.mjs`
accepts `--min-mw N`.

## Output contract

Point datasets are GeoJSONL: one GeoJSON `Feature` per line with a Point
geometry rounded to 5 decimals. Every feature carries the same properties, so
one static-layer factory can render all of them.

```json
{
  "id": "osm:way:123",
  "type": "Feature",
  "geometry": { "type": "Point", "coordinates": [-76.3, 36.94] },
  "properties": {
    "name": "Naval Station Norfolk",
    "class": "naval_base",
    "subtitle": "Naval base · United States Navy",
    "detail": "United States · OSM+Wikidata",
    "country": "US",
    "source": "OSM+Wikidata",
    "tags": { "wikidata": "Q1260346" }
  }
}
```

`name` is never empty. `class` is a lowercase slug the layer styles by.
`tags` holds a small set of raw fields with no contact information. Each
dataset folder also has a `README.md` and a `manifest.json` with the source
URL, license, query, feature count, class tally and the SHA-256 of the
output.

Two datasets are lookup tables, not map points:
`sanctioned_vessels/sanctioned_vessels.json` and
`aircraft_types/aircraft_types.json`.

## Datasets

| Dataset              | Script                   | Source                                                                 | License                    | Refresh            |
| -------------------- | ------------------------ | ---------------------------------------------------------------------- | -------------------------- | ------------------ |
| `military_bases`     | `military-bases.mjs`     | OpenStreetMap via Overpass, merged with Wikidata _military base_ items | ODbL 1.0 + CC0             | Quarterly          |
| `nuclear_sites`      | `nuclear-sites.mjs`      | Wikidata nuclear classes, OSM nuclear plants, WRI nuclear rows         | CC0 + ODbL 1.0 + CC BY 4.0 | Quarterly          |
| `power_plants`       | `power-plants.mjs`       | WRI Global Power Plant Database v1.3, plants of 100 MW or more         | CC BY 4.0                  | When WRI publishes |
| `ports`              | `ports.mjs`              | NGA World Port Index (Pub. 150)                                        | Public domain              | Yearly             |
| `airports`           | `airports.mjs`           | OurAirports, large and medium airports plus military airfields         | Public domain              | Quarterly          |
| `volcanoes`          | `volcanoes.mjs`          | Smithsonian GVP WFS, falling back to Wikidata _volcano_ items          | GVP terms, or CC0          | Yearly             |
| `chokepoints`        | `chokepoints.mjs`        | Hand-authored table in the script                                      | MIT                        | On edit            |
| `sanctioned_vessels` | `sanctioned-vessels.mjs` | OpenSanctions consolidated sanctions, Vessel entities                  | **CC BY-NC 4.0**           | Weekly to monthly  |
| `aircraft_types`     | `aircraft-types.mjs`     | ICAO Doc 8643 via OpenSky, plus a hand-checked dimensions table        | Reference data             | Yearly             |

### Notes and caveats

- **Mapped is not operational.** Military bases and nuclear sites come from
  community and open sources. Presence says nothing about capability,
  occupancy or status, and coverage is uneven by country. Use `tags.status`
  where present.
- **Merging.** Wikidata items within 2.5 km of an OSM base with a similar or
  missing name fold into the OSM feature. Its `source` then reads
  `OSM+Wikidata`. Nuclear sites fold OSM within 3 km and WRI within 5 km.
- **Overpass etiquette.** The military query is a single large global request
  to `overpass-api.de`, with `overpass.kumi.systems` as fallback. Run it rarely
  and keep the cache. The app itself does not use public Overpass.
- **Volcanoes.** The Smithsonian WFS was unreachable when this snapshot was
  built, so the bundled file uses the Wikidata fallback. Re-run with
  `--refresh` when `webservices.volcano.si.edu` answers to get GVP numbers,
  last-eruption years and tectonic settings.
- **Aircraft dimensions.** The FAA Aircraft Characteristics Database would
  cover about 1,500 types, but its site offers no file a script can fetch.
  Dimensions therefore cover a hand-checked table of common types. Extend
  `DIMENSIONS` in `aircraft-types.mjs`, or add an FAA parser when a download
  URL exists. `lib.mjs` already has a ZIP reader and XML helpers for `.xlsx`.
- **NonCommercial data.** `sanctioned_vessels` is CC BY-NC 4.0. A commercial
  deployment must license it from OpenSanctions or delete the folder. GVP
  data, if used, also needs a terms check before commercial redistribution.

## Shared library

`scripts/etl/lib.mjs` provides fetch with retry and backoff, Overpass and
SPARQL helpers, buffered and streaming RFC 4180 CSV parsing, a small ZIP
reader, regex XML helpers, an offline country lookup over the bundled Natural
Earth countries, proximity merging on a grid index, and the GeoJSONL writer
that validates every feature before writing it.

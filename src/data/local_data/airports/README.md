# Airports

Bundled for the PALANTIR "Airports" infrastructure layer.

- Source: [OurAirports](https://ourairports.com/data/) `airports.csv`
- License: public domain (released by OurAirports contributors)
- Filter: large and medium airports worldwide, plus any airfield whose name reads as military (air base, AFB, naval air station, …) regardless of size
- Feature count: 5,970
- Runtime file: `airports.geojsonl`
- Regenerate: `node scripts/etl/airports.mjs`

`class` is `large_airport`, `medium_airport` or `military_airfield`.
Retrieved 2026-09-30.

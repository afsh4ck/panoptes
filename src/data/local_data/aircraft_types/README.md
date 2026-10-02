# Aircraft types

Reference data for the PALANTIR aircraft inspector, keyed by ICAO type
designator (the `typeCode` adsbdb returns, e.g. `A320`, `B738`, `C30J`).

- Identity (manufacturer, model, variants, airframe, engine count/type, wake
  category): ICAO Doc 8643 as republished by the [OpenSky Network](https://opensky-network.org/datasets/metadata/)
  — reference data; ICAO retains rights in Doc 8643, used here for lookup
- Dimensions and performance (wingspan, length, height, MTOW, cruise, range,
  ceiling, capacity) for 61 common civil and military types: hand-checked
  manufacturer published figures for the baseline variant (approximate)
- Designators: 2,642
- The FAA Aircraft Characteristics Database would add dimensions for ~1,500
  types but was not downloadable by script at build time; extend
  `DIMENSIONS` in the script or add an FAA parser when a file URL is available.
- Regenerate: `node scripts/etl/aircraft-types.mjs`

Shape: `{ types: { "<ICAO>": { manufacturer, model, variants?, airframe,
engines, engineType, wakeCategory, wingspanM?, lengthM?, heightM?, mtowKg?,
cruiseKt?, rangeKm?, ceilingM?, capacity? } } }`.
Retrieved 2026-10-01.

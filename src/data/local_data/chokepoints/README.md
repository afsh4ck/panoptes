# Maritime chokepoints

Hand-authored reference points for the PALANTIR "Chokepoints" layer: the
straits, canals and gaps that concentrate global shipping and naval movement.

- Source: authored in `scripts/etl/chokepoints.mjs` (coordinates accurate to ~10 km)
- License: MIT, as part of this repository
- Feature count: 29
- Runtime file: `chokepoints.geojsonl`
- Regenerate: `node scripts/etl/chokepoints.mjs`

Each feature carries `subtitle` (what the passage connects) and `detail`
(why it matters). Edit the table in the script and re-run to change entries.

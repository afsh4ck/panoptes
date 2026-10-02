# Volcanoes

Bundled for the PALANTIR "Volcanoes" layer.

- Source: Wikidata instances of *volcano* (fallback because the GVP WFS was unreachable: fetch failed)
- License: CC0 1.0
- Feature count: 2,522
- Runtime file: `volcanoes.geojsonl`
- Regenerate: `node scripts/etl/volcanoes.mjs` (`--refresh` re-downloads)

`class` is `volcano_<type>` (volcano, volcano_caldera, volcano_cone, volcano_dome, volcano_field, volcano_mud, volcano_shield, volcano_stratovolcano, volcano_submarine).
Retrieved 2026-10-01.

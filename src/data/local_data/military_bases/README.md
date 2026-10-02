# Military installations (global)

Bundled for the PALANTIR "Military Bases" strategic layer. These are MAPPED
features from community and open sources: presence on this list says nothing
about a site's capability, occupancy or operational status, and coverage is
uneven by country.

- Sources: OpenStreetMap (`military=naval_base|airfield|base|barracks`) via Overpass — ODbL 1.0, © OpenStreetMap
  contributors; Wikidata items that are instances of *military base* or a
  subclass — CC0 1.0
- Merge: Wikidata items within 2.5 km of an OSM feature with a similar (or
  missing) name are folded into it (`source` becomes `OSM+Wikidata`)
- Feature count: 20,619
- Runtime file: `military_bases.geojsonl`
- Regenerate: `node scripts/etl/military-bases.mjs` (`--refresh` re-downloads; `--skip-land` drops the large named-land query)

`class` values: air_base, army_base, barracks, base, missile_base, naval_base, other, radar_station, training_area.
`tags` keep the OSM id, Wikidata id, operator/branch, instance-of labels and a
`status: former` marker when the source says the site is disused.
Retrieved 2026-10-01.

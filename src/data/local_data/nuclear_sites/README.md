# Nuclear sites

Bundled for the PALANTIR "Nuclear Sites" strategic layer: nuclear power
plants (operating, under construction and decommissioned), research reactors,
uranium enrichment plants, missile launch facilities and nuclear test sites.
Mapped ≠ operational: check `tags.status` where present.

- Sources: Wikidata (CC0 1.0) instances of nuclear power plant, research
  reactor, uranium enrichment plant, missile launch facility, nuclear test
  site; OpenStreetMap (ODbL 1.0, © OpenStreetMap contributors)
  `plant:source=nuclear`, `generator:source=nuclear`,
  `military=nuclear_explosion_site`; WRI Global Power Plant Database v1.3
  nuclear rows (CC BY 4.0)
- Feature count: 1,153
- Runtime file: `nuclear_sites.geojsonl`
- Regenerate: `node scripts/etl/nuclear-sites.mjs` (`--refresh` re-downloads)

`class` values: enrichment, missile_silo, power_plant, research_reactor, test_site.
Retrieved 2026-10-01.

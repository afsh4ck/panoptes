import { createStrategicSitesLayer } from '../layers/strategicSites/index.js';

// Resolved by Vite in builds (static literals so assets are emitted) and relative to this module elsewhere.

/**
 * Bundled strategic-site datasets produced by `scripts/etl` (see docs/ETL.md).
 * Each spec maps to one static GeoJSONL layer: points with ETL-authored
 * `name`/`class`/`subtitle`/`detail`/`country`/`source` properties. Mapped
 * features are context, never an assertion about capability or status.
 */
export const STRATEGIC_LAYER_SPECS = Object.freeze([
  Object.freeze({
    id: 'strategic-military-bases',
    url: new URL(
      './local_data/military_bases/military_bases.geojsonl',
      import.meta.url,
    ).href,
    name: 'Military Bases',
    color: '#f5a524',
    icon: '🎖',
    source: 'OSM + Wikidata',
    osmDerived: true,
    labelMax: 700,
    labelGridPx: 140,
  }),
  Object.freeze({
    id: 'strategic-nuclear-sites',
    url: new URL(
      './local_data/nuclear_sites/nuclear_sites.geojsonl',
      import.meta.url,
    ).href,
    name: 'Nuclear Sites',
    color: '#ff4d4f',
    icon: '☢',
    source: 'Wikidata + OSM + WRI',
    osmDerived: true,
    labelMax: 600,
    labelGridPx: 132,
  }),
  Object.freeze({
    id: 'strategic-power-plants',
    url: new URL(
      './local_data/power_plants/power_plants.geojsonl',
      import.meta.url,
    ).href,
    name: 'Power Plants',
    color: '#ffd166',
    icon: '⚡',
    source: 'WRI GPPD',
    osmDerived: false,
    labelMax: 700,
    labelGridPx: 138,
  }),
  Object.freeze({
    id: 'strategic-ports',
    url: new URL('./local_data/ports/ports.geojsonl', import.meta.url).href,
    name: 'Ports',
    color: '#2dd4bf',
    icon: '⚓',
    source: 'NGA World Port Index',
    osmDerived: false,
    labelMax: 700,
    labelGridPx: 132,
  }),
  Object.freeze({
    id: 'strategic-airports',
    url: new URL('./local_data/airports/airports.geojsonl', import.meta.url)
      .href,
    name: 'Airports & Airfields',
    color: '#8ab4f8',
    icon: '🛫',
    source: 'OurAirports',
    osmDerived: false,
    labelMax: 700,
    labelGridPx: 132,
  }),
  Object.freeze({
    id: 'strategic-volcanoes',
    url: new URL('./local_data/volcanoes/volcanoes.geojsonl', import.meta.url)
      .href,
    name: 'Volcanoes',
    color: '#ff7a45',
    icon: '🌋',
    source: 'Smithsonian GVP',
    osmDerived: false,
    labelMax: 600,
    labelGridPx: 132,
  }),
  Object.freeze({
    id: 'strategic-chokepoints',
    url: new URL(
      './local_data/chokepoints/chokepoints.geojsonl',
      import.meta.url,
    ).href,
    name: 'Maritime Chokepoints',
    color: '#c084fc',
    icon: '⛵',
    source: 'Hand-authored',
    osmDerived: false,
    labelMax: 80,
    labelGridPx: 120,
  }),
]);

/** Layer ids of the strategic-site family, in panel order. */
export const STRATEGIC_LAYER_IDS = Object.freeze(
  STRATEGIC_LAYER_SPECS.map((spec) => spec.id),
);

/**
 * Create fresh strategic-site layers without starting or loading them.
 * @param {object} services Caller-owned context, overlay and render operations.
 * @returns {object[]} One layer per spec, in `STRATEGIC_LAYER_SPECS` order.
 */
export function createStrategicLayers(services) {
  return STRATEGIC_LAYER_SPECS.map((spec) =>
    createStrategicSitesLayer({ spec, services }),
  );
}

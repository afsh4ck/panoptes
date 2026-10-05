// Namespace import: Vite serves mgrs as ESM named exports, while Node's
// CommonJS interop exposes it only as a default.
import * as mgrsModule from 'mgrs';

const mgrsForward = mgrsModule.forward || mgrsModule.default?.forward;
import { cleanText, createIntelModel, intelRow } from './intelModel.js';
import { siteWikidataRows } from './siteWikidata.js';

/**
 * @module siteIntel
 * @description Dossier for a mapped site: strategic datasets (military bases,
 * nuclear sites, plants, ports, airports, volcanoes, chokepoints) and the
 * inherited infrastructure layers (datacenters, dams, OSM installations).
 * Pure: everything comes from the selected context record.
 */

const CLASS_LABELS = Object.freeze({
  naval_base: 'Naval base',
  air_base: 'Air base',
  army_base: 'Army base',
  missile_base: 'Missile base',
  radar_station: 'Radar station',
  barracks: 'Barracks',
  training_area: 'Training area',
  base: 'Military base',
  power_plant: 'Nuclear power plant',
  research_reactor: 'Research reactor',
  enrichment: 'Enrichment facility',
  missile_silo: 'Missile launch facility',
  test_site: 'Nuclear test site',
  large_airport: 'Large airport',
  medium_airport: 'Medium airport',
  military_airfield: 'Military airfield',
  port_large: 'Large port',
  port_medium: 'Medium port',
  port_small: 'Small port',
  port_very_small: 'Very small port',
  chokepoint: 'Maritime chokepoint',
});

const LAYER_ACCENTS = Object.freeze({
  'strategic-military-bases': '#f5a524',
  'strategic-nuclear-sites': '#ff4d4f',
  'strategic-power-plants': '#ffd166',
  'strategic-ports': '#2dd4bf',
  'strategic-airports': '#8ab4f8',
  'strategic-volcanoes': '#ff7a45',
  'strategic-chokepoints': '#c084fc',
});

/** Tag keys already shown in a dedicated row, or not useful to an analyst. */
const SKIPPED_TAGS = new Set([
  'name',
  'name_en',
  'wikidata',
  'wikidata_id',
  'osm_id',
  'operator',
  'branch',
  'subtitle',
  'detail',
]);

function humanize(value) {
  const text = cleanText(value).replaceAll('_', ' ');
  return text ? text[0].toUpperCase() + text.slice(1) : '';
}

function classLabel(klass) {
  const key = cleanText(klass);
  if (!key) return '';
  if (CLASS_LABELS[key]) return CLASS_LABELS[key];
  if (key.startsWith('volcano_'))
    return `${humanize(key.slice('volcano_'.length))} volcano`;
  return humanize(key);
}

function osmUrl(osmId) {
  const match = /^(node|way|relation)\/(\d+)$/.exec(cleanText(osmId));
  return match ? `https://www.openstreetmap.org/${match[1]}/${match[2]}` : '';
}

function mgrsFor(lat, lon) {
  try {
    return mgrsForward ? mgrsForward([lon, lat], 4) : '';
  } catch {
    return '';
  }
}

/**
 * Build the site dossier.
 * @param {object} input
 * @param {object} input.subject Panel subject (`{id, layerId, label}`).
 * @param {object|null} input.live Selected context record.
 * @param {object|null} [input.payload] Wikidata facts (siteWikidata.js), when the site has an id.
 * @returns {object} IntelModel.
 */
export function buildSiteIntelModel({
  subject = {},
  live = null,
  payload = null,
} = {}) {
  const record = live || subject.record || {};
  const props = record.properties || {};
  const tags = props.tags && typeof props.tags === 'object' ? props.tags : {};
  const layerId = cleanText(record.layerId || subject.layerId);
  const lat = Number(record.latitude);
  const lon = Number(record.longitude);
  const hasPosition = Number.isFinite(lat) && Number.isFinite(lon);
  const name =
    cleanText(props.name) ||
    cleanText(tags.name) ||
    cleanText(record.label) ||
    cleanText(subject.label) ||
    'Mapped site';
  const klass = classLabel(props.class || tags.military || props.type);
  const wikidata = cleanText(tags.wikidata || tags.wikidata_id);
  const osm = osmUrl(tags.osm_id || props.osm_id);
  const operator = cleanText(tags.operator || props.operator);

  const identity = [
    intelRow('Name', name),
    intelRow('English name', tags.name_en),
    intelRow('Type', klass),
    intelRow('Operator', operator),
    intelRow('Branch', humanize(tags.branch)),
    intelRow('Country', props.country),
    intelRow('Layer', record.layerName || layerId),
  ];

  const details = [];
  for (const [key, value] of Object.entries(tags)) {
    if (SKIPPED_TAGS.has(key)) continue;
    if (value === null || value === undefined || typeof value === 'object')
      continue;
    details.push(intelRow(humanize(key), value));
  }

  const location = hasPosition
    ? [
        intelRow('Latitude', lat.toFixed(5), { mono: true }),
        intelRow('Longitude', lon.toFixed(5), { mono: true }),
        intelRow('MGRS', mgrsFor(lat, lon), { mono: true }),
      ]
    : [];

  const provenance = [
    intelRow('Source', props.source || record.source),
    intelRow('Wikidata', wikidata, {
      mono: true,
      href: wikidata ? `https://www.wikidata.org/wiki/${wikidata}` : '',
    }),
    intelRow('OpenStreetMap', cleanText(tags.osm_id || props.osm_id), {
      mono: true,
      href: osm,
    }),
  ];

  const links = [];
  if (hasPosition) {
    links.push({
      label: 'Satellite view',
      href: `https://www.google.com/maps/@${lat},${lon},2500m/data=!3m1!1e3`,
    });
    links.push({
      label: 'OpenStreetMap',
      href: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=14/${lat}/${lon}`,
    });
  }
  if (wikidata)
    links.push({
      label: 'Wikidata',
      href: `https://www.wikidata.org/wiki/${wikidata}`,
    });
  if (payload?.wikipedia?.href)
    links.push({ label: 'Wikipedia', href: payload.wikipedia.href });
  links.push({
    label: 'Wikipedia search',
    href: `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(cleanText(tags.name_en) || name)}`,
  });
  links.push({
    label: 'News search',
    href: `https://news.google.com/search?q=${encodeURIComponent(`"${cleanText(tags.name_en) || name}"`)}`,
  });

  const badges = [];
  if (klass) badges.push({ label: klass.toUpperCase(), tone: 'neutral' });
  if (props.country)
    badges.push({
      label: cleanText(props.country).toUpperCase(),
      tone: 'neutral',
    });
  if (/nuclear|reactor|enrichment|missile/i.test(String(props.class || '')))
    badges.push({ label: 'STRATEGIC', tone: 'warn' });

  return createIntelModel({
    kind: 'site',
    id: cleanText(record.id || subject.id),
    title: name,
    subtitle: [
      cleanText(props.subtitle) || klass || cleanText(payload?.description),
      cleanText(props.country),
    ]
      .filter(Boolean)
      .join(' · '),
    accent: LAYER_ACCENTS[layerId] || '#f5a524',
    badges,
    photo: payload?.image || null,
    sections: [
      { heading: 'IDENTITY', rows: identity },
      { heading: 'DETAILS', rows: details },
      { heading: 'WIKIDATA', rows: siteWikidataRows(payload) },
      { heading: 'LOCATION', rows: location },
      { heading: 'PROVENANCE', rows: provenance },
    ],
    links,
    raw: record,
    fetchedAt: payload?.fetchedAt || Date.now(),
    notes: [
      'Mapped context from public datasets. It does not confirm capability, occupancy or operational status.',
      ...(payload
        ? ['Wikidata facts are community-edited; check the linked sources.']
        : []),
    ],
  });
}

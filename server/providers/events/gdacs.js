import { validCoordinate } from './cachedRoute.js';

/**
 * GDACS (Global Disaster Alert and Coordination System) RSS parser. The feed
 * is a flat RSS 2.0 document with `gdacs:` extension elements; a minimal
 * tag reader keeps this dependency-free.
 */
export const GDACS_RSS_URL = 'https://www.gdacs.org/xml/rss.xml';
export const GDACS_EVENT_TYPES = Object.freeze({
  EQ: 'Earthquake',
  TC: 'Tropical cyclone',
  FL: 'Flood',
  VO: 'Volcano',
  DR: 'Drought',
  WF: 'Wildfire',
  TS: 'Tsunami',
});
const LEVELS = new Set(['green', 'orange', 'red']);

function decodeEntities(text) {
  return String(text || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .trim();
}

function tagText(block, name) {
  const escaped = name.replace(/[:]/g, '\\:');
  const match = new RegExp(
    `<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`,
    'i',
  ).exec(block);
  return match ? decodeEntities(match[1]) : '';
}

function tagAttributes(block, name) {
  const escaped = name.replace(/[:]/g, '\\:');
  const match = new RegExp(`<${escaped}((?:\\s[^>]*)?)(?:\\/>|>)`, 'i').exec(
    block,
  );
  const out = {};
  if (!match) return out;
  for (const attribute of match[1].matchAll(/([\w:-]+)="([^"]*)"/g))
    out[attribute[1]] = decodeEntities(attribute[2]);
  return out;
}

function pointOf(item) {
  let latText = tagText(item, 'geo:lat');
  let lonText = tagText(item, 'geo:long');
  if (!latText || !lonText) {
    const georss = tagText(item, 'georss:point').split(/\s+/);
    if (georss.length === 2) [latText, lonText] = georss;
  }
  if (!latText || !lonText) return null;
  const lat = Number(latText);
  const lon = Number(lonText);
  return validCoordinate(lat, lon) ? { lat, lon } : null;
}

function timeOrNull(text) {
  const ms = Date.parse(String(text || ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Parse the GDACS RSS document into disaster rows (current events only). */
export function parseGdacsRss(xml, { includeArchived = false } = {}) {
  const rows = [];
  const seen = new Map();
  const items = String(xml || '').match(/<item>[\s\S]*?<\/item>/gi) || [];
  for (const item of items) {
    const eventType = tagText(item, 'gdacs:eventtype').toUpperCase();
    const eventId = tagText(item, 'gdacs:eventid');
    if (!eventType || !eventId) continue;
    const current = tagText(item, 'gdacs:iscurrent').toLowerCase() !== 'false';
    if (!current && !includeArchived) continue;
    const point = pointOf(item);
    if (!point) continue;
    const { lat, lon } = point;
    const level = tagText(item, 'gdacs:alertlevel').toLowerCase();
    const severityAttributes = tagAttributes(item, 'gdacs:severity');
    const populationAttributes = tagAttributes(item, 'gdacs:population');
    const bbox = tagText(item, 'gdacs:bbox')
      .split(/\s+/)
      .map(Number)
      .filter(Number.isFinite);
    const episode = Number(tagText(item, 'gdacs:episodeid')) || 0;
    const id = `gdacs:${eventType}${eventId}`;
    const previous = seen.get(id);
    if (previous && previous.episode >= episode) continue;
    const row = {
      id,
      lat,
      lon,
      source: 'GDACS',
      type: GDACS_EVENT_TYPES[eventType] ? eventType : 'other',
      title: tagText(item, 'title'),
      description: tagText(item, 'description').slice(0, 400),
      level: LEVELS.has(level) ? level : 'info',
      score: Number(tagText(item, 'gdacs:alertscore')) || 0,
      severity: {
        value: Number(severityAttributes.value) || null,
        unit: severityAttributes.unit || '',
        text: tagText(item, 'gdacs:severity'),
      },
      population: {
        value: Number(populationAttributes.value) || null,
        unit: populationAttributes.unit || '',
        text: tagText(item, 'gdacs:population'),
      },
      country: tagText(item, 'gdacs:country'),
      iso3: tagText(item, 'gdacs:iso3'),
      link: tagText(item, 'link'),
      from: timeOrNull(tagText(item, 'gdacs:fromdate')),
      to: timeOrNull(tagText(item, 'gdacs:todate')),
      updated:
        timeOrNull(tagText(item, 'gdacs:datemodified')) ||
        timeOrNull(tagText(item, 'pubDate')),
      bbox: bbox.length === 4 ? bbox : null,
      episode,
      current,
    };
    seen.set(id, row);
  }
  for (const row of seen.values()) rows.push(row);
  return rows;
}

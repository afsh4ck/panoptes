import { parseCoordinateQuery } from '../search/coordinateParser.js';

/**
 * Pure command-palette model: indexing, fuzzy scoring, grouping and the
 * recent-command ledger. No DOM, no timers; the view in commandPalette.js
 * renders whatever this module returns.
 */

/** Result cap across every group. */
export const COMMAND_RESULT_LIMIT = 40;
/** Recents remembered per browser; the newest first. */
export const COMMAND_RECENT_LIMIT = 12;
/** Where the recents ledger persists. */
export const COMMAND_RECENT_STORAGE_KEY = 'panoptes:palette-recent:v1';

/** Presentation order of the result groups. */
export const COMMAND_GROUP_ORDER = Object.freeze([
  'coordinate',
  'layer',
  'place',
  'site',
  'action',
]);

const GROUP_LABELS = Object.freeze({
  coordinate: 'Coordinates',
  layer: 'Layers',
  place: 'Places',
  site: 'Sites',
  action: 'Actions',
});

/** Location kinds that read as a mapped site rather than a settlement. */
const SITE_KINDS = new Set([
  'site',
  'base',
  'installation',
  'nuclear',
  'port',
  'airport',
  'plant',
  'volcano',
  'chokepoint',
  'strait',
  'facility',
]);

/** Camera range applied when the palette flies to a location of each kind. */
export const FLY_RANGE_M = Object.freeze({
  city: 25_000,
  poi: 1_500,
  place: 8_000,
  site: 6_000,
  base: 6_000,
  installation: 6_000,
  nuclear: 4_000,
  port: 8_000,
  airport: 6_000,
  plant: 4_000,
  volcano: 12_000,
  chokepoint: 120_000,
  strait: 120_000,
  facility: 4_000,
  coordinate: 5_000,
});

/** Lowercase, diacritic-free text for matching. */
export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Split a query into non-empty tokens. */
export function tokenize(value) {
  return normalizeText(value)
    .split(/[\s,;/]+/)
    .filter(Boolean);
}

function isSubsequence(needle, haystack) {
  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return index === needle.length;
}

/**
 * Score one query token against one text. 0 means no match.
 * Prefix beats word-start, which beats substring, which beats subsequence.
 * @param {string} token Normalized query token.
 * @param {string} text Normalized candidate text.
 * @returns {number}
 */
export function scoreToken(token, text) {
  if (!token || !text) return 0;
  if (text === token) return 100;
  if (text.startsWith(token)) return 90;
  const words = text.split(/[\s\-_.()/]+/).filter(Boolean);
  if (words.some((word) => word.startsWith(token))) return 80;
  if (words.some((word) => word === token)) return 78;
  if (text.includes(token)) return 60;
  if (token.length >= 3 && isSubsequence(token, text)) return 30;
  return 0;
}

/**
 * Score a whole query against a candidate. Every token must match somewhere
 * in the title or keywords; the title carries the weight.
 * @param {string[]} tokens
 * @param {{title: string, keywords: string[]}} candidate Normalized fields.
 * @returns {number} 0 when any token misses.
 */
export function scoreCandidate(tokens, candidate) {
  if (!tokens.length) return 1;
  let total = 0;
  for (const token of tokens) {
    const titleScore = scoreToken(token, candidate.title);
    let keywordScore = 0;
    for (const keyword of candidate.keywords) {
      keywordScore = Math.max(keywordScore, scoreToken(token, keyword) * 0.7);
      if (keywordScore >= 63) break;
    }
    const best = Math.max(titleScore, keywordScore);
    if (best === 0) return 0;
    total += best;
  }
  const average = total / tokens.length;
  // Shorter titles are more precise answers to the same tokens.
  const brevity = Math.max(0, 12 - Math.min(12, candidate.title.length / 6));
  return average + brevity;
}

function groupOf(kind) {
  if (kind === 'layer' || kind === 'action' || kind === 'coordinate')
    return kind;
  if (SITE_KINDS.has(kind)) return 'site';
  return 'place';
}

function layerItem(layer) {
  const name = String(layer?.name ?? layer?.id ?? '').trim();
  return {
    id: `layer:${layer.id}`,
    kind: 'layer',
    group: 'layer',
    title: name || String(layer.id),
    subtitle: [layer.group, layer.enabled ? 'ON' : 'OFF']
      .filter(Boolean)
      .join(' · '),
    icon: layer.icon || '◈',
    enabled: Boolean(layer.enabled),
    layerId: layer.id,
    keywords: [String(layer.id), String(layer.group || ''), 'layer', 'toggle'],
    hint: layer.enabled ? 'Enter to turn off' : 'Enter to turn on',
  };
}

function locationItem(location, index) {
  const kind = String(location?.kind || 'place').toLowerCase();
  const name = String(location?.name ?? '').trim();
  const id = location?.id != null ? String(location.id) : `${kind}-${index}`;
  return {
    id: `location:${id}`,
    kind,
    group: groupOf(kind),
    title: name || id,
    subtitle: String(location?.subtitle || kind),
    icon: location?.icon || (groupOf(kind) === 'site' ? '◎' : '📍'),
    lat: Number(location?.lat),
    lon: Number(location?.lon),
    rangeM: Number.isFinite(location?.rangeM)
      ? location.rangeM
      : FLY_RANGE_M[kind] || FLY_RANGE_M.place,
    heading: Number.isFinite(location?.heading) ? location.heading : undefined,
    pitch: Number.isFinite(location?.pitch) ? location.pitch : undefined,
    keywords: [
      kind,
      String(location?.subtitle || ''),
      ...(Array.isArray(location?.keywords) ? location.keywords : []),
    ].map(String),
    hint: 'Enter to fly',
  };
}

function actionItem(action) {
  return {
    id: `action:${action.id}`,
    kind: 'action',
    group: 'action',
    title: String(action.label || action.id),
    subtitle: String(action.hint || ''),
    icon: action.icon || '⌘',
    run: action.run,
    keywords: [String(action.id), String(action.hint || ''), 'action'],
    hint: 'Enter to run',
  };
}

/**
 * Build the flat searchable index from the provider snapshot. Rows with no
 * usable position (locations) are dropped so Enter can never fly nowhere.
 * @param {{layers?: object[], locations?: object[], actions?: object[]}} snapshot
 * @returns {object[]} Items with normalized `_title`/`_keywords` for scoring.
 */
export function buildCommandIndex({
  layers = [],
  locations = [],
  actions = [],
} = {}) {
  const items = [];
  for (const layer of layers) if (layer?.id) items.push(layerItem(layer));
  locations.forEach((location, index) => {
    const item = locationItem(location, index);
    if (Number.isFinite(item.lat) && Number.isFinite(item.lon))
      items.push(item);
  });
  for (const action of actions)
    if (action?.id && typeof action.run === 'function')
      items.push(actionItem(action));
  for (const item of items) {
    item._title = normalizeText(item.title);
    item._keywords = item.keywords.map(normalizeText).filter(Boolean);
  }
  return items;
}

/** Coordinate result for a query that is exactly a decimal-degree pair. */
export function coordinateItem(query) {
  const parsed = parseCoordinateQuery(query);
  if (!parsed) return null;
  return {
    id: `coordinate:${parsed.lat.toFixed(5)},${parsed.lon.toFixed(5)}`,
    kind: 'coordinate',
    group: 'coordinate',
    title: parsed.label,
    subtitle: 'Decimal degrees',
    icon: '⌖',
    lat: parsed.lat,
    lon: parsed.lon,
    rangeM: FLY_RANGE_M.coordinate,
    keywords: [],
    hint: 'Enter to fly',
  };
}

/**
 * Rank the index against a query and group the winners.
 *
 * An empty query lists recents first, then actions and layers, so the palette
 * opens onto something useful. Recents get a boost and win ties.
 * @param {string} query
 * @param {object[]} index From buildCommandIndex.
 * @param {{recent?: string[], limit?: number}} [options]
 * @returns {{groups: Array<{kind: string, label: string, items: object[]}>, flat: object[], total: number}}
 */
export function searchCommands(
  query,
  index,
  { recent = [], limit = COMMAND_RESULT_LIMIT } = {},
) {
  const tokens = tokenize(query);
  const recentRank = new Map(recent.map((id, position) => [id, position]));
  const scored = [];
  const coordinate = coordinateItem(query);
  if (coordinate) scored.push({ item: coordinate, score: 1000 });

  if (!tokens.length) {
    const byRecent = index
      .filter((item) => recentRank.has(item.id))
      .sort((a, b) => recentRank.get(a.id) - recentRank.get(b.id));
    const rest = index.filter(
      (item) =>
        !recentRank.has(item.id) &&
        (item.kind === 'action' || item.kind === 'layer'),
    );
    for (const [position, item] of [...byRecent, ...rest].entries())
      scored.push({ item, score: 500 - position });
  } else {
    for (const item of index) {
      const score = scoreCandidate(tokens, {
        title: item._title,
        keywords: item._keywords,
      });
      if (score <= 0) continue;
      const boost = recentRank.has(item.id)
        ? 15 + Math.max(0, 5 - recentRank.get(item.id))
        : 0;
      scored.push({ item, score: score + boost });
    }
  }

  scored.sort(
    (a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title),
  );
  const flat = scored.slice(0, Math.max(1, limit)).map((entry) => entry.item);
  const groups = COMMAND_GROUP_ORDER.map((kind) => ({
    kind,
    label: GROUP_LABELS[kind],
    items: flat.filter((item) => item.group === kind),
  })).filter((group) => group.items.length);
  // Group order is the visible order, so navigation follows the same sequence.
  const ordered = groups.flatMap((group) => group.items);
  return { groups, flat: ordered, total: ordered.length };
}

/** Index of the first item in the group after (or before) the active one. */
export function nextGroupIndex(groups, activeIndex, direction = 1) {
  const starts = [];
  let offset = 0;
  for (const group of groups) {
    starts.push(offset);
    offset += group.items.length;
  }
  if (!starts.length) return -1;
  let current = 0;
  for (let index = 0; index < starts.length; index++)
    if (activeIndex >= starts[index]) current = index;
  const next = (current + direction + starts.length) % starts.length;
  return starts[next];
}

/**
 * Persisted list of recently run command ids, newest first.
 * @param {{storage?: {getItem: Function, setItem: Function}, key?: string, max?: number}} [options]
 */
export function createRecentStore({
  storage = null,
  key = COMMAND_RECENT_STORAGE_KEY,
  max = COMMAND_RECENT_LIMIT,
} = {}) {
  let ids = [];
  try {
    const raw = storage?.getItem?.(key);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed))
      ids = parsed.filter((id) => typeof id === 'string').slice(0, max);
  } catch {
    ids = [];
  }
  const persist = () => {
    try {
      storage?.setItem?.(key, JSON.stringify(ids));
    } catch {
      /* storage unavailable: recents live for the session only */
    }
  };
  return {
    list: () => [...ids],
    push(id) {
      if (typeof id !== 'string' || !id) return;
      ids = [id, ...ids.filter((entry) => entry !== id)].slice(0, max);
      persist();
    },
    clear() {
      ids = [];
      persist();
    },
  };
}

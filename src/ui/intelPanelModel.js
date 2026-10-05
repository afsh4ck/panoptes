/**
 * Pure presentation rules for the INTEL rail panel.
 *
 * Everything here is DOM-free: subject resolution from the application's
 * selection events, the request descriptor a provider needs, a bounded
 * per-session cache, href hygiene, model normalization and a render tree
 * (`h()` vnodes) the panel mounts and the tests serialize. The panel module
 * stays a thin mount over these rules so every decision is unit-testable.
 */

export const INTEL_KINDS = Object.freeze([
  'aircraft',
  'satellite',
  'vessel',
  'launch',
  'site',
  'event',
]);

/** Text glyphs, not icon-font ligatures: the Material Symbols subset in
 *  index.html only ships the glyphs the shell already renders, and a missing
 *  ligature paints its literal name. */
export const KIND_GLYPHS = Object.freeze({
  aircraft: '✈',
  satellite: '🛰',
  vessel: '🚢',
  launch: '🚀',
  site: '▣',
  event: '◉',
});

export const KIND_LABELS = Object.freeze({
  aircraft: 'AIRCRAFT',
  satellite: 'SATELLITE',
  vessel: 'VESSEL',
  launch: 'LAUNCH',
  site: 'SITE',
  event: 'EVENT',
});

/** Layer ids the selection lanes publish, mapped to a dossier kind. Unknown
 *  layers (installations, datacenters, dams, strategic sites…) are sites. */
const LAYER_KINDS = Object.freeze({
  flights: 'aircraft',
  military: 'aircraft',
  'local-adsb': 'aircraft',
  satellites: 'satellite',
  'ais-live-vessels': 'vessel',
  'rocket-launches': 'launch',
  earthquakes: 'event',
  'local-firms': 'event',
  'disaster-alerts': 'event',
  'conflict-events': 'event',
  'weather-cyclones': 'event',
  'gps-interference': 'event',
});

export const INTEL_CACHE_LIMIT = 50;
export const INTEL_MAX_NOTES = 8;
export const INTEL_MAX_PROPERTY_ROWS = 24;
const BADGE_TONES = new Set(['neutral', 'warn', 'alert', 'ok']);
const HREF_PROTOCOLS = new Set(['http:', 'https:']);
const SAFE_COLOR =
  /^(#[0-9a-f]{3,8}|rgba?\([\d.\s,%/]+\)|var\(--[a-z0-9-]+\))$/i;

export const INTEL_STATES = Object.freeze({
  idle: 'idle',
  loading: 'loading',
  ready: 'ready',
  error: 'error',
});

/** Trim a value to display text; nullish and the strings "undefined"/"null" read as empty. */
export function cleanText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number')
    return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  const text = String(value).trim();
  return text && text !== 'undefined' && text !== 'null' ? text : '';
}

/** Dossier kind for a layer id. */
export function kindForLayer(layerId) {
  return LAYER_KINDS[String(layerId || '')] || 'site';
}

/**
 * Flatten selection properties to display strings. One nested level is kept
 * as `parent.key` (OSM `tags` live there); deeper objects and arrays of
 * objects are dropped rather than stringified as `[object Object]`.
 * @param {object} properties Record properties.
 * @returns {Record<string, string>}
 */
export function flatProperties(properties) {
  const out = {};
  if (!properties || typeof properties !== 'object') return out;
  const put = (key, value) => {
    if (Array.isArray(value)) {
      const text = value.map(cleanText).filter(Boolean).join(', ');
      if (text) out[key] = text;
      return;
    }
    if (value && typeof value === 'object') return;
    const text = cleanText(value);
    if (text) out[key] = text;
  };
  for (const [key, value] of Object.entries(properties)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [sub, inner] of Object.entries(value))
        put(`${key}.${sub}`, inner);
    } else put(key, value);
  }
  return out;
}

/**
 * Subject for a tracking-layer selection (`gev:awareness-subject-selected`).
 * @param {object} detail `{layerId, id, label, position, origin}`.
 * @returns {object|null}
 */
export function subjectFromAwarenessEvent(detail) {
  if (!detail || detail.id === null || detail.id === undefined) return null;
  const layerId = cleanText(detail.layerId);
  if (!layerId) return null;
  const id = cleanText(detail.id);
  if (!id) return null;
  return {
    kind: kindForLayer(layerId),
    id,
    layerId,
    label: cleanText(detail.label) || id,
    tracking: true,
    origin: cleanText(detail.origin) || 'programmatic',
    latitude: null,
    longitude: null,
    properties: {},
    record: null,
  };
}

/**
 * Subject for a context-store selection (`gev:entity-selected`), whose detail
 * is the stored record itself.
 * @param {object} record `{id, layerId, label, latitude, longitude, properties}`.
 * @returns {object|null}
 */
export function subjectFromEntityRecord(record) {
  if (!record || record.id === null || record.id === undefined) return null;
  const id = cleanText(record.id);
  if (!id) return null;
  const layerId = cleanText(record.layerId);
  const properties = flatProperties(record.properties);
  return {
    kind: kindForLayer(layerId),
    id,
    layerId,
    label: cleanText(record.label) || properties.name || id,
    tracking: true,
    origin: 'selection',
    latitude: Number.isFinite(record.latitude) ? record.latitude : null,
    longitude: Number.isFinite(record.longitude) ? record.longitude : null,
    properties,
    record,
  };
}

/** Accept a normalized subject or any selection event detail. */
export function coerceSubject(input) {
  if (!input || typeof input !== 'object') return null;
  if (INTEL_KINDS.includes(input.kind) && cleanText(input.id)) {
    return {
      ...input,
      id: cleanText(input.id),
      label: cleanText(input.label) || cleanText(input.id),
      tracking: input.tracking !== false,
      properties: flatProperties(input.properties),
    };
  }
  return input.properties || Number.isFinite(input.latitude)
    ? subjectFromEntityRecord(input)
    : subjectFromAwarenessEvent(input);
}

/** Stable cache/identity key for a subject. */
export function subjectKey(subject) {
  return `${subject.kind}:${subject.layerId}:${subject.id}`;
}

function normalizeHex(value) {
  const hex = cleanText(value).toLowerCase().replace(/^~/, '');
  return /^[0-9a-f]{6}$/.test(hex) ? hex : null;
}

function normalizeNorad(value) {
  const norad = Number.parseInt(cleanText(value), 10);
  return Number.isInteger(norad) && norad > 0 ? norad : null;
}

/**
 * What a provider needs to look the subject up, read from the live record
 * first (a tracked contact's context slot carries icao24/callsign/noradId/mmsi)
 * and the subject second.
 * @param {object} subject Normalized subject.
 * @param {object|null} live Selected context record.
 * @returns {object} `{kind, key, ...identifiers}`.
 */
export function requestDescriptorFor(subject, live = null) {
  const props = {
    ...flatProperties(subject?.properties),
    ...flatProperties(live?.properties),
  };
  const key = subjectKey(subject);
  switch (subject.kind) {
    case 'aircraft':
      return {
        kind: 'aircraft',
        key,
        hex: normalizeHex(props.icao24 || subject.id),
        callsign: cleanText(props.callsign).toUpperCase() || null,
        registration: cleanText(props.registration) || null,
      };
    case 'satellite':
      return {
        kind: 'satellite',
        key,
        norad: normalizeNorad(props.noradId || subject.id),
      };
    case 'vessel':
      return {
        kind: 'vessel',
        key,
        mmsi: cleanText(props.mmsi || subject.id) || null,
        imo: cleanText(props.imo) || null,
      };
    case 'launch':
      return { kind: 'launch', key, launchId: subject.id };
    case 'event':
      return { kind: 'event', key, layerId: subject.layerId, id: subject.id };
    default: {
      // Most military bases and nuclear sites, and every volcano, carry one.
      const wikidata =
        [
          props['tags.wikidata'],
          props['tags.wikidata_id'],
          props.wikidata,
          cleanText(subject.id).replace(/^wd:/, ''),
        ]
          .map((value) => cleanText(value).toUpperCase())
          .find((value) => /^Q[1-9]\d{0,11}$/.test(value)) || null;
      return {
        kind: 'site',
        key,
        layerId: subject.layerId,
        id: subject.id,
        ...(wikidata ? { wikidata } : {}),
      };
    }
  }
}

/** Keep only absolute http(s) URLs; everything else (javascript:, data:, relative) reads as empty. */
export function sanitizeHref(value) {
  const text = cleanText(value);
  if (!text) return '';
  let url;
  try {
    url = new URL(text);
  } catch {
    return '';
  }
  return HREF_PROTOCOLS.has(url.protocol) ? url.href : '';
}

/** Bounded least-recently-used cache keyed by subject. */
export function createIntelCache(limit = INTEL_CACHE_LIMIT) {
  const max = Number.isInteger(limit) && limit > 0 ? limit : INTEL_CACHE_LIMIT;
  const entries = new Map();
  return {
    get size() {
      return entries.size;
    },
    has: (key) => entries.has(key),
    get(key) {
      if (!entries.has(key)) return undefined;
      const value = entries.get(key);
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, value);
      while (entries.size > max) entries.delete(entries.keys().next().value);
      return value;
    },
    delete: (key) => entries.delete(key),
    clear: () => entries.clear(),
    keys: () => [...entries.keys()],
  };
}

function normalizeBadge(badge) {
  if (!badge) return null;
  if (typeof badge === 'string') {
    const label = cleanText(badge);
    return label ? { label, tone: 'neutral' } : null;
  }
  const label = cleanText(badge.label);
  if (!label) return null;
  const tone = BADGE_TONES.has(badge.tone) ? badge.tone : 'neutral';
  return { label, tone };
}

function normalizeRow(row) {
  if (!row) return null;
  if (Array.isArray(row)) row = { label: row[0], value: row[1] };
  const label = cleanText(row.label);
  const value = cleanText(row.value);
  if (!label || !value) return null;
  const href = sanitizeHref(row.href);
  // In-app targets (NEARBY rows): a position to fly to, a camera to open.
  const lat = Number(row.fly?.lat);
  const lon = Number(row.fly?.lon);
  const fly =
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
      ? { lat, lon }
      : null;
  const camera = cleanText(row.camera).slice(0, 128);
  return {
    label,
    value,
    mono: Boolean(row.mono),
    ...(href ? { href } : {}),
    ...(fly ? { fly } : {}),
    ...(camera ? { camera } : {}),
  };
}

function normalizeSection(section) {
  if (!section) return null;
  const rows = (Array.isArray(section.rows) ? section.rows : [])
    .map(normalizeRow)
    .filter(Boolean);
  if (!rows.length) return null;
  return { heading: cleanText(section.heading), rows };
}

function normalizeLink(link) {
  if (!link) return null;
  const href = sanitizeHref(link.href);
  if (!href) return null;
  return { label: cleanText(link.label) || href, href };
}

function normalizePhoto(photo) {
  if (!photo) return null;
  const src = sanitizeHref(typeof photo === 'string' ? photo : photo.src);
  if (!src) return null;
  return {
    src,
    link: sanitizeHref(photo.link) || null,
    credit: cleanText(photo.credit),
    alt: cleanText(photo.alt),
  };
}

/**
 * Normalize a provider model to the panel contract; anything missing falls
 * back to the subject, anything unsafe (hrefs, colors, tones) is dropped.
 * @param {object|null} model Provider output.
 * @param {object} subject Normalized subject.
 * @returns {object} Panel-ready model.
 */
export function normalizeIntelModel(model, subject) {
  const source = model && typeof model === 'object' ? model : {};
  const kind = INTEL_KINDS.includes(source.kind) ? source.kind : subject.kind;
  const accent = cleanText(source.accent);
  const fetchedAt = Number.isFinite(source.fetchedAt) ? source.fetchedAt : null;
  return {
    kind,
    id: cleanText(source.id) || subject.id,
    title: cleanText(source.title) || subject.label || subject.id,
    subtitle: cleanText(source.subtitle),
    accent: SAFE_COLOR.test(accent) ? accent : '',
    badges: (Array.isArray(source.badges) ? source.badges : [])
      .map(normalizeBadge)
      .filter(Boolean),
    photo: normalizePhoto(source.photo),
    sections: (Array.isArray(source.sections) ? source.sections : [])
      .map(normalizeSection)
      .filter(Boolean),
    links: (Array.isArray(source.links) ? source.links : [])
      .map(normalizeLink)
      .filter(Boolean),
    notes: (Array.isArray(source.notes) ? source.notes : [])
      .map(cleanText)
      .filter(Boolean)
      .slice(0, INTEL_MAX_NOTES),
    raw: source.raw === undefined ? null : source.raw,
    fetchedAt,
  };
}

/**
 * Dossier built from the selection alone, for kinds without a provider or
 * when a provider fails: the layer, the id and the flat properties.
 * @param {object} subject Normalized subject.
 * @param {object|null} live Selected context record.
 * @param {object} [options]
 * @param {string} [options.reason] Note explaining why this is a fallback.
 * @returns {object} Normalized model.
 */
export function fallbackModelFromSubject(
  subject,
  live = null,
  { reason } = {},
) {
  const props = {
    ...flatProperties(subject?.properties),
    ...flatProperties(live?.properties),
  };
  const title = props.name || cleanText(live?.label) || subject.label;
  const subtitle = [props.class, props.subtitle, props.country]
    .map(cleanText)
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(' · ');
  const propertyRows = Object.entries(props)
    .filter(([key]) => !['name', 'subtitle', 'detail'].includes(key))
    .slice(0, INTEL_MAX_PROPERTY_ROWS)
    .map(([key, value]) => ({
      label: key.replace(/[._]/g, ' '),
      value,
      mono: /^(id|icao24|mmsi|imo|noradId|osm_id|tags\.ref)$/i.test(key),
    }));
  const sections = [
    {
      heading: 'SELECTION',
      rows: [
        {
          label: 'Layer',
          value: cleanText(live?.layerName) || subject.layerId,
        },
        { label: 'ID', value: subject.id, mono: true },
        { label: 'Source', value: cleanText(live?.source) },
        { label: 'Detail', value: props.detail },
      ],
    },
    { heading: 'PROPERTIES', rows: propertyRows },
  ];
  return normalizeIntelModel(
    {
      kind: subject.kind,
      id: subject.id,
      title,
      subtitle,
      sections,
      notes: [
        reason || 'No intel provider is registered for this subject kind.',
      ],
      raw: { subject: { ...subject, record: undefined }, properties: props },
      fetchedAt: null,
    },
    subject,
  );
}

/** Relative age line for the footer; empty when the model was never fetched. */
export function formatFetchedAt(fetchedAt, nowMs = Date.now()) {
  if (!Number.isFinite(fetchedAt)) return '';
  const seconds = Math.max(0, Math.round((nowMs - fetchedAt) / 1000));
  if (seconds < 5) return 'fetched just now';
  if (seconds < 60) return `fetched ${seconds} s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `fetched ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `fetched ${hours} h ago`;
}

/** Build a render-tree node. Nullish/false children are dropped, arrays flatten. */
export function h(tag, attrs, ...children) {
  const flat = [];
  const push = (child) => {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) child.forEach(push);
    else flat.push(typeof child === 'object' ? child : String(child));
  };
  children.forEach(push);
  return { tag, attrs: attrs || {}, children: flat };
}

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

const VOID_TAGS = new Set(['img', 'br', 'hr', 'input']);

/** Serialize a render tree to HTML (tests, diagnostics). Text is escaped. */
export function vnodeToHtml(node) {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node !== 'object') return escapeHtml(node);
  const attrs = Object.entries(node.attrs || {})
    .filter(
      ([, value]) => value !== null && value !== undefined && value !== false,
    )
    .map(([key, value]) =>
      value === true ? ` ${key}` : ` ${key}="${escapeHtml(value)}"`,
    )
    .join('');
  if (VOID_TAGS.has(node.tag)) return `<${node.tag}${attrs}>`;
  const inner = node.children.map(vnodeToHtml).join('');
  return `<${node.tag}${attrs}>${inner}</${node.tag}>`;
}

/** Empty-state tree shown before any selection and after CLOSE. */
export function renderEmptyView() {
  return h(
    'div',
    { class: 'intel-empty' },
    h('strong', null, 'NO SUBJECT'),
    h(
      'span',
      null,
      'Select an aircraft, satellite, vessel, launch or mapped site to build its dossier.',
    ),
  );
}

function renderRow(row) {
  const value = row.href
    ? h(
        'a',
        { href: row.href, target: '_blank', rel: 'noopener noreferrer' },
        row.value,
      )
    : row.camera || row.fly
      ? h(
          'button',
          {
            type: 'button',
            class: 'intel-row-target',
            'data-intel-camera': row.camera || null,
            'data-intel-fly-lat': row.fly ? String(row.fly.lat) : null,
            'data-intel-fly-lon': row.fly ? String(row.fly.lon) : null,
          },
          row.value,
        )
      : row.value;
  return [
    h('dt', null, row.label),
    h('dd', { class: row.mono ? 'mono' : null }, value),
  ];
}

/**
 * Full dossier tree for the current panel state.
 * @param {object} view
 * @param {object} view.subject Normalized subject.
 * @param {object|null} view.model Normalized model (may be null while loading).
 * @param {string} view.state One of INTEL_STATES.
 * @param {string} [view.error] Error text for the error state.
 * @param {number} [view.nowMs] Clock for the fetched-at line.
 * @param {boolean} [view.canFly] Whether a FLY TO target exists.
 * @returns {object} vnode
 */
export function renderIntelView({
  subject,
  model,
  state,
  error = '',
  nowMs = Date.now(),
  canFly = false,
}) {
  if (!subject) return renderEmptyView();
  const kind = model?.kind || subject.kind;
  const title = model?.title || subject.label;
  const badges = [...(model?.badges || [])];
  if (subject.tracking === false)
    badges.push({ label: 'NOT TRACKING', tone: 'warn' });
  const hasRaw = model?.raw !== null && model?.raw !== undefined;
  const fetched = formatFetchedAt(model?.fetchedAt, nowMs);

  return h(
    'article',
    {
      class: `intel-dossier kind-${kind} state-${state}`,
      'data-intel-kind': kind,
      'data-intel-id': subject.id,
      style: model?.accent ? `--intel-accent: ${model.accent}` : null,
    },
    h(
      'header',
      { class: 'intel-head' },
      h(
        'span',
        { class: 'intel-glyph', 'aria-hidden': 'true' },
        KIND_GLYPHS[kind],
      ),
      h(
        'div',
        { class: 'intel-titles' },
        h('h3', { class: 'intel-title' }, title),
        model?.subtitle
          ? h('p', { class: 'intel-subtitle' }, model.subtitle)
          : null,
      ),
      badges.length
        ? h(
            'div',
            { class: 'intel-badges' },
            badges.map((badge) =>
              h(
                'span',
                { class: `intel-badge tone-${badge.tone}` },
                badge.label,
              ),
            ),
          )
        : null,
    ),
    state === INTEL_STATES.loading
      ? h(
          'div',
          { class: 'intel-status is-loading', role: 'status' },
          'FETCHING INTEL…',
        )
      : null,
    state === INTEL_STATES.error
      ? h(
          'div',
          { class: 'intel-status is-error', role: 'status' },
          error || 'Intel provider unavailable',
        )
      : null,
    model?.photo
      ? h(
          'figure',
          { class: 'intel-photo' },
          model.photo.link
            ? h(
                'a',
                {
                  href: model.photo.link,
                  target: '_blank',
                  rel: 'noopener noreferrer',
                },
                h('img', {
                  src: model.photo.src,
                  alt: model.photo.alt || `${title} photo`,
                  loading: 'lazy',
                  'data-intel-photo': 'true',
                }),
              )
            : h('img', {
                src: model.photo.src,
                alt: model.photo.alt || `${title} photo`,
                loading: 'lazy',
                'data-intel-photo': 'true',
              }),
          model.photo.credit ? h('figcaption', null, model.photo.credit) : null,
        )
      : null,
    (model?.sections || []).map((section) =>
      h(
        'section',
        { class: 'intel-section' },
        section.heading
          ? h('h4', { class: 'intel-section-heading' }, section.heading)
          : null,
        h('dl', { class: 'intel-rows' }, section.rows.map(renderRow)),
      ),
    ),
    model?.links?.length
      ? h(
          'div',
          { class: 'intel-links' },
          model.links.map((link) =>
            h(
              'a',
              {
                class: 'data-toggle-chip',
                href: link.href,
                target: '_blank',
                rel: 'noopener noreferrer',
              },
              link.label,
            ),
          ),
        )
      : null,
    model?.notes?.length
      ? h(
          'ul',
          { class: 'intel-notes' },
          model.notes.map((note) => h('li', null, note)),
        )
      : null,
    h(
      'footer',
      { class: 'intel-footer' },
      fetched ? h('span', { class: 'intel-fetched' }, fetched) : null,
      h(
        'div',
        { class: 'intel-actions' },
        canFly
          ? h(
              'button',
              {
                type: 'button',
                class: 'scene-btn',
                'data-intel-action': 'fly',
              },
              'FLY TO',
            )
          : null,
        hasRaw
          ? h(
              'button',
              {
                type: 'button',
                class: 'scene-btn',
                'data-intel-action': 'copy',
              },
              'COPY JSON',
            )
          : null,
        h(
          'button',
          { type: 'button', class: 'scene-btn', 'data-intel-action': 'export' },
          'EXPORT',
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'scene-btn scene-btn-danger',
            'data-intel-action': 'close',
          },
          'CLOSE',
        ),
      ),
    ),
  );
}

/** Header badge text: the kind, plus HELD once the subject stopped tracking. */
export function panelBadgeText(subject) {
  if (!subject) return '';
  const kind = KIND_LABELS[subject.kind] || 'SUBJECT';
  return subject.tracking === false ? `${kind} · HELD` : kind;
}

/** Filesystem-safe export name for a subject. */
export function exportFileName(subject) {
  const id =
    cleanText(subject?.id).replace(/[^a-z0-9._-]+/gi, '-') || 'subject';
  return `intel-${subject?.kind || 'subject'}-${id}.json`;
}

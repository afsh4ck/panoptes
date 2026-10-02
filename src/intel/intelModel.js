/**
 * IntelModel — the one presentation-neutral shape every intel card renders.
 *
 * Producers (aircraft, satellite, vessel, launch, site) build a model with
 * `createIntelModel`; the intel panel renders it without knowing the source.
 * Pure data only: no DOM, no Cesium, no fetch. Every producer keeps its raw
 * payload on `raw` so a renderer can offer "copy JSON" without a second fetch.
 *
 * @typedef {'aircraft'|'satellite'|'vessel'|'launch'|'site'} IntelKind
 * @typedef {'neutral'|'warn'|'alert'|'ok'} BadgeTone
 * @typedef {{label: string, tone: BadgeTone}} IntelBadge
 * @typedef {{src: string, link: string|null, credit: string|null}} IntelPhoto
 * @typedef {{label: string, value: string, mono?: boolean, href?: string}} IntelRow
 * @typedef {{heading: string, rows: IntelRow[]}} IntelSection
 * @typedef {{label: string, href: string}} IntelLink
 * @typedef {object} IntelModel
 * @property {IntelKind} kind
 * @property {string} id Stable identity within the kind (hex, NORAD id, MMSI…).
 * @property {string} title
 * @property {string} subtitle
 * @property {string} accent CSS color the card may use for its accent.
 * @property {IntelBadge[]} badges
 * @property {IntelPhoto|null} photo
 * @property {IntelSection[]} sections
 * @property {IntelLink[]} links
 * @property {object} raw Source payload(s), JSON-safe.
 * @property {number|null} fetchedAt Epoch ms of the freshest upstream read.
 * @property {string[]} notes Honesty notes: missing sources, estimates, caveats.
 */

export const INTEL_KINDS = Object.freeze([
  'aircraft',
  'satellite',
  'vessel',
  'launch',
  'site',
]);
export const BADGE_TONES = Object.freeze(['neutral', 'warn', 'alert', 'ok']);
export const DEFAULT_INTEL_ACCENT = '#f5a524';

const MAX_HREF_LENGTH = 2048;
const MAX_TEXT_LENGTH = 512;

/** Trim any value to a bounded display string; empty for null/undefined/blank. */
export function cleanText(value, max = MAX_TEXT_LENGTH) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number')
    return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text || text === 'undefined' || text === 'null') return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Shorten text with an ellipsis; never splits a surrogate pair. */
export function truncate(text, max = 64) {
  const value = cleanText(text, Number.POSITIVE_INFINITY);
  const limit = Number.isFinite(max) && max > 1 ? Math.floor(max) : 64;
  if (value.length <= limit) return value;
  const chars = Array.from(value);
  return chars.length <= limit
    ? value
    : `${chars.slice(0, limit - 1).join('')}…`;
}

/**
 * Accept only absolute http(s) URLs without embedded credentials. Anything
 * else (javascript:, data:, relative paths, userinfo) returns null so a
 * renderer can bind it straight to an anchor.
 * @param {unknown} value
 * @returns {string|null}
 */
export function sanitizeHref(value) {
  const text = cleanText(value, MAX_HREF_LENGTH + 1);
  if (!text || text.length > MAX_HREF_LENGTH) return null;
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (!url.hostname || !url.hostname.includes('.')) return null;
  return url.href;
}

const enUS = (digits) =>
  new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

/** Locale-stable number with an optional unit suffix; '' when not finite. */
export function fmtNumber(value, { digits = 0, unit = '' } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  const precision = Math.max(0, Math.min(6, Math.floor(digits)));
  const text = enUS(precision).format(number);
  return unit ? `${text} ${unit}` : text;
}

/** Metres as a human distance: "850 m" or "12.3 km" (with nmi past 10 km). */
export function fmtDistance(meters) {
  const m = Number(meters);
  if (!Number.isFinite(m) || m < 0) return '';
  if (m < 1000) return `${fmtNumber(m)} m`;
  const km = m / 1000;
  const kmText = `${fmtNumber(km, { digits: km < 100 ? 1 : 0 })} km`;
  return km >= 10 ? `${kmText} · ${fmtNumber(m / 1852)} nmi` : kmText;
}

/** Metres as a dimension: "35.8 m (117.5 ft)". */
export function fmtLength(meters) {
  const m = Number(meters);
  if (!Number.isFinite(m) || m <= 0) return '';
  return `${fmtNumber(m, { digits: m < 100 ? 1 : 0 })} m (${fmtNumber(
    m * 3.28084,
    { digits: m < 100 ? 1 : 0 },
  )} ft)`;
}

/** Kilograms as a mass: "77,000 kg (169,756 lb)"; tonnes past 1,000 t. */
export function fmtMass(kg) {
  const value = Number(kg);
  if (!Number.isFinite(value) || value <= 0) return '';
  if (value >= 1_000_000)
    return `${fmtNumber(value / 1000, { digits: 0 })} t (${fmtNumber(
      value * 2.20462,
    )} lb)`;
  return `${fmtNumber(value)} kg (${fmtNumber(value * 2.20462)} lb)`;
}

/** Knots as a speed: "460 kt · 852 km/h". */
export function fmtSpeed(knots) {
  const kt = Number(knots);
  if (!Number.isFinite(kt) || kt < 0) return '';
  return `${fmtNumber(kt)} kt · ${fmtNumber(kt * 1.852)} km/h`;
}

/** Feet as an aviation altitude: "35,000 ft (10,668 m)"; flight level past FL180. */
export function fmtAltitude(feet) {
  const ft = Number(feet);
  if (!Number.isFinite(ft)) return '';
  const base = `${fmtNumber(ft)} ft (${fmtNumber(ft * 0.3048)} m)`;
  return ft >= 18_000 ? `FL${Math.round(ft / 100)} · ${base}` : base;
}

/** ISO/epoch input as a compact UTC stamp: "2026-09-30 18:24 UTC"; '' when unparseable. */
export function fmtDate(value, { dateOnly = false } = {}) {
  if (value === null || value === undefined || value === '') return '';
  const date =
    typeof value === 'number' ? new Date(value) : new Date(String(value));
  if (Number.isNaN(date.getTime())) return '';
  const iso = date.toISOString();
  return dateOnly
    ? iso.slice(0, 10)
    : `${iso.slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * One label/value row, or null when the value is empty — so producers can
 * push candidates freely and let `intelSection` drop the blanks.
 * @param {string} label
 * @param {unknown} value
 * @param {{mono?: boolean, href?: unknown}} [options]
 * @returns {IntelRow|null}
 */
export function intelRow(label, value, { mono = false, href } = {}) {
  const text = cleanText(value);
  const name = cleanText(label, 64);
  if (!text || !name) return null;
  const row = { label: name, value: text };
  if (mono) row.mono = true;
  const link = href === undefined ? null : sanitizeHref(href);
  if (link) row.href = link;
  return row;
}

/**
 * A section from candidate rows; null when nothing survived.
 * @param {string} heading
 * @param {Array<IntelRow|null|undefined>} rows
 * @returns {IntelSection|null}
 */
export function intelSection(heading, rows) {
  const name = cleanText(heading, 48);
  const kept = (Array.isArray(rows) ? rows : [])
    .map((row) => (row && typeof row === 'object' ? normalizeRow(row) : null))
    .filter(Boolean);
  if (!name || !kept.length) return null;
  return { heading: name, rows: kept };
}

function normalizeRow(row) {
  return intelRow(row.label, row.value, {
    mono: row.mono === true,
    href: row.href,
  });
}

function normalizeBadge(badge) {
  if (!badge) return null;
  const label = cleanText(typeof badge === 'string' ? badge : badge.label, 32);
  if (!label) return null;
  const tone = BADGE_TONES.includes(badge?.tone) ? badge.tone : 'neutral';
  return { label, tone };
}

function normalizePhoto(photo) {
  const src = sanitizeHref(photo?.src);
  if (!src) return null;
  return {
    src,
    link: sanitizeHref(photo?.link),
    credit: cleanText(photo?.credit, 96) || null,
  };
}

function normalizeLink(link) {
  const href = sanitizeHref(link?.href);
  const label = cleanText(link?.label, 48);
  return href && label ? { label, href } : null;
}

/**
 * Build a validated IntelModel. Unknown kinds throw (a card must know what it
 * is); everything else is normalized so a renderer never sees blanks, unsafe
 * hrefs, duplicate links or empty sections.
 * @param {Partial<IntelModel>} input
 * @returns {IntelModel}
 */
export function createIntelModel(input = {}) {
  if (!INTEL_KINDS.includes(input.kind))
    throw new TypeError(`Unknown intel kind: ${input.kind}`);
  const seenLinks = new Set();
  const links = [];
  for (const candidate of Array.isArray(input.links) ? input.links : []) {
    const link = normalizeLink(candidate);
    if (!link || seenLinks.has(link.href)) continue;
    seenLinks.add(link.href);
    links.push(link);
  }
  const sections = (Array.isArray(input.sections) ? input.sections : [])
    .map((section) => intelSection(section?.heading, section?.rows))
    .filter(Boolean);
  const badges = (Array.isArray(input.badges) ? input.badges : [])
    .map(normalizeBadge)
    .filter(Boolean);
  const notes = (Array.isArray(input.notes) ? input.notes : [])
    .map((note) => cleanText(note, 240))
    .filter(Boolean);
  const fetchedAt = Number(input.fetchedAt);
  return {
    kind: input.kind,
    id: cleanText(input.id, 96) || 'unknown',
    title: cleanText(input.title, 96) || 'UNKNOWN',
    subtitle: cleanText(input.subtitle, 160),
    accent: cleanText(input.accent, 32) || DEFAULT_INTEL_ACCENT,
    badges,
    photo: normalizePhoto(input.photo),
    sections,
    links,
    raw:
      input.raw && typeof input.raw === 'object' && !Array.isArray(input.raw)
        ? input.raw
        : {},
    fetchedAt: Number.isFinite(fetchedAt) && fetchedAt > 0 ? fetchedAt : null,
    notes,
  };
}

/** Structural check a renderer can run before trusting a value. */
export function isIntelModel(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    INTEL_KINDS.includes(value.kind) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    Array.isArray(value.sections) &&
    Array.isArray(value.links) &&
    Array.isArray(value.badges) &&
    Array.isArray(value.notes),
  );
}

import { translateRouteInstruction } from './routeInstructionsEs.js';

/**
 * Pure translation rules for the bilingual (English / Spanish) interface.
 *
 * The application is authored in English. Spanish is applied at the DOM
 * boundary from a dictionary keyed by the English text, so every surface —
 * static templates and text written at runtime — follows one language switch
 * without threading a translation function through every module.
 *
 * Lookup order for a text:
 *  1. exact entry;
 *  2. case-insensitive entry, re-cased to match the source (ALL CAPS stays
 *     ALL CAPS, a capitalised source stays capitalised);
 *  3. the text without a trailing colon / ellipsis, re-attached afterwards;
 *  4. compound readouts split on " · ", " | " and " — ", translated per part
 *     (parts that are numbers, codes or names pass through unchanged).
 */

export const LANGUAGES = Object.freeze(['es', 'en']);
export const DEFAULT_LANGUAGE = 'es';
export const LANGUAGE_STORAGE_KEY = 'panoptes:language:v1';

/** A supported language code, falling back to the default. */
export function normalizeLanguage(value) {
  const code = String(value || '')
    .toLowerCase()
    .slice(0, 2);
  return LANGUAGES.includes(code) ? code : DEFAULT_LANGUAGE;
}

/** Collapse whitespace so markup indentation does not defeat lookups. */
export function normalizeKey(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

const isUpper = (s) => s === s.toUpperCase() && s !== s.toLowerCase();
const isCapitalised = (s) => {
  const first = s.match(/\p{L}/u)?.[0];
  return Boolean(first) && first === first.toUpperCase();
};

/** Re-case `translated` to follow the casing style of `source`. */
export function matchCase(source, translated) {
  if (isUpper(source)) return translated.toUpperCase();
  if (isCapitalised(source))
    return translated.replace(/\p{L}/u, (c) => c.toUpperCase());
  if (source === source.toLowerCase()) return translated.toLowerCase();
  return translated;
}

/**
 * Build a lookup from an `{english: spanish}` object: exact keys plus a
 * lower-cased index for case-insensitive hits.
 */
export function createLookup(dictionary = {}) {
  const exact = new Map();
  const folded = new Map();
  for (const [en, es] of Object.entries(dictionary)) {
    const key = normalizeKey(en);
    if (!key || typeof es !== 'string' || !es) continue;
    exact.set(key, es);
    const lower = key.toLowerCase();
    if (!folded.has(lower)) folded.set(lower, es);
  }
  return { exact, folded };
}

function lookupWhole(lookup, key) {
  if (lookup.exact.has(key)) return lookup.exact.get(key);
  const hit = lookup.folded.get(key.toLowerCase());
  return hit === undefined ? null : matchCase(key, hit);
}

/**
 * Readouts that embed numbers, where word order differs in Spanish.
 * Each entry: [pattern, replacement]; casing follows the source.
 */
const PATTERNS = Object.freeze([
  [
    /^(\d+(?:[.,]\d+)?)\s*(s|sec|secs|min|mins|m|h|hr|hrs|d|days?|hours?|minutes?|seconds?)\s+ago$/i,
    (_, n, unit) => `hace ${n} ${SPANISH_UNITS[unit.toLowerCase()] || unit}`,
  ],
  [
    /^(\d[\d,.]*)\s+(cameras?|layers?|sites?|aircraft|vessels?|ships?|satellites?|alerts?|results?|zones?|records?)$/i,
    (_, n, noun) => `${n} ${SPANISH_NOUNS[noun.toLowerCase()] || noun}`,
  ],
  [/^updated (.+) ago$/i, (_, when) => `actualizado hace ${when}`],
  // Cockpit readouts.
  [
    /^(\d+) INPUTS? UNKNOWN$/,
    (_, n) =>
      `${n} ${n === '1' ? 'FUENTE DESCONOCIDA' : 'FUENTES DESCONOCIDAS'}`,
  ],
  [/^(\d+) KM AIR\/SEA WINDOW$/, (_, n) => `VENTANA AIRE/MAR DE ${n} KM`],
  [
    /^INSTALLATIONS WITHIN (\d+) KM$/,
    (_, n) => `EMPLAZAMIENTOS A MENOS DE ${n} KM`,
  ],
  [/^CLOUD (\d+)%$/, (_, n) => `NUBES ${n}%`],
  [/^Select flight (.+)$/, (_, cs) => `Seleccionar vuelo ${cs}`],
  [
    /^Detection overlay: (\w+)$/,
    (_, mode) =>
      `Superposición de detecciones: ${DETECTION_MODES_ES[mode] || mode}`,
  ],
  [
    /^Current cockpit vision style: (.+)\. Activate for next style\.$/,
    (_, mode) =>
      `Modo de visión de cabina: ${mode}. Actívalo para pasar al siguiente.`,
  ],
  [/^([\d.,]+)\s*km\s+left$/i, (_, n) => `${n} km restantes`],
  [
    /^(\d+)\s+keys?\s+waiting$/i,
    (_, n) => `${n} ${n === '1' ? 'clave pendiente' : 'claves pendientes'}`,
  ],
]);
const DETECTION_MODES_ES = Object.freeze({
  off: 'desactivada',
  sparse: 'dispersa',
  dense: 'densa',
  panoptic: 'panóptica',
  god: 'total',
});
const SPANISH_UNITS = Object.freeze({
  s: 's',
  sec: 's',
  secs: 's',
  second: 'segundo',
  seconds: 'segundos',
  min: 'min',
  mins: 'min',
  m: 'min',
  minute: 'minuto',
  minutes: 'minutos',
  h: 'h',
  hr: 'h',
  hrs: 'h',
  hour: 'hora',
  hours: 'horas',
  d: 'd',
  day: 'día',
  days: 'días',
});
const SPANISH_NOUNS = Object.freeze({
  camera: 'cámara',
  cameras: 'cámaras',
  layer: 'capa',
  layers: 'capas',
  site: 'sitio',
  sites: 'sitios',
  aircraft: 'aeronaves',
  vessel: 'buque',
  vessels: 'buques',
  ship: 'barco',
  ships: 'barcos',
  satellite: 'satélite',
  satellites: 'satélites',
  alert: 'alerta',
  alerts: 'alertas',
  result: 'resultado',
  results: 'resultados',
  zone: 'zona',
  zones: 'zonas',
  record: 'registro',
  records: 'registros',
});

function applyPatterns(key) {
  for (const [pattern, replace] of PATTERNS) {
    if (!pattern.test(key)) continue;
    return matchCase(key, key.replace(pattern, replace));
  }
  return null;
}

const SEPARATORS = /(\s+·\s+|\s+\|\s+|\s+—\s+)/;
const SUFFIX = /(\s*(?::|…|\.\.\.)\s*)$/;

/**
 * Translate one text. Returns null when nothing would change, so callers can
 * leave the node untouched.
 */
export function translateText(lookup, text) {
  if (!lookup || typeof text !== 'string') return null;
  const key = normalizeKey(text);
  if (!key || !/\p{L}{2,}/u.test(key)) return null;
  const lead = text.match(/^\s*/)[0];
  const trail = text.match(/\s*$/)[0];
  const wrap = (value) =>
    value === null || value === key ? null : `${lead}${value}${trail}`;

  const whole = lookupWhole(lookup, key);
  if (whole !== null) return wrap(whole);
  // Route sentences carry street names, so they are patterns, not entries.
  const routeSentence = translateRouteInstruction(key);
  if (routeSentence !== null) return wrap(routeSentence);

  const suffix = key.match(SUFFIX);
  if (suffix) {
    const core = key.slice(0, -suffix[0].length);
    const hit = core && lookupWhole(lookup, core);
    if (hit) return wrap(`${hit}${suffix[0]}`);
  }

  if (SEPARATORS.test(key)) {
    let changed = false;
    const parts = key.split(SEPARATORS).map((part, index) => {
      if (index % 2 === 1) return part; // separator
      const hit =
        lookupWhole(lookup, part) ??
        applyPatterns(part) ??
        translateRouteInstruction(part);
      if (hit === null || hit === part) return part;
      changed = true;
      return hit;
    });
    if (changed) return wrap(parts.join(''));
  }
  return wrap(applyPatterns(key));
}

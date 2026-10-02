/**
 * Shared helpers for the strategic-dataset ETL scripts.
 *
 * Node-only, dependency-free: fetch with retry, RFC 4180 CSV parsing (buffered
 * and streaming), a tiny ZIP reader, regex XML helpers, GeoJSONL writing with
 * validation, manifest/README emission, and a proximity dedupe.
 */
import { createHash } from 'node:crypto';
import { createWriteStream, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

export const USER_AGENT =
  'panoptes-etl/0.1 (+https://github.com/bilawalsidhu/gods-eye-view fork)';

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const DATA_ROOT = path.join(REPO_ROOT, 'src', 'data', 'local_data');
/** Git-ignored scratch space for downloaded upstream payloads. */
export const CACHE_ROOT = path.join(REPO_ROOT, '.gev-cache', 'etl');

/**
 * Cache a JSON-serializable upstream result on disk so a re-run (or a second
 * script sharing the same upstream) never re-fetches. `--refresh` bypasses.
 */
export async function cachedJson(name, producer, { refresh = false } = {}) {
  const file = path.join(CACHE_ROOT, `${name}.json`);
  if (!refresh) {
    try {
      const cached = JSON.parse(await readFile(file, 'utf8'));
      console.log(`  cache hit: ${name}`);
      return cached;
    } catch {
      /* miss */
    }
  }
  const value = await producer();
  await mkdir(CACHE_ROOT, { recursive: true });
  await writeFile(file, JSON.stringify(value), 'utf8');
  return value;
}

// ── Offline country lookup (bundled Natural Earth admin-0) ────────────────

let _countries = null;

function decodeRing(flat, scale) {
  const points = [];
  let lon = flat[0];
  let lat = flat[1];
  points.push([lon * scale, lat * scale]);
  for (let i = 2; i + 1 < flat.length; i += 2) {
    lon += flat[i];
    lat += flat[i + 1];
    points.push([lon * scale, lat * scale]);
  }
  return points;
}

function ringBbox(ring) {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLon, minLat, maxLon, maxLat];
}

function pointInRing(ring, lon, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Decode the bundled Natural Earth country pack once. */
export function loadCountries() {
  if (_countries) return _countries;
  const raw = JSON.parse(
    readFileSync(
      path.join(DATA_ROOT, 'natural_earth', 'countries.json'),
      'utf8',
    ),
  );
  const list = [];
  for (const feature of raw.features || []) {
    const scale = 10 ** -(feature.d || 3);
    const parts = [];
    for (const part of feature.polygons || []) {
      const rings = typeof part[0] === 'number' ? [part] : part;
      if (!rings.length || !rings[0]?.length) continue;
      const outer = decodeRing(rings[0], scale);
      const holes = rings.slice(1).map((ring) => decodeRing(ring, scale));
      parts.push({ outer, holes, bbox: ringBbox(outer) });
    }
    const iso2 = /^[A-Z]{2}$/.test(feature.iso2 || '') ? feature.iso2 : '';
    const iso3 = /^[A-Z]{3}$/.test(feature.iso || '') ? feature.iso : '';
    list.push({ name: feature.name, iso2, iso3, parts });
  }
  _countries = list;
  return list;
}

/** Country record containing a point, or null (oceans, unmapped). */
export function countryAt(lon, lat) {
  for (const country of loadCountries()) {
    for (const part of country.parts) {
      const [minLon, minLat, maxLon, maxLat] = part.bbox;
      if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat)
        continue;
      if (
        pointInRing(part.outer, lon, lat) &&
        !part.holes.some((hole) => pointInRing(hole, lon, lat))
      )
        return country;
    }
  }
  return null;
}

/** ISO 3166-1 alpha-2 for a point, or '' when unknown. */
export function countryCodeAt(lon, lat) {
  const country = countryAt(lon, lat);
  return country ? country.iso2 || country.name : '';
}

export function iso3ToIso2(iso3) {
  const code = String(iso3 || '').toUpperCase();
  const hit = loadCountries().find((country) => country.iso3 === code);
  return hit?.iso2 || '';
}

export function countryNameFromIso2(iso2) {
  const code = String(iso2 || '').toUpperCase();
  const hit = loadCountries().find((country) => country.iso2 === code);
  return hit?.name || '';
}

/** Parse `--flag value`, `--flag=value` and bare `--flag` arguments. */
export function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    if (eq !== -1) {
      args[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      args[token.slice(2)] = next;
      i++;
    } else {
      args[token.slice(2)] = true;
    }
  }
  if (args.limit !== undefined) args.limit = Number(args.limit);
  args.dryRun = Boolean(args['dry-run'] || args.dryRun);
  return args;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch with a total timeout and polite exponential backoff.
 * Retries on network errors, 429 and 5xx. Never retries 4xx other than 429.
 */
export async function fetchWithRetry(
  url,
  {
    timeoutMs = 60_000,
    retries = 3,
    headers = {},
    method = 'GET',
    body,
    backoffMs = 3_000,
    redirect = 'follow',
  } = {},
) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        body,
        redirect,
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, ...headers },
      });
      if (response.ok) {
        clearTimeout(timer);
        return response;
      }
      const retryable = response.status === 429 || response.status >= 500;
      const text = await response.text().catch(() => '');
      lastError = new Error(
        `HTTP ${response.status} for ${url}: ${text.slice(0, 200)}`,
      );
      if (!retryable) {
        clearTimeout(timer);
        throw lastError;
      }
      const retryAfter = Number(response.headers.get('retry-after'));
      const wait =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(120_000, retryAfter * 1000)
          : backoffMs * 2 ** attempt;
      clearTimeout(timer);
      if (attempt < retries) {
        console.warn(
          `  retry ${attempt + 1}/${retries} after ${wait} ms: ${lastError.message}`,
        );
        await sleep(wait);
      }
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (error?.message?.startsWith('HTTP ')) throw error;
      if (attempt < retries) {
        const wait = backoffMs * 2 ** attempt;
        console.warn(
          `  retry ${attempt + 1}/${retries} after ${wait} ms: ${error.message}`,
        );
        await sleep(wait);
      }
    }
  }
  throw lastError;
}

export async function fetchText(url, options) {
  const response = await fetchWithRetry(url, options);
  return response.text();
}

export async function fetchJson(url, options = {}) {
  const response = await fetchWithRetry(url, {
    ...options,
    headers: { Accept: 'application/json', ...(options.headers || {}) },
  });
  return response.json();
}

export async function fetchBuffer(url, options) {
  const response = await fetchWithRetry(url, options);
  return Buffer.from(await response.arrayBuffer());
}

/** Overpass QL POST; tries each endpoint in turn. */
export async function overpass(
  query,
  {
    endpoints = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
    ],
    timeoutMs = 660_000,
  } = {},
) {
  let lastError;
  for (const endpoint of endpoints) {
    try {
      console.log(`  overpass → ${endpoint}`);
      const response = await fetchWithRetry(endpoint, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // overpass-api.de answered 406 to the full UA (with a URL) during
          // the 2026-10 build; the short product token is accepted.
          'User-Agent': 'panoptes-etl/0.1',
        },
        timeoutMs,
        retries: 1,
        backoffMs: 15_000,
      });
      const payload = await response.json();
      if (payload?.remark && /timed out|runtime error/i.test(payload.remark))
        throw new Error(`Overpass remark: ${payload.remark}`);
      return payload;
    } catch (error) {
      lastError = error;
      console.warn(`  overpass failed at ${endpoint}: ${error.message}`);
    }
  }
  throw lastError;
}

/** Wikidata SPARQL (results+json), one request at a time. */
export async function sparql(query, { timeoutMs = 180_000 } = {}) {
  const response = await fetchWithRetry('https://query.wikidata.org/sparql', {
    method: 'POST',
    body: `query=${encodeURIComponent(query)}`,
    headers: {
      Accept: 'application/sparql-results+json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    timeoutMs,
    retries: 2,
    backoffMs: 10_000,
  });
  const payload = await response.json();
  return (payload?.results?.bindings || []).map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, value?.value ?? null]),
    ),
  );
}

/** Page a SPARQL query that ends with a `LIMIT`/`OFFSET`-free body. */
export async function sparqlPaged(
  body,
  { pageSize = 4000, maxPages = 20 } = {},
) {
  const rows = [];
  for (let page = 0; page < maxPages; page++) {
    const query = `${body}\nLIMIT ${pageSize} OFFSET ${page * pageSize}`;
    const chunk = await sparql(query);
    rows.push(...chunk);
    console.log(`  sparql page ${page + 1}: ${chunk.length} rows`);
    if (chunk.length < pageSize) break;
    await sleep(1500);
  }
  return rows;
}

/** Parse "Point(lon lat)" WKT literals from Wikidata. */
export function parseWktPoint(value) {
  const match = /Point\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i.exec(
    String(value || ''),
  );
  if (!match) return null;
  const lon = Number(match[1]);
  const lat = Number(match[2]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return { lon, lat };
}

export const qid = (uri) => String(uri || '').replace(/^.*\/(Q\d+)$/, '$1');

// ── CSV ────────────────────────────────────────────────────────────────────

/**
 * RFC 4180 parser. Handles quoted fields, escaped quotes, CRLF/LF and
 * embedded newlines. Returns an array of rows (arrays of strings).
 */
export function parseCsv(text, { delimiter = ',' } = {}) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Parse CSV text into objects keyed by the header row. */
export function csvObjects(text, options) {
  const rows = parseCsv(text, options).filter(
    (row) => row.length > 1 || (row.length === 1 && row[0] !== ''),
  );
  if (!rows.length) return [];
  const header = rows[0].map((name) => name.trim());
  return rows
    .slice(1)
    .map((row) =>
      Object.fromEntries(header.map((name, index) => [name, row[index] ?? ''])),
    );
}

/**
 * Streaming RFC 4180 reader: feeds every record (as an array of strings) to
 * `onRow` without buffering the whole body. Works on a web ReadableStream of
 * bytes (as returned by fetch).
 */
export async function streamCsv(readable, onRow, { delimiter = ',' } = {}) {
  const decoder = new TextDecoder('utf-8');
  let row = [];
  let field = '';
  let quoted = false;
  let pendingCr = false;
  let first = true;
  let count = 0;
  const reader = readable.getReader();
  const feed = async (chunk) => {
    let text = decoder.decode(chunk, { stream: true });
    if (first) {
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      first = false;
    }
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (pendingCr) {
        pendingCr = false;
        if (ch === '\n') continue;
      }
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else if (i + 1 === text.length) {
            // A quote at a chunk boundary: we cannot see the next char yet.
            // Treat as closing quote; a following `""` split across chunks is
            // rare and only affects a literal quote inside a field.
            quoted = false;
          } else quoted = false;
        } else field += ch;
        continue;
      }
      if (ch === '"') quoted = true;
      else if (ch === delimiter) {
        row.push(field);
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r') pendingCr = true;
        row.push(field);
        field = '';
        const done = row;
        row = [];
        count++;
        await onRow(done, count);
      } else field += ch;
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    await feed(value);
  }
  const tail = decoder.decode();
  if (tail) await feed(new TextEncoder().encode(tail));
  if (field.length || row.length) {
    row.push(field);
    count++;
    await onRow(row, count);
  }
  return count;
}

// ── ZIP ────────────────────────────────────────────────────────────────────

/**
 * Minimal ZIP reader: walks the central directory and inflates entries.
 * Supports stored (0) and deflated (8) entries; no encryption, no ZIP64
 * beyond what fits in 32-bit offsets (fine for the datasets used here).
 * @returns {Map<string, Buffer>}
 */
export function readZipEntries(buffer, { filter = () => true } = {}) {
  const entries = new Map();
  const EOCD = 0x06054b50;
  let eocd = -1;
  for (
    let i = buffer.length - 22;
    i >= Math.max(0, buffer.length - 70_000);
    i--
  ) {
    if (buffer.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('ZIP: end of central directory not found');
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50)
      throw new Error('ZIP: bad central directory entry');
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (!filter(name)) continue;
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50)
      throw new Error(`ZIP: bad local header for ${name}`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = buffer.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) entries.set(name, Buffer.from(data));
    else if (method === 8) entries.set(name, inflateRawSync(data));
    else throw new Error(`ZIP: unsupported method ${method} for ${name}`);
  }
  return entries;
}

// ── XML ────────────────────────────────────────────────────────────────────

/** Inner text of every `<tag ...>...</tag>` occurrence (non-nested use). */
export function xmlBlocks(text, tag) {
  const pattern = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
    'g',
  );
  const out = [];
  let match;
  while ((match = pattern.exec(text))) out.push(match[1]);
  return out;
}

/** First inner text of a tag inside a block, entity-decoded and trimmed. */
export function xmlValue(block, tag) {
  const match = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>|<${tag}(?:\\s[^>]*)?\\/>`,
  ).exec(block);
  return match ? decodeXml(match[1] || '').trim() : '';
}

export function xmlAttr(block, tag, attr) {
  const match = new RegExp(`<${tag}\\b[^>]*\\b${attr}="([^"]*)"`).exec(block);
  return match ? decodeXml(match[1]) : '';
}

export function decodeXml(text) {
  return String(text)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, '&');
}

// ── Geo ────────────────────────────────────────────────────────────────────

export const round5 = (value) => Math.round(Number(value) * 1e5) / 1e5;

export function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function validLonLat(lon, lat) {
  return (
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    lon >= -180 &&
    lon <= 180 &&
    lat >= -90 &&
    lat <= 90
  );
}

/** Lowercase tokens (length >= 3) for fuzzy name matching. */
export function nameTokens(name) {
  return new Set(
    String(name || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3),
  );
}

export function namesSimilar(a, b) {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.size || !tb.size) return false;
  let shared = 0;
  for (const token of ta) if (tb.has(token)) shared++;
  return shared / Math.min(ta.size, tb.size) >= 0.5;
}

/**
 * Spatial grid index for proximity lookups. Cells are ~0.05° (≈5 km).
 */
export function createGridIndex(cellDeg = 0.05) {
  const cells = new Map();
  const key = (lon, lat) =>
    `${Math.floor(lon / cellDeg)}:${Math.floor(lat / cellDeg)}`;
  return {
    add(item, lon, lat) {
      const k = key(lon, lat);
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(item);
    },
    near(lon, lat, radiusKm) {
      const span = Math.max(1, Math.ceil(radiusKm / (cellDeg * 111)));
      const cx = Math.floor(lon / cellDeg);
      const cy = Math.floor(lat / cellDeg);
      const out = [];
      for (let dx = -span; dx <= span; dx++) {
        for (let dy = -span; dy <= span; dy++) {
          const bucket = cells.get(`${cx + dx}:${cy + dy}`);
          if (bucket) out.push(...bucket);
        }
      }
      return out;
    },
  };
}

/**
 * Merge `incoming` features into `base` when a base feature lies within
 * `radiusKm` and either name is empty or the names are similar. Merged
 * incoming tags are copied onto the base feature (base wins on conflicts).
 * Returns the merged array and a count of merges.
 */
export function mergeByProximity(
  base,
  incoming,
  { radiusKm = 2.5, onMerge } = {},
) {
  const index = createGridIndex();
  for (const feature of base) {
    const [lon, lat] = feature.geometry.coordinates;
    index.add(feature, lon, lat);
  }
  let merged = 0;
  const out = [...base];
  for (const feature of incoming) {
    const [lon, lat] = feature.geometry.coordinates;
    let best = null;
    let bestKm = Infinity;
    for (const candidate of index.near(lon, lat, radiusKm)) {
      const [clon, clat] = candidate.geometry.coordinates;
      const km = haversineKm(lat, lon, clat, clon);
      if (km > radiusKm) continue;
      const a = feature.properties.name;
      const b = candidate.properties.name;
      const unnamed =
        !a ||
        !b ||
        /^(unnamed|military)/i.test(a) ||
        /^(unnamed|military)/i.test(b);
      if ((unnamed || namesSimilar(a, b)) && km < bestKm) {
        best = candidate;
        bestKm = km;
      }
    }
    if (best) {
      merged++;
      if (onMerge) onMerge(best, feature);
      else {
        best.properties.tags = {
          ...feature.properties.tags,
          ...best.properties.tags,
        };
        if (!best.properties.name)
          best.properties.name = feature.properties.name;
      }
    } else {
      out.push(feature);
      index.add(feature, lon, lat);
    }
  }
  return { features: out, merged };
}

// ── Output ─────────────────────────────────────────────────────────────────

export function titleCase(text) {
  return String(text || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function clean(value) {
  const text = String(value ?? '').trim();
  return text && text !== 'null' && text !== 'undefined' ? text : '';
}

/** Keep only finite numbers and non-empty strings, in a plain object. */
export function compactTags(tags) {
  const out = {};
  for (const [key, value] of Object.entries(tags || {})) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'string' && value.trim()) out[key] = value.trim();
    else if (typeof value === 'boolean') out[key] = value;
  }
  return out;
}

/** Validate a feature against the shared contract; returns null when invalid. */
export function validateFeature(feature) {
  if (!feature || feature.type !== 'Feature') return null;
  const coords = feature.geometry?.coordinates;
  if (feature.geometry?.type !== 'Point' || !Array.isArray(coords)) return null;
  const [lon, lat] = coords;
  if (!validLonLat(lon, lat)) return null;
  const props = feature.properties || {};
  if (!clean(props.name) || !clean(props.class)) return null;
  return {
    id: String(feature.id),
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [round5(lon), round5(lat)] },
    properties: {
      name: clean(props.name),
      class: clean(props.class),
      subtitle: clean(props.subtitle),
      detail: clean(props.detail),
      country: clean(props.country),
      source: clean(props.source),
      tags: compactTags(props.tags),
    },
  };
}

/** Write one Feature per line; returns count/bytes/sha256 and a class tally. */
export async function writeGeojsonl(filePath, features) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const seen = new Set();
  const classes = {};
  const lines = [];
  let invalid = 0;
  for (const raw of features) {
    const feature = validateFeature(raw);
    if (!feature) {
      invalid++;
      continue;
    }
    if (seen.has(feature.id)) continue;
    seen.add(feature.id);
    classes[feature.properties.class] =
      (classes[feature.properties.class] || 0) + 1;
    lines.push(JSON.stringify(feature));
  }
  const body = lines.join('\n') + (lines.length ? '\n' : '');
  await writeFile(filePath, body, 'utf8');
  return {
    count: lines.length,
    invalid,
    bytes: Buffer.byteLength(body),
    sha256: createHash('sha256').update(body).digest('hex'),
    classes,
  };
}

export async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const body = JSON.stringify(value);
  await writeFile(filePath, body, 'utf8');
  return {
    bytes: Buffer.byteLength(body),
    sha256: createHash('sha256').update(body).digest('hex'),
  };
}

/** Emit manifest.json + README.md beside a dataset. */
export async function writeManifest(dir, manifest, readme) {
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'manifest.json'),
    JSON.stringify(
      { generatedAt: new Date().toISOString(), ...manifest },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  await writeFile(path.join(dir, 'README.md'), readme.trim() + '\n', 'utf8');
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export async function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Standard script entry: run, print a summary line, exit non-zero on failure. */
export async function runDataset(name, fn) {
  const started = Date.now();
  console.log(`▶ ${name}`);
  try {
    const result = await fn(parseArgs());
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`✔ ${name}: ${JSON.stringify(result)} (${seconds}s)`);
    return result;
  } catch (error) {
    console.error(`✖ ${name}: ${error?.stack || error}`);
    process.exitCode = 1;
    return null;
  }
}

/** Convenience for scripts that write a dataset folder. */
export function datasetDir(name) {
  return path.join(DATA_ROOT, name);
}

export { createWriteStream };

/**
 * Name-agnostic clustering: each `incoming` feature within `anchorKm` of an
 * anchor, or within `selfKm` of an already-kept incoming feature, is absorbed
 * (its count added to `tags[countKey]` on the absorber). Named features are
 * kept in preference to unnamed ones when choosing cluster representatives.
 * Returns the kept incoming features (anchors are mutated in place).
 */
export function absorbNearby(
  anchors,
  incoming,
  {
    anchorKm = 1.5,
    selfKm = 0.7,
    countKey = 'members',
    isNamed = () => true,
  } = {},
) {
  const anchorIndex = createGridIndex();
  for (const feature of anchors) {
    const [lon, lat] = feature.geometry.coordinates;
    anchorIndex.add(feature, lon, lat);
  }
  const keptIndex = createGridIndex();
  const kept = [];
  const nearest = (index, lon, lat, km) => {
    let best = null;
    let bestKm = Infinity;
    for (const candidate of index.near(lon, lat, km)) {
      const [clon, clat] = candidate.geometry.coordinates;
      const distance = haversineKm(lat, lon, clat, clon);
      if (distance <= km && distance < bestKm) {
        best = candidate;
        bestKm = distance;
      }
    }
    return best;
  };
  const bump = (target) => {
    const tags = (target.properties.tags ||= {});
    tags[countKey] = (Number(tags[countKey]) || 1) + 1;
  };
  const ordered = [...incoming].sort(
    (a, b) => Number(isNamed(b)) - Number(isNamed(a)),
  );
  for (const feature of ordered) {
    const [lon, lat] = feature.geometry.coordinates;
    const anchor = anchorKm > 0 && nearest(anchorIndex, lon, lat, anchorKm);
    if (anchor) {
      bump(anchor);
      continue;
    }
    const sibling = selfKm > 0 && nearest(keptIndex, lon, lat, selfKm);
    if (sibling) {
      bump(sibling);
      continue;
    }
    kept.push(feature);
    keptIndex.add(feature, lon, lat);
  }
  return kept;
}

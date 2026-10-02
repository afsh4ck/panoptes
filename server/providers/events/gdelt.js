import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { readZipEntries } from './zip.js';
import {
  readResponseBytesCapped,
  readResponseTextCapped,
} from '../common/http.js';
import { validCoordinate, withUserAgent } from './cachedRoute.js';

/**
 * GDELT 2.0 event stream (keyless). Every 15 minutes GDELT publishes
 * `<slot>.export.CSV.zip` (tab-separated, 61 columns, no header) under
 * `gdeltv2/`. This module turns those files into a rolling store of
 * conflict-relevant, machine-coded events. GDELT codes news articles; a row
 * is a media mention pattern, never a verified incident.
 */

export const GDELT_BASE_URL = 'https://data.gdeltproject.org/gdeltv2/';
export const GDELT_LAST_UPDATE_URL = `${GDELT_BASE_URL}lastupdate.txt`;
export const GDELT_SLOT_MS = 15 * 60_000;
export const GDELT_MAX_WINDOW_HOURS = 72;
export const GDELT_EXPORT_COLUMNS = 61;
/** CAMEO root codes retained (protest, coerce, assault, fight, mass violence). */
export const GDELT_KEPT_ROOT_CODES = Object.freeze([
  '14',
  '17',
  '18',
  '19',
  '20',
]);
/** Aggregation cell in degrees (near-duplicate coding of one story). */
export const GDELT_CELL_DEGREES = 0.05;

const COLUMN = Object.freeze({
  id: 0,
  day: 1,
  actor1Name: 6,
  actor2Name: 16,
  eventCode: 26,
  eventBaseCode: 27,
  eventRootCode: 28,
  goldstein: 30,
  mentions: 31,
  tone: 34,
  actionGeoType: 51,
  actionGeoName: 52,
  actionGeoCountry: 53,
  actionGeoLat: 56,
  actionGeoLon: 57,
  dateAdded: 59,
  sourceUrl: 60,
});

export const CONFLICT_KIND_LABELS = Object.freeze({
  protest: 'Protest',
  riot: 'Riot',
  assault: 'Assault',
  explosion: 'Bombing / remote violence',
  violence_against_civilians: 'Violence against civilians',
  fight: 'Armed clash',
  battle: 'Battle',
  mass_violence: 'Mass violence',
  other: 'Coercion',
});

const pad = (value) => String(value).padStart(2, '0');

/** Floor a time to its 15-minute GDELT slot key (`YYYYMMDDHHMMSS`, UTC). */
export function gdeltSlotKey(ms) {
  const floored = Math.floor(ms / GDELT_SLOT_MS) * GDELT_SLOT_MS;
  const date = new Date(floored);
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}00`
  );
}

/** Epoch milliseconds of a slot key; NaN when malformed. */
export function gdeltSlotMs(key) {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(
    String(key || ''),
  );
  if (!match) return NaN;
  const [, y, mo, d, h, mi, s] = match.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, s);
}

/** Slot keys from `latestKey` backwards covering `hours` (newest first). */
export function gdeltSlotsBefore(latestKey, hours) {
  const latestMs = gdeltSlotMs(latestKey);
  if (!Number.isFinite(latestMs)) return [];
  const count = Math.max(
    1,
    Math.min(GDELT_MAX_WINDOW_HOURS, Number(hours) || 0) * 4,
  );
  const keys = [];
  for (let i = 0; i < count; i++)
    keys.push(gdeltSlotKey(latestMs - i * GDELT_SLOT_MS));
  return keys;
}

/** Latest export slot named by `lastupdate.txt`, or null. */
export function parseGdeltLastUpdate(text) {
  const match = /(\d{14})\.export\.CSV\.zip/i.exec(String(text || ''));
  return match ? match[1] : null;
}

/** Map a CAMEO root/base code to the shared conflict kind vocabulary. */
export function gdeltKind(rootCode, baseCode = '') {
  const root = String(rootCode);
  const base = String(baseCode);
  if (root === '14') return base === '145' ? 'riot' : 'protest';
  if (root === '18') return base === '183' ? 'explosion' : 'assault';
  if (root === '19') return 'fight';
  if (root === '20') return 'mass_violence';
  return 'other';
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Parse the tab-separated export into conflict-relevant event rows. */
export function parseGdeltExport(text) {
  const rows = [];
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    if (!line) continue;
    const cols = line.replace(/\r$/, '').split('\t');
    if (cols.length < GDELT_EXPORT_COLUMNS) continue;
    const rootCode = cols[COLUMN.eventRootCode];
    if (!GDELT_KEPT_ROOT_CODES.includes(rootCode)) continue;
    if (cols[COLUMN.actionGeoType] === '0') continue;
    const lat = finite(cols[COLUMN.actionGeoLat]);
    const lon = finite(cols[COLUMN.actionGeoLon]);
    if (lat === null || lon === null || !validCoordinate(lat, lon)) continue;
    const addedMs = gdeltSlotMs(cols[COLUMN.dateAdded]);
    if (!Number.isFinite(addedMs)) continue;
    const url = String(cols[COLUMN.sourceUrl] || '').trim();
    rows.push({
      id: String(cols[COLUMN.id] || '').trim(),
      day: String(cols[COLUMN.day] || '').trim(),
      addedMs,
      rootCode,
      eventCode: String(cols[COLUMN.eventCode] || '').trim(),
      kind: gdeltKind(rootCode, cols[COLUMN.eventBaseCode]),
      actor1: String(cols[COLUMN.actor1Name] || '').trim(),
      actor2: String(cols[COLUMN.actor2Name] || '').trim(),
      place: String(cols[COLUMN.actionGeoName] || '').trim(),
      country: String(cols[COLUMN.actionGeoCountry] || '').trim(),
      lat,
      lon,
      goldstein: finite(cols[COLUMN.goldstein]),
      mentions: Math.max(0, Math.round(finite(cols[COLUMN.mentions]) ?? 0)),
      tone: finite(cols[COLUMN.tone]),
      url: /^https?:\/\//i.test(url) ? url.slice(0, 512) : '',
    });
  }
  return rows;
}

function titleCaseActor(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

/**
 * Collapse near-duplicate codings (same kind, same event day, same 0.05°
 * cell) into one row that sums mentions. Output is the API row shape.
 */
export function aggregateGdeltEvents(rows) {
  const cells = new Map();
  for (const row of rows) {
    const latCell = Math.round(row.lat / GDELT_CELL_DEGREES);
    const lonCell = Math.round(row.lon / GDELT_CELL_DEGREES);
    const key = `${row.kind}|${row.day}|${latCell}|${lonCell}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        key,
        kind: row.kind,
        day: row.day,
        lat: row.lat,
        lon: row.lon,
        place: row.place,
        country: row.country,
        url: row.url,
        actor1: row.actor1,
        actor2: row.actor2,
        events: 0,
        mentions: 0,
        goldsteinSum: 0,
        goldsteinCount: 0,
        toneSum: 0,
        toneCount: 0,
        latestMs: row.addedMs,
      };
      cells.set(key, cell);
    }
    cell.events += 1;
    cell.mentions += row.mentions;
    if (row.goldstein !== null) {
      cell.goldsteinSum += row.goldstein;
      cell.goldsteinCount += 1;
    }
    if (row.tone !== null) {
      cell.toneSum += row.tone;
      cell.toneCount += 1;
    }
    if (row.addedMs > cell.latestMs) cell.latestMs = row.addedMs;
    if (!cell.url && row.url) cell.url = row.url;
    if (!cell.actor1 && row.actor1) cell.actor1 = row.actor1;
    if (!cell.actor2 && row.actor2) cell.actor2 = row.actor2;
  }
  const out = [];
  for (const cell of cells.values()) {
    const actors = [titleCaseActor(cell.actor1), titleCaseActor(cell.actor2)]
      .filter(Boolean)
      .join(' vs ');
    out.push({
      id: `gdelt:${cell.key}`,
      lat: cell.lat,
      lon: cell.lon,
      time: new Date(cell.latestMs).toISOString(),
      source: 'GDELT',
      kind: cell.kind,
      title: `${CONFLICT_KIND_LABELS[cell.kind] || 'Event'} · ${
        cell.place || cell.country || 'unlocated'
      }`,
      actors,
      country: cell.country,
      url: cell.url,
      goldstein:
        cell.goldsteinCount > 0
          ? Math.round((cell.goldsteinSum / cell.goldsteinCount) * 10) / 10
          : null,
      mentions: cell.mentions,
      fatalities: null,
      events: cell.events,
      tone:
        cell.toneCount > 0
          ? Math.round((cell.toneSum / cell.toneCount) * 10) / 10
          : null,
    });
  }
  return out;
}

const LAST_UPDATE_TTL_MS = 60_000;
const FILE_TIMEOUT_MS = 15_000;
const FILE_MAX_BYTES = 16 * 1024 * 1024;
const URGENT_SLOTS = 8;
const CONCURRENCY = 2;
const MISSING_RECENT_MS = 5 * 60_000;
const MISSING_OLD_MS = 6 * 3600_000;
const PERSIST_INTERVAL_MS = 15_000;
/** Token bucket for background backfill: files per refill window. */
const BACKFILL_TOKENS = 120;
const BACKFILL_WINDOW_MS = 30 * 60_000;

/**
 * Rolling store of GDELT conflict events with disk persistence.
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] fetch seam.
 * @param {() => number} [options.now] Clock seam.
 * @param {string|null} [options.cachePath] JSON persistence path; null disables.
 * @param {(message: string) => void} [options.log] Warning sink.
 */
export function createGdeltStore({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  cachePath = path.join(process.cwd(), '.gev-cache', 'gdelt-events.json'),
  log = (message) => console.warn(`[gdelt] ${message}`),
} = {}) {
  fetchImpl = withUserAgent(fetchImpl);
  /** @type {Map<string, {fetchedAt: number, rows: object[]}>} */
  const slots = new Map();
  /** @type {Map<string, number>} slot key → retry-after epoch ms */
  const missing = new Map();
  const inFlight = new Map();
  let latestKey = null;
  let latestCheckedAt = 0;
  let loaded = false;
  let dirty = false;
  let persistTimer = null;
  let backfillRunning = false;
  let backfillTokens = BACKFILL_TOKENS;
  let backfillRefillAt = 0;
  let fetchedFiles = 0;
  let failedFiles = 0;

  async function loadOnce() {
    if (loaded) return;
    loaded = true;
    if (!cachePath) return;
    try {
      const parsed = JSON.parse(await fsp.readFile(cachePath, 'utf8'));
      if (parsed?.version === 1 && parsed.slots) {
        for (const [key, entry] of Object.entries(parsed.slots)) {
          if (
            Number.isFinite(gdeltSlotMs(key)) &&
            Array.isArray(entry?.rows) &&
            Number.isFinite(entry?.fetchedAt)
          )
            slots.set(key, { fetchedAt: entry.fetchedAt, rows: entry.rows });
        }
      }
    } catch {
      /* first run or unreadable cache */
    }
    prune();
  }

  function prune() {
    const cutoff = now() - GDELT_MAX_WINDOW_HOURS * 3600_000;
    for (const key of slots.keys()) {
      if (gdeltSlotMs(key) < cutoff) slots.delete(key);
    }
    for (const [key, until] of missing) if (until <= now()) missing.delete(key);
  }

  function schedulePersist() {
    dirty = true;
    if (persistTimer || !cachePath) return;
    persistTimer = setTimeout(async () => {
      persistTimer = null;
      if (!dirty) return;
      dirty = false;
      try {
        await fsp.mkdir(path.dirname(cachePath), { recursive: true });
        await fsp.writeFile(
          cachePath,
          JSON.stringify({
            version: 1,
            slots: Object.fromEntries(slots),
          }),
          'utf8',
        );
      } catch {
        dirty = true;
      }
    }, PERSIST_INTERVAL_MS);
    persistTimer.unref?.();
  }

  async function refreshLatest() {
    if (latestKey && now() - latestCheckedAt < LAST_UPDATE_TTL_MS) return;
    latestCheckedAt = now();
    try {
      const signal = AbortSignal.timeout(10_000);
      const response = await fetchImpl(GDELT_LAST_UPDATE_URL, { signal });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`lastupdate HTTP ${response.status}`);
      }
      const text = await readResponseTextCapped(response, 8 * 1024, signal);
      const key = parseGdeltLastUpdate(text);
      if (key) {
        latestKey = key;
        return;
      }
    } catch (error) {
      log(`lastupdate unavailable: ${error?.message || error}`);
    }
    // GDELT publishes a slot a few minutes after it closes; assume the one
    // that closed at least 20 minutes ago exists.
    latestKey = gdeltSlotKey(now() - 20 * 60_000);
  }

  async function fetchSlot(key) {
    if (slots.has(key)) return slots.get(key);
    const retryAt = missing.get(key);
    if (retryAt && retryAt > now()) return null;
    if (inFlight.has(key)) return inFlight.get(key);
    const task = (async () => {
      try {
        const signal = AbortSignal.timeout(FILE_TIMEOUT_MS);
        const response = await fetchImpl(
          `${GDELT_BASE_URL}${key}.export.CSV.zip`,
          { signal },
        );
        if (response.status === 404) {
          await response.body?.cancel();
          const recent =
            gdeltSlotMs(key) >= gdeltSlotMs(latestKey) - GDELT_SLOT_MS;
          missing.set(
            key,
            now() + (recent ? MISSING_RECENT_MS : MISSING_OLD_MS),
          );
          return null;
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`HTTP ${response.status}`);
        }
        const bytes = await readResponseBytesCapped(
          response,
          FILE_MAX_BYTES,
          signal,
        );
        const entries = readZipEntries(bytes, {
          maxEntryBytes: FILE_MAX_BYTES,
        });
        const text = entries
          .map((entry) => entry.data.toString('utf8'))
          .join('\n');
        const rows = parseGdeltExport(text);
        const entry = { fetchedAt: now(), rows };
        slots.set(key, entry);
        fetchedFiles += 1;
        schedulePersist();
        return entry;
      } catch (error) {
        failedFiles += 1;
        missing.set(key, now() + MISSING_RECENT_MS);
        log(`slot ${key} failed: ${error?.message || error}`);
        return null;
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, task);
    return task;
  }

  async function fetchMany(keys, { budget = Infinity } = {}) {
    const queue = keys.slice();
    let used = 0;
    const workers = [];
    for (let w = 0; w < CONCURRENCY; w++) {
      workers.push(
        (async () => {
          while (queue.length && used < budget) {
            const key = queue.shift();
            if (slots.has(key)) continue;
            const retryAt = missing.get(key);
            if (retryAt && retryAt > now()) continue;
            used += 1;
            await fetchSlot(key);
          }
        })(),
      );
    }
    await Promise.all(workers);
    return used;
  }

  function refillBackfill() {
    if (now() - backfillRefillAt >= BACKFILL_WINDOW_MS) {
      backfillTokens = BACKFILL_TOKENS;
      backfillRefillAt = now();
    }
  }

  function startBackfill(keys) {
    if (backfillRunning) return;
    refillBackfill();
    const pending = keys.filter(
      (key) => !slots.has(key) && !(missing.get(key) > now()),
    );
    if (!pending.length || backfillTokens <= 0) return;
    backfillRunning = true;
    const budget = Math.min(backfillTokens, pending.length);
    fetchMany(pending, { budget })
      .then((used) => {
        backfillTokens = Math.max(0, backfillTokens - used);
      })
      .catch(() => {})
      .finally(() => {
        backfillRunning = false;
      });
  }

  /**
   * Make the newest slots available (awaited) and extend the backfill for
   * the requested window in the background.
   * @param {{hours?: number}} [options]
   */
  async function ensure({ hours = 24 } = {}) {
    await loadOnce();
    await refreshLatest();
    prune();
    const wanted = gdeltSlotsBefore(
      latestKey,
      Math.min(GDELT_MAX_WINDOW_HOURS, hours),
    );
    const urgent = wanted
      .filter((key) => !slots.has(key) && !(missing.get(key) > now()))
      .slice(0, URGENT_SLOTS);
    if (urgent.length) await fetchMany(urgent);
    startBackfill(wanted.slice(URGENT_SLOTS));
  }

  /** Aggregated rows inside the window ending at the latest slot. */
  function rows({ hours = 24 } = {}) {
    const windowHours = Math.min(GDELT_MAX_WINDOW_HOURS, hours);
    const endMs = latestKey ? gdeltSlotMs(latestKey) + GDELT_SLOT_MS : now();
    const startMs = endMs - windowHours * 3600_000;
    const events = [];
    let loadedSlots = 0;
    for (const [key, entry] of slots) {
      const slotMs = gdeltSlotMs(key);
      if (slotMs < startMs || slotMs >= endMs) continue;
      loadedSlots += 1;
      for (const row of entry.rows) events.push(row);
    }
    const expectedSlots = windowHours * 4;
    return {
      rows: aggregateGdeltEvents(events),
      loadedSlots,
      expectedSlots,
      latestKey,
    };
  }

  function diagnostics() {
    return {
      latestKey,
      slots: slots.size,
      missing: missing.size,
      fetchedFiles,
      failedFiles,
      backfillRunning,
    };
  }

  return { ensure, rows, diagnostics, _slots: slots, _fetchSlot: fetchSlot };
}

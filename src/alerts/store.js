/**
 * Alert history, mute state and the cooldown ledger, persisted as one JSON
 * document. The store never decides what is an alert — the rules do — it only
 * remembers what was raised, what the operator silenced, and when a condition
 * last fired so the same situation does not re-alert every tick.
 */
import { memoryStorage, readStorageJson, writeStorageJson } from './zones.js';

export const ALERT_STORAGE_KEY = 'panoptes:alerts:v1';
export const ALERT_MAX_COUNT = 200;
export const ALERT_SEVERITIES = Object.freeze(['info', 'warn', 'critical']);
/** Ledger entries older than this are forgotten (the longest rule cooldown is 6 h). */
const LEDGER_RETENTION_MS = 24 * 3600_000;
const TEXT_LIMIT = 240;

const cleanText = (value, limit = TEXT_LIMIT) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);

const finite = (value) =>
  Number.isFinite(Number(value)) ? Number(value) : null;

/** Coerce anything into one of the three severities (unknown reads as info). */
export function normalizeSeverity(value) {
  const text = String(value || '').toLowerCase();
  return ALERT_SEVERITIES.includes(text) ? text : 'info';
}

/** Rank for ordering and escalation: info 0, warn 1, critical 2. */
export function severityRank(severity) {
  return Math.max(0, ALERT_SEVERITIES.indexOf(normalizeSeverity(severity)));
}

/** One step up the severity ladder, capped at critical. */
export function escalateSeverity(severity) {
  const rank = severityRank(severity);
  return ALERT_SEVERITIES[Math.min(ALERT_SEVERITIES.length - 1, rank + 1)];
}

/** Normalize an untrusted alert record; null when it has no key or title. */
export function normalizeAlert(input, { now = Date.now } = {}) {
  if (!input || typeof input !== 'object') return null;
  const key = cleanText(input.key, 200);
  const title = cleanText(input.title, 120);
  if (!key || !title) return null;
  const lat = finite(input.lat);
  const lon = finite(input.lon);
  const at = finite(input.at) ?? now();
  return {
    id: cleanText(input.id, 64) || `${key}@${at}`,
    key,
    ruleId: cleanText(input.ruleId, 64) || 'unknown',
    severity: normalizeSeverity(input.severity),
    title,
    detail: cleanText(input.detail),
    layerId: cleanText(input.layerId, 64) || null,
    lat: lat !== null && lat >= -90 && lat <= 90 ? lat : null,
    lon: lon !== null && lon >= -180 && lon <= 180 ? lon : null,
    rangeM:
      finite(input.rangeM) !== null && input.rangeM > 0
        ? Math.round(input.rangeM)
        : null,
    at,
    read: input.read === true,
  };
}

/**
 * @param {object} [options]
 * @param {object} [options.storage] Storage-like adapter; memory fallback.
 * @param {string} [options.key] Storage key.
 * @param {number} [options.maxAlerts] History cap (newest kept).
 * @param {() => number} [options.now] Clock.
 */
export function createAlertStore({
  storage = null,
  key = ALERT_STORAGE_KEY,
  maxAlerts = ALERT_MAX_COUNT,
  now = Date.now,
} = {}) {
  const backing = storage || memoryStorage();
  const listeners = new Set();
  let alerts = [];
  let muted = new Set();
  let ledger = new Map();
  let notify = false;

  function load() {
    const parsed = readStorageJson(backing, key);
    alerts = [];
    const seen = new Set();
    for (const row of Array.isArray(parsed?.alerts) ? parsed.alerts : []) {
      const alert = normalizeAlert(row, { now });
      if (!alert || seen.has(alert.id)) continue;
      seen.add(alert.id);
      alerts.push(alert);
    }
    alerts.sort((a, b) => b.at - a.at);
    alerts = alerts.slice(0, maxAlerts);
    muted = new Set(
      (Array.isArray(parsed?.muted) ? parsed.muted : [])
        .map((id) => cleanText(id, 64))
        .filter(Boolean),
    );
    ledger = new Map();
    const cutoff = now() - LEDGER_RETENTION_MS;
    for (const [entryKey, at] of Object.entries(parsed?.seen || {})) {
      const stamp = finite(at);
      if (stamp !== null && stamp >= cutoff) ledger.set(entryKey, stamp);
    }
    notify = parsed?.notify === true;
  }

  function persist() {
    writeStorageJson(backing, key, {
      version: 1,
      alerts,
      muted: [...muted],
      seen: Object.fromEntries(ledger),
      notify,
    });
  }

  function emit() {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        /* one listener failing never blocks the others */
      }
    }
  }

  function pruneLedger() {
    const cutoff = now() - LEDGER_RETENTION_MS;
    for (const [entryKey, at] of ledger)
      if (at < cutoff) ledger.delete(entryKey);
  }

  load();

  return {
    /** Newest first. */
    list: () => alerts.map((alert) => ({ ...alert })),
    get: (id) => {
      const alert = alerts.find((entry) => entry.id === id);
      return alert ? { ...alert } : null;
    },
    unreadCount: () => alerts.filter((alert) => !alert.read).length,
    /** Add one alert; an alert with the same id is ignored (returns null). */
    add(input) {
      const alert = normalizeAlert(input, { now });
      if (!alert || alerts.some((entry) => entry.id === alert.id)) return null;
      alerts = [alert, ...alerts].slice(0, maxAlerts);
      persist();
      emit();
      return { ...alert };
    },
    dismiss(id) {
      const before = alerts.length;
      alerts = alerts.filter((alert) => alert.id !== id);
      if (alerts.length === before) return false;
      persist();
      emit();
      return true;
    },
    markRead(id) {
      let changed = false;
      alerts = alerts.map((alert) => {
        if (alert.id !== id || alert.read) return alert;
        changed = true;
        return { ...alert, read: true };
      });
      if (changed) {
        persist();
        emit();
      }
      return changed;
    },
    markAllRead() {
      if (!alerts.some((alert) => !alert.read)) return false;
      alerts = alerts.map((alert) => ({ ...alert, read: true }));
      persist();
      emit();
      return true;
    },
    clear() {
      if (!alerts.length) return;
      alerts = [];
      persist();
      emit();
    },
    isMuted: (ruleId) => muted.has(ruleId),
    mutedRules: () => [...muted],
    setMuted(ruleId, value) {
      const id = cleanText(ruleId, 64);
      if (!id) return false;
      const next = typeof value === 'boolean' ? value : !muted.has(id);
      if (next === muted.has(id)) return next;
      if (next) muted.add(id);
      else muted.delete(id);
      persist();
      emit();
      return next;
    },
    /** When a condition key last raised an alert, or null. */
    lastSeenAt: (entryKey) => ledger.get(entryKey) ?? null,
    /** Record that a condition key raised an alert now. */
    remember(entryKey, at = now()) {
      const stamp = finite(at) ?? now();
      ledger.set(String(entryKey), stamp);
      pruneLedger();
      persist();
    },
    /** Whether a key is still inside its cooldown window. */
    isCoolingDown(entryKey, cooldownMs, at = now()) {
      const last = ledger.get(String(entryKey));
      if (last === undefined) return false;
      return at - last < cooldownMs;
    },
    notifyEnabled: () => notify,
    setNotifyEnabled(value) {
      notify = value === true;
      persist();
      emit();
      return notify;
    },
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reload: load,
  };
}

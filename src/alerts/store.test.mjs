import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALERT_STORAGE_KEY,
  createAlertStore,
  escalateSeverity,
  normalizeAlert,
  severityRank,
} from './store.js';
import { memoryStorage } from './zones.js';

test('severity helpers rank and escalate', () => {
  assert.equal(severityRank('info'), 0);
  assert.equal(severityRank('warn'), 1);
  assert.equal(severityRank('critical'), 2);
  assert.equal(severityRank('bogus'), 0);
  assert.equal(escalateSeverity('info'), 'warn');
  assert.equal(escalateSeverity('warn'), 'critical');
  assert.equal(escalateSeverity('critical'), 'critical');
});

test('normalizeAlert cleans fields and rejects empties', () => {
  const alert = normalizeAlert(
    {
      key: 'k',
      title: '  Big   quake ',
      detail: 'x'.repeat(500),
      lat: '12.5',
      lon: 200,
      severity: 'CRITICAL',
      rangeM: 1234.6,
    },
    { now: () => 7 },
  );
  assert.equal(alert.title, 'Big quake');
  assert.equal(alert.detail.length, 240);
  assert.equal(alert.lat, 12.5);
  assert.equal(alert.lon, null);
  assert.equal(alert.severity, 'critical');
  assert.equal(alert.rangeM, 1235);
  assert.equal(alert.at, 7);
  assert.equal(alert.id, 'k@7');
  assert.equal(normalizeAlert({ key: 'k' }), null);
  assert.equal(normalizeAlert({ title: 't' }), null);
});

test('alert store adds newest-first, dedupes ids, caps and persists', () => {
  const storage = memoryStorage();
  let clock = 1000;
  const store = createAlertStore({ storage, maxAlerts: 3, now: () => clock });
  const changes = [];
  store.subscribe(() => changes.push(store.list().length));
  assert.ok(store.add({ key: 'a', title: 'A' }));
  assert.equal(store.add({ key: 'a', title: 'A' }), null); // same id
  clock += 1;
  store.add({ key: 'b', title: 'B' });
  clock += 1;
  store.add({ key: 'c', title: 'C' });
  clock += 1;
  store.add({ key: 'd', title: 'D' });
  assert.deepEqual(
    store.list().map((a) => a.key),
    ['d', 'c', 'b'],
  );
  assert.equal(store.unreadCount(), 3);
  assert.equal(changes.length, 4);

  const reloaded = createAlertStore({ storage, maxAlerts: 3 });
  assert.deepEqual(
    reloaded.list().map((a) => a.key),
    ['d', 'c', 'b'],
  );
  assert.ok(storage.getItem(ALERT_STORAGE_KEY).includes('"alerts"'));
});

test('read, dismiss, clear and mute state', () => {
  const store = createAlertStore({ storage: memoryStorage() });
  const a = store.add({ key: 'a', title: 'A' });
  const b = store.add({ key: 'b', title: 'B' });
  assert.equal(store.markRead(a.id), true);
  assert.equal(store.markRead(a.id), false);
  assert.equal(store.unreadCount(), 1);
  assert.equal(store.markAllRead(), true);
  assert.equal(store.unreadCount(), 0);
  assert.equal(store.dismiss(b.id), true);
  assert.equal(store.dismiss(b.id), false);
  assert.equal(store.list().length, 1);
  store.clear();
  assert.equal(store.list().length, 0);

  assert.equal(store.isMuted('quake-major'), false);
  assert.equal(store.setMuted('quake-major'), true);
  assert.equal(store.isMuted('quake-major'), true);
  assert.deepEqual(store.mutedRules(), ['quake-major']);
  assert.equal(store.setMuted('quake-major', false), false);
  assert.equal(store.setMuted(''), false);
});

test('cooldown ledger remembers keys, expires and survives reload', () => {
  const storage = memoryStorage();
  let clock = 10_000;
  const store = createAlertStore({ storage, now: () => clock });
  assert.equal(store.isCoolingDown('k', 1000), false);
  store.remember('k');
  assert.equal(store.lastSeenAt('k'), 10_000);
  assert.equal(store.isCoolingDown('k', 1000), true);
  clock += 999;
  assert.equal(store.isCoolingDown('k', 1000), true);
  clock += 1;
  assert.equal(store.isCoolingDown('k', 1000), false);

  const reloaded = createAlertStore({ storage, now: () => clock });
  assert.equal(reloaded.lastSeenAt('k'), 10_000);
  // Older than the retention window is dropped on load.
  const later = createAlertStore({
    storage,
    now: () => clock + 25 * 3600_000,
  });
  assert.equal(later.lastSeenAt('k'), null);
});

test('notification preference persists', () => {
  const storage = memoryStorage();
  const store = createAlertStore({ storage });
  assert.equal(store.notifyEnabled(), false);
  store.setNotifyEnabled(true);
  assert.equal(createAlertStore({ storage }).notifyEnabled(), true);
});

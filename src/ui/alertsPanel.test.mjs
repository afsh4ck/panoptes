import { test } from 'node:test';
import assert from 'node:assert/strict';
import { badgeModel, relativeTime, zoneCaption } from './alertsPanel.js';

const NOW = 1_700_000_000_000;

test('relativeTime buckets', () => {
  assert.equal(relativeTime(NOW, NOW), 'just now');
  assert.equal(relativeTime(NOW - 3 * 60_000, NOW), '3 min ago');
  assert.equal(relativeTime(NOW - 2 * 3600_000, NOW), '2 h ago');
  assert.equal(relativeTime(NOW - 30 * 3600_000, NOW), 'yesterday');
  assert.equal(relativeTime(NOW - 5 * 86_400_000, NOW), '5 d ago');
  assert.match(relativeTime(NOW - 60 * 86_400_000, NOW), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(relativeTime('x', NOW), '');
  assert.equal(relativeTime(NOW + 5000, NOW), 'just now'); // clock skew never goes negative
});

test('badgeModel counts unread and flags critical', () => {
  assert.deepEqual(badgeModel([]), {
    text: '0',
    unread: false,
    critical: false,
  });
  const alerts = [
    { severity: 'warn', read: false },
    { severity: 'critical', read: true },
  ];
  assert.deepEqual(badgeModel(alerts), {
    text: '1',
    unread: true,
    critical: false,
  });
  alerts[1].read = false;
  assert.equal(badgeModel(alerts).critical, true);
  const many = Array.from({ length: 150 }, () => ({
    severity: 'info',
    read: false,
  }));
  assert.equal(badgeModel(many).text, '99+');
});

test('zoneCaption formats radius and coordinates', () => {
  assert.equal(
    zoneCaption({ radiusKm: 50, lat: 40.4168, lon: -3.7038 }),
    '50 km · 40.42, -3.70',
  );
  assert.equal(zoneCaption(null), '');
});

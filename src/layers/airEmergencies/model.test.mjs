import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMERGENCY_MEMORY_MS,
  buildEmergencyCard,
  diffNewEmergencies,
  emergencyAccent,
  emergencyCountLabel,
  emergencyLabel,
  mapAnalystRecord,
} from './model.js';

const row = (overrides = {}) => ({
  hex: 'abc123',
  callsign: 'DLH400',
  registration: 'D-AIBD',
  type: 'A319',
  squawk: '7700',
  emergency: 'general',
  lat: 50,
  lon: 8,
  altFt: 27500,
  onGround: false,
  gsKt: 415,
  track: 268,
  seen: 2,
  category: 'A3',
  observedAtMs: 1000,
  ...overrides,
});

test('card copy names the squawk, the identity and the situation', () => {
  const card = buildEmergencyCard(row());
  assert.equal(card.id, 'air-emergency:abc123');
  assert.equal(card.title, '7700 · DLH400');
  assert.deepEqual(card.details, [
    'General emergency',
    'A319 · D-AIBD',
    'FL275 · 415 kt · 268°',
  ]);
  assert.equal(card.accent, emergencyAccent('7700'));
  assert.equal(card.variant, 'card');
  assert.equal(card.interactive, false);
  const nordo = buildEmergencyCard(
    row({
      squawk: '7600',
      emergency: 'nordo',
      callsign: null,
      registration: null,
      type: null,
      altFt: 3200,
      gsKt: null,
      track: null,
    }),
  );
  assert.equal(nordo.title, '7600 · ABC123');
  assert.deepEqual(nordo.details, ['Radio failure · nordo', '3200 ft']);
  const ground = buildEmergencyCard(
    row({ squawk: '7500', onGround: true, emergency: null }),
  );
  assert.equal(ground.details[0], 'Unlawful interference');
  assert.equal(ground.details[2], 'on ground · 415 kt · 268°');
  assert.ok(ground.priority > card.priority, 'hijack outranks emergency');
  assert.ok(card.priority > nordo.priority, 'emergency outranks radio failure');
});

test('identity chain falls through callsign, registration and hex', () => {
  assert.equal(emergencyLabel(row({ callsign: ' ' })), 'D-AIBD');
  assert.equal(
    emergencyLabel(row({ callsign: null, registration: null, hex: '~a1b2c3' })),
    'A1B2C3',
  );
  assert.equal(emergencyLabel({}), 'UNKNOWN');
  assert.equal(emergencyAccent('7500'), '#ff2bd6');
  assert.equal(emergencyAccent('0000'), '#ff3b30');
});

test('new-contact diff remembers hexes across snapshots and expires them', () => {
  const memory = new Map();
  const first = diffNewEmergencies(
    memory,
    [row(), row({ hex: 'def456' })],
    1000,
  );
  assert.deepEqual(
    first.map((r) => r.hex),
    ['abc123', 'def456'],
  );
  const second = diffNewEmergencies(
    memory,
    [row({ hex: 'def456' }), row({ hex: '000001' })],
    2000,
  );
  assert.deepEqual(
    second.map((r) => r.hex),
    ['000001'],
  );
  // abc123 vanished at 1000 and returns after the memory window: alert again.
  const third = diffNewEmergencies(
    memory,
    [row()],
    1000 + EMERGENCY_MEMORY_MS + 1,
  );
  assert.deepEqual(
    third.map((r) => r.hex),
    ['abc123'],
  );
  assert.equal(memory.has('def456'), true, 'recent hexes stay remembered');
});

test('analyst records and count labels are plain', () => {
  const record = mapAnalystRecord(row({ gsKt: NaN }));
  assert.equal(record.id, 'abc123');
  assert.equal(record.name, 'DLH400');
  assert.equal(record.meaning, 'General emergency');
  assert.equal(record.speedKt, null);
  assert.equal(record.altitudeFt, 27500);
  assert.equal(emergencyCountLabel(0), '');
  assert.equal(emergencyCountLabel(1), '1 emergency');
  assert.equal(emergencyCountLabel(3), '3 emergencies');
});

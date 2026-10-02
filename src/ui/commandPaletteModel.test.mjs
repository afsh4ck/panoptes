import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCommandIndex,
  coordinateItem,
  createRecentStore,
  nextGroupIndex,
  normalizeText,
  scoreCandidate,
  scoreToken,
  searchCommands,
  tokenize,
} from './commandPaletteModel.js';

const snapshot = () => ({
  layers: [
    {
      id: 'flights',
      name: 'Live Flights',
      icon: '✈',
      enabled: true,
      group: 'Movement',
    },
    {
      id: 'military',
      name: 'Military Flights',
      icon: '🎖',
      enabled: false,
      group: 'Movement',
    },
    {
      id: 'strategic-nuclear-sites',
      name: 'Nuclear Sites',
      icon: '☢',
      enabled: false,
      group: 'Strategic',
    },
  ],
  locations: [
    {
      id: 'madrid',
      name: 'Madrid',
      lat: 40.4168,
      lon: -3.7038,
      kind: 'city',
      subtitle: 'Spain',
    },
    {
      id: 'rota',
      name: 'Naval Station Rota',
      lat: 36.62,
      lon: -6.35,
      kind: 'base',
      subtitle: 'ES · naval base',
    },
    {
      id: 'hormuz',
      name: 'Strait of Hormuz',
      lat: 26.57,
      lon: 56.25,
      kind: 'chokepoint',
      subtitle: 'Persian Gulf',
    },
    { id: 'bad', name: 'No position', kind: 'city' },
  ],
  actions: [
    {
      id: 'reset',
      label: 'Reset globe',
      hint: 'Full Earth view',
      run: () => {},
    },
    { id: 'tilt', label: 'Tilt view', hint: 'Oblique camera', run: () => {} },
    { id: 'broken', label: 'No run' },
  ],
});

test('normalizeText strips diacritics and case', () => {
  assert.equal(normalizeText('  Mälmö Ñandú '), 'malmo nandu');
  assert.deepEqual(tokenize('Naval, Station  ROTA'), [
    'naval',
    'station',
    'rota',
  ]);
});

test('scoreToken ranks prefix over word-start over substring over subsequence', () => {
  assert.equal(scoreToken('madrid', 'madrid'), 100);
  assert.equal(scoreToken('mad', 'madrid'), 90);
  assert.equal(scoreToken('rota', 'naval station rota'), 80);
  assert.equal(scoreToken('tio', 'naval station rota'), 60);
  assert.equal(scoreToken('nsr', 'naval station rota'), 30);
  assert.equal(scoreToken('zz', 'naval station rota'), 0);
  assert.equal(scoreToken('', 'x'), 0);
});

test('scoreCandidate requires every token and weights keywords lower', () => {
  const candidate = { title: 'live flights', keywords: ['movement', 'layer'] };
  assert.ok(scoreCandidate(['live'], candidate) > 0);
  assert.equal(scoreCandidate(['live', 'ships'], candidate), 0);
  const viaKeyword = scoreCandidate(['movement'], candidate);
  const viaTitle = scoreCandidate(['flights'], candidate);
  assert.ok(viaKeyword > 0 && viaKeyword < viaTitle);
});

test('buildCommandIndex drops unusable rows and normalizes fields', () => {
  const index = buildCommandIndex(snapshot());
  const ids = index.map((item) => item.id);
  assert.ok(ids.includes('layer:flights'));
  assert.ok(ids.includes('location:rota'));
  assert.ok(!ids.includes('location:bad'));
  assert.ok(!ids.includes('action:broken'));
  const rota = index.find((item) => item.id === 'location:rota');
  assert.equal(rota.group, 'site');
  assert.equal(rota.rangeM, 6000);
  const hormuz = index.find((item) => item.id === 'location:hormuz');
  assert.equal(hormuz.group, 'site');
  assert.equal(hormuz.rangeM, 120000);
  const madrid = index.find((item) => item.id === 'location:madrid');
  assert.equal(madrid.group, 'place');
});

test('searchCommands groups results in visible order and caps them', () => {
  const index = buildCommandIndex(snapshot());
  const result = searchCommands('ro', index);
  assert.deepEqual(
    result.groups.map((group) => group.kind),
    ['site'],
  );
  assert.equal(result.flat[0].id, 'location:rota');

  const many = searchCommands('', index, { limit: 3 });
  assert.equal(many.total, 3);
  assert.ok(many.groups.every((group) => group.items.length));
});

test('searchCommands boosts recents and lists them first on an empty query', () => {
  const index = buildCommandIndex(snapshot());
  const result = searchCommands('', index, { recent: ['action:tilt'] });
  assert.equal(result.groups[0].kind, 'layer');
  assert.equal(
    result.flat.find((item) => item.group === 'action').id,
    'action:tilt',
  );
  const boosted = searchCommands('flights', index, {
    recent: ['layer:military'],
  });
  assert.equal(boosted.flat[0].id, 'layer:military');
  const plain = searchCommands('flights', index);
  assert.equal(plain.flat[0].id, 'layer:flights');
});

test('coordinate queries produce a coordinate result ahead of everything', () => {
  const index = buildCommandIndex(snapshot());
  const result = searchCommands('40.4168, -3.7038', index);
  assert.equal(result.groups[0].kind, 'coordinate');
  assert.equal(result.flat[0].lat, 40.4168);
  assert.equal(result.flat[0].lon, -3.7038);
  assert.equal(coordinateItem('12junk, 34oops'), null);
  assert.equal(coordinateItem('40.5N, 3.7W').lon, -3.7);
});

test('nextGroupIndex cycles between group starts', () => {
  const groups = [
    { kind: 'layer', items: [1, 2] },
    { kind: 'place', items: [3] },
    { kind: 'action', items: [4, 5] },
  ];
  assert.equal(nextGroupIndex(groups, 0, 1), 2);
  assert.equal(nextGroupIndex(groups, 1, 1), 2);
  assert.equal(nextGroupIndex(groups, 2, 1), 3);
  assert.equal(nextGroupIndex(groups, 4, 1), 0);
  assert.equal(nextGroupIndex(groups, 0, -1), 3);
  assert.equal(nextGroupIndex([], 0, 1), -1);
});

test('createRecentStore persists newest-first and survives bad storage', () => {
  const memory = new Map();
  const storage = {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
  };
  const store = createRecentStore({ storage, key: 'k', max: 2 });
  store.push('a');
  store.push('b');
  store.push('a');
  assert.deepEqual(store.list(), ['a', 'b']);
  store.push('c');
  assert.deepEqual(store.list(), ['c', 'a']);
  assert.deepEqual(createRecentStore({ storage, key: 'k' }).list(), ['c', 'a']);
  memory.set('bad', '{not json');
  assert.deepEqual(createRecentStore({ storage, key: 'bad' }).list(), []);
  const throwing = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  const fallback = createRecentStore({ storage: throwing });
  fallback.push('x');
  assert.deepEqual(fallback.list(), ['x']);
});

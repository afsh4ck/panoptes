import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CASE_MAX_NOTES,
  caseFilename,
  createCaseStore,
  normalizeCase,
} from './caseStore.js';

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
  };
}

function clock(start = 1000) {
  let now = start;
  return { now: () => now, tick: (ms = 1) => (now += ms) };
}

test('a new store starts empty and persists every mutation', () => {
  const storage = memoryStorage();
  const time = clock();
  const store = createCaseStore({ storage, key: 'k', now: time.now });
  assert.equal(store.getState().name, 'Untitled case');
  assert.deepEqual(store.getState().notes, []);

  const events = [];
  const stop = store.subscribe((state) => events.push(state.notes.length));
  const note = store.addNote({
    text: '  First observation ',
    tags: ['Alpha', 'alpha', 'B@d tag!'],
  });
  assert.equal(note.text, 'First observation');
  assert.deepEqual(note.tags, ['alpha', 'bd tag']);
  assert.equal(note.pin, null);
  assert.deepEqual(events, [1]);

  time.tick(5);
  const pinned = store.addNote({
    pin: { lat: '36.62', lon: -6.35, altM: 900, label: 'Rota' },
  });
  assert.equal(pinned.text, '');
  assert.deepEqual(pinned.pin, {
    lat: 36.62,
    lon: -6.35,
    altM: 900,
    heading: null,
    pitch: null,
    label: 'Rota',
    subjectId: null,
  });
  assert.equal(store.getState().notes[0].id, pinned.id, 'newest note first');
  assert.equal(store.addNote({ text: '   ' }), null, 'empty notes are refused');
  assert.equal(
    store.addNote({ pin: { lat: 99, lon: 0 } }),
    null,
    'bad pins are refused',
  );

  stop();
  store.rename('  Op Rota  ');
  assert.equal(store.getState().name, 'Op Rota');
  assert.deepEqual(events, [1, 2]);

  const reloaded = createCaseStore({ storage, key: 'k', now: time.now });
  assert.equal(reloaded.getState().name, 'Op Rota');
  assert.equal(reloaded.getState().notes.length, 2);
});

test('notes can be updated and removed; tags are deduplicated', () => {
  const store = createCaseStore({ storage: memoryStorage(), key: 'k' });
  const note = store.addNote({ text: 'draft' });
  const updated = store.updateNote(note.id, {
    text: 'final',
    pin: { lat: 1, lon: 2 },
  });
  assert.equal(updated.text, 'final');
  assert.equal(updated.pin.lat, 1);
  assert.equal(store.updateNote('missing', { text: 'x' }), null);
  assert.equal(
    store.updateNote(note.id, { text: '', pin: null }),
    null,
    'cannot blank a note',
  );
  assert.equal(store.getState().notes[0].text, 'final');
  assert.equal(store.removeNote(note.id), true);
  assert.equal(store.removeNote(note.id), false);

  store.addTag('Maritime');
  store.addTag('maritime');
  store.addTag('');
  assert.deepEqual(store.getState().tags, ['maritime']);
  store.removeTag('MARITIME');
  assert.deepEqual(store.getState().tags, []);
});

test('export and import round-trip; bad input is refused', () => {
  const storage = memoryStorage();
  const store = createCaseStore({ storage, key: 'k', now: () => 42 });
  store.rename('Round trip');
  store.addTag('x');
  store.addNote({ text: 'one', pin: { lat: 1, lon: 1 } });
  const json = store.exportJson();
  const parsed = JSON.parse(json);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.exportedAt, '1970-01-01T00:00:00.042Z');

  const other = createCaseStore({ storage: memoryStorage(), key: 'k' });
  assert.equal(other.importJson(json), true);
  assert.equal(other.getState().name, 'Round trip');
  assert.deepEqual(other.getState().tags, ['x']);
  assert.equal(other.getState().notes[0].text, 'one');
  assert.equal(other.importJson('{nope'), false);
  assert.equal(other.importJson('[]'), false);
  assert.equal(
    other.getState().name,
    'Round trip',
    'a refused import changes nothing',
  );

  assert.equal(other.mergeJson(json), 0, 'known ids are not duplicated');
  store.addNote({ text: 'two' });
  assert.equal(other.mergeJson(store.exportJson()), 1);
  assert.equal(other.getState().notes.length, 2);

  store.clear();
  assert.equal(store.getState().notes.length, 0);
  assert.equal(store.getState().name, 'Untitled case');
});

test('normalizeCase bounds sizes and repairs corrupt storage', () => {
  const huge = {
    name: 'x'.repeat(500),
    notes: Array.from({ length: CASE_MAX_NOTES + 5 }, (_, index) => ({
      text: `n${index}`,
    })),
    tags: ['a', 'a', 'b'],
  };
  const normalized = normalizeCase(huge, 7);
  assert.equal(normalized.name.length, 120);
  assert.equal(normalized.notes.length, CASE_MAX_NOTES);
  assert.deepEqual(normalized.tags, ['a', 'b']);
  assert.equal(normalized.createdAt, 7);
  assert.equal(normalizeCase(null), null);
  assert.equal(normalizeCase([]), null);

  const store = createCaseStore({
    storage: memoryStorage({ k: '{broken' }),
    key: 'k',
  });
  assert.equal(store.getState().notes.length, 0);
});

test('caseFilename slugs the case name', () => {
  assert.equal(
    caseFilename({ name: 'Op: Rota / 2026!' }, Date.UTC(2026, 8, 30, 18, 15)),
    'panoptes-case-op-rota-2026-20260930T181500Z.json',
  );
  assert.equal(
    caseFilename({ name: '!!!' }, 0),
    'panoptes-case-case-19700101T000000Z.json',
  );
});

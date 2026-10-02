import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ZONES_STORAGE_KEY,
  installZonePersistence,
  pairAddedMarks,
  sanitizeSavedZones,
} from './zonePersistence.js';

test('only well-formed manual marks are kept', () => {
  assert.deepEqual(
    sanitizeSavedZones([
      { type: 'area', manual: true, ring: [] },
      { type: 'area', manual: false },
      { type: 'label', manual: true },
      null,
    ]).length,
    1,
  );
  assert.deepEqual(sanitizeSavedZones('nope'), []);
});

test('added marks pair with their specs', () => {
  const a = { type: 'area' };
  const b = { type: 'pin' };
  assert.deepEqual(pairAddedMarks([a], ['m1', 'm2']), [
    ['m1', a],
    ['m2', a],
  ]);
  assert.deepEqual(pairAddedMarks([a, b], ['m1', 'm2']), [
    ['m1', a],
    ['m2', b],
  ]);
});

function fakeEngine() {
  const marks = new Map();
  let seq = 0;
  return {
    async annotate(specs) {
      for (const spec of specs) marks.set(`m${++seq}`, { id: `m${seq}`, spec });
      return { drawn: specs.length };
    },
    list: () => [...marks.values()],
    remove(id) {
      return marks.delete(id);
    },
    clear() {
      marks.clear();
    },
  };
}

function fakeWindow(store = new Map()) {
  return {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
    },
    setInterval: (fn) => {
      queueMicrotask(fn);
      return 1;
    },
    clearInterval: () => {},
    store,
  };
}

const tick = () => new Promise((r) => setTimeout(r, 10));

test('manual zones are saved, restored, deleted and cleared', async () => {
  const win = fakeWindow();
  const engine = fakeEngine();
  installZonePersistence({ getEngine: () => engine, windowRef: win });
  await tick();
  await engine.annotate([{ type: 'area', manual: true, ring: [[0, 0]] }]);
  await engine.annotate([{ type: 'area', label: 'voice mark' }]);
  assert.equal(JSON.parse(win.store.get(ZONES_STORAGE_KEY)).length, 1);

  // A new session restores it.
  const engine2 = fakeEngine();
  installZonePersistence({ getEngine: () => engine2, windowRef: win });
  await tick();
  assert.equal(engine2.list().length, 1);
  assert.equal(JSON.parse(win.store.get(ZONES_STORAGE_KEY)).length, 1);

  // Deleting forgets it.
  engine2.remove(engine2.list()[0].id);
  assert.equal(win.store.has(ZONES_STORAGE_KEY), false);

  await engine2.annotate([{ type: 'pin', manual: true }]);
  engine2.clear();
  assert.equal(win.store.has(ZONES_STORAGE_KEY), false);
});

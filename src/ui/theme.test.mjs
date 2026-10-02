import test from 'node:test';
import assert from 'node:assert/strict';
import {
  THEME_STORAGE_KEY,
  bindThemeToggle,
  createThemeController,
} from './theme.js';

function fakeDocument() {
  const attributes = new Map();
  return {
    attributes,
    documentElement: {
      getAttribute: (name) => attributes.get(name) ?? null,
      setAttribute: (name, value) => attributes.set(name, value),
    },
  };
}

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
  };
}

function fakeWindow(lightPreferred) {
  const listeners = new Set();
  return {
    listeners,
    matchMedia: () => ({
      matches: lightPreferred,
      addEventListener: (_type, fn) => listeners.add(fn),
      removeEventListener: (_type, fn) => listeners.delete(fn),
    }),
  };
}

test('the storage key carries the product prefix', () => {
  assert.equal(THEME_STORAGE_KEY, 'panoptes:theme');
});

test('an unset theme follows the system preference and does not persist', () => {
  const document = fakeDocument();
  const storage = fakeStorage();
  const controller = createThemeController({
    document,
    storage,
    windowRef: fakeWindow(true),
  });
  assert.equal(controller.get(), 'light');
  assert.equal(document.attributes.get('data-theme'), 'light');
  assert.equal(controller.isExplicit(), false);
  assert.equal(storage.map.size, 0);
  controller.destroy();
});

test('an explicit choice wins over the system, persists, and toggles', () => {
  const document = fakeDocument();
  const storage = fakeStorage({ [THEME_STORAGE_KEY]: 'dark' });
  const windowRef = fakeWindow(true);
  const controller = createThemeController({ document, storage, windowRef });
  assert.equal(controller.get(), 'dark');
  assert.equal(controller.toggle(), 'light');
  assert.equal(storage.map.get(THEME_STORAGE_KEY), 'light');
  assert.equal(document.attributes.get('data-theme'), 'light');
  // A system change no longer moves an explicit theme.
  for (const fn of windowRef.listeners) fn();
  assert.equal(document.attributes.get('data-theme'), 'light');
  assert.equal(
    controller.set('nonsense'),
    'light',
    'unknown themes are ignored',
  );
  controller.destroy();
});

test('storage failures never break the controller', () => {
  const storage = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };
  const controller = createThemeController({
    document: fakeDocument(),
    storage,
    windowRef: fakeWindow(false),
  });
  assert.equal(controller.get(), 'dark');
  assert.equal(controller.set('light'), 'light');
  controller.destroy();
});

test('the toggle button reflects the active theme and its next action', () => {
  const attributes = new Map();
  const classes = new Set();
  let handler = null;
  const button = {
    textContent: '',
    setAttribute: (name, value) => attributes.set(name, value),
    classList: {
      toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
    },
    addEventListener: (_type, fn) => {
      handler = fn;
    },
    removeEventListener: () => {
      handler = null;
    },
  };
  const controller = createThemeController({
    document: fakeDocument(),
    storage: fakeStorage(),
    windowRef: fakeWindow(false),
  });
  const release = bindThemeToggle(button, controller);
  assert.equal(button.textContent, 'DARK');
  assert.equal(attributes.get('aria-pressed'), 'false');
  assert.match(attributes.get('aria-label'), /light/);
  handler();
  assert.equal(button.textContent, 'LIGHT');
  assert.equal(attributes.get('aria-pressed'), 'true');
  assert.ok(classes.has('active'));
  release();
  assert.equal(handler, null);
  controller.destroy();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LANGUAGE,
  createLookup,
  matchCase,
  normalizeKey,
  normalizeLanguage,
  translateText,
} from './i18nCore.js';

const lookup = createLookup({
  Layers: 'Capas',
  'Camera fix': 'Posición de cámara',
  Location: 'Ubicación',
  'Search sites, layers, places, coordinates...':
    'Buscar sitios, capas, lugares, coordenadas...',
  Loading: 'Cargando',
  Tracking: 'Seguimiento',
});

test('Spanish is the default language', () => {
  assert.equal(DEFAULT_LANGUAGE, 'es');
  assert.equal(normalizeLanguage('EN-gb'), 'en');
  assert.equal(normalizeLanguage('fr'), 'es');
  assert.equal(normalizeLanguage(null), 'es');
});

test('exact and case-insensitive lookups keep the source casing', () => {
  assert.equal(translateText(lookup, 'Layers'), 'Capas');
  assert.equal(translateText(lookup, 'LAYERS'), 'CAPAS');
  assert.equal(translateText(lookup, 'CAMERA FIX'), 'POSICIÓN DE CÁMARA');
  assert.equal(translateText(lookup, 'layers'), 'capas');
});

test('whitespace around and inside the text is tolerated', () => {
  assert.equal(translateText(lookup, '\n   Layers  \n'), '\n   Capas  \n');
  assert.equal(normalizeKey(' a \n  b '), 'a b');
});

test('trailing colon or ellipsis is preserved', () => {
  assert.equal(translateText(lookup, 'Location:'), 'Ubicación:');
  assert.equal(translateText(lookup, 'Loading…'), 'Cargando…');
});

test('compound readouts translate their known parts only', () => {
  assert.equal(
    translateText(lookup, 'TRACKING · IBE3456'),
    'SEGUIMIENTO · IBE3456',
  );
  assert.equal(translateText(lookup, 'Madrid · 51'), null);
});

test('unknown, numeric or empty texts are left alone', () => {
  assert.equal(translateText(lookup, 'Palacio Real'), null);
  assert.equal(translateText(lookup, '40.4168°N'), null);
  assert.equal(translateText(lookup, ''), null);
  assert.equal(translateText(null, 'Layers'), null);
});

test('matchCase follows the source style', () => {
  assert.equal(matchCase('HELLO', 'hola'), 'HOLA');
  assert.equal(matchCase('Hello', 'hola'), 'Hola');
  assert.equal(matchCase('hello', 'Hola'), 'hola');
});

test('numeric readouts reorder into natural Spanish', () => {
  assert.equal(translateText(lookup, '5 min ago'), 'hace 5 min');
  assert.equal(translateText(lookup, '12 MIN AGO'), 'HACE 12 MIN');
  assert.equal(translateText(lookup, '42 cameras'), '42 cámaras');
  assert.equal(translateText(lookup, 'LIVE · 3 h ago'), 'LIVE · hace 3 h');
});

test('key setup chip counts read naturally', () => {
  assert.equal(
    translateText(
      createLookup({ 'POWER UP': 'ACTIVAR' }),
      'POWER UP · 6 KEYS WAITING',
    ),
    'ACTIVAR · 6 CLAVES PENDIENTES',
  );
});

test('route distance readouts translate', () => {
  assert.equal(
    translateText(createLookup({}), 'ALC → ORY · 185 KM LEFT'),
    'ALC → ORY · 185 KM RESTANTES',
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { translateRouteInstruction as t } from './routeInstructionsEs.js';

test('street maneuvers keep the street name', () => {
  assert.equal(t('Head out on Calle de Alcalá'), 'Sal por Calle de Alcalá');
  assert.equal(
    t('Turn slightly left onto Plaza de la Puerta del Sol'),
    'Gira ligeramente a la izquierda por Plaza de la Puerta del Sol',
  );
  assert.equal(t('Turn right'), 'Gira a la derecha');
  assert.equal(
    t('Continue straight onto Gran Vía'),
    'Sigue recto por Gran Vía',
  );
  assert.equal(
    t('Continue onto Paseo del Prado'),
    'Continúa por Paseo del Prado',
  );
  assert.equal(
    t('At the roundabout, take the 2nd exit onto M-30'),
    'En la rotonda, toma la 2.ª salida por M-30',
  );
  assert.equal(
    t('Arrive at your destination, on the right'),
    'Llegas a tu destino, a la derecha',
  );
});

test('flight plan steps and progress fragments', () => {
  assert.equal(
    t('Take off from Madrid and climb'),
    'Despega de Madrid y asciende',
  );
  assert.equal(t('Cruise at FL361'), 'Crucero a FL361');
  assert.equal(t('Land at Barcelona'), 'Aterriza en Barcelona');
  assert.equal(t('4 min left'), 'quedan 4 min');
  assert.equal(t('1.6 km to go'), 'faltan 1.6 km');
});

test('other text is not a route instruction', () => {
  assert.equal(t('Palacio Real'), null);
  assert.equal(t(''), null);
});

test('non-numeric texts ending in left/done are left alone', () => {
  assert.equal(t('Top left'), null);
  assert.equal(t('All done'), null);
});

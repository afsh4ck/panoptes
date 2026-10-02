import test from 'node:test';
import assert from 'node:assert/strict';
import { isDropdownSelect, placeSelectMenu } from './customSelect.js';

const VIEW = { width: 1200, height: 800 };
const rect = (top, height = 30, left = 100, width = 200) => ({
  top,
  bottom: top + height,
  left,
  width,
});

test('the menu opens below when it fits', () => {
  const place = placeSelectMenu(rect(100), 200, VIEW);
  assert.equal(place.side, 'below');
  assert.equal(place.top, 134);
  assert.equal(place.maxHeight, 200);
  assert.equal(place.width, 200);
});

test('near the bottom it opens above and is capped to the room', () => {
  const place = placeSelectMenu(rect(700), 400, VIEW);
  assert.equal(place.side, 'above');
  assert.equal(place.maxHeight, 320);
  assert.equal(place.top, 700 - 4 - 320);
});

test('it never leaves the viewport horizontally', () => {
  const place = placeSelectMenu(rect(100, 30, 1150, 200), 100, VIEW);
  assert.equal(place.left, 1200 - 200 - 8);
});

test('only single-choice drop-downs are replaced', () => {
  const make = (extra = {}) => ({
    tagName: 'SELECT',
    multiple: false,
    size: 0,
    hasAttribute: () => false,
    ...extra,
  });
  assert.equal(isDropdownSelect(make()), true);
  assert.equal(isDropdownSelect(make({ multiple: true })), false);
  assert.equal(isDropdownSelect(make({ size: 5 })), false);
  assert.equal(isDropdownSelect(make({ hasAttribute: () => true })), false);
  assert.equal(isDropdownSelect({ tagName: 'INPUT' }), false);
});

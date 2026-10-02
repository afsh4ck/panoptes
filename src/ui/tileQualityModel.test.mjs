import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TILE_QUALITY,
  DRONE_SCREEN_SPACE_ERROR,
  TILE_QUALITY_LEVELS,
  normalizeTileQuality,
  resolutionScaleFor,
  tilesetSettingsFor,
} from './tileQualityModel.js';

test('levels refine tiles progressively when the view settles', () => {
  assert.equal(tilesetSettingsFor('standard').maximumScreenSpaceError, 16);
  assert.equal(tilesetSettingsFor('high').maximumScreenSpaceError, 8);
  assert.equal(tilesetSettingsFor('ultra').maximumScreenSpaceError, 4);
  assert.equal(tilesetSettingsFor('ultra').dynamicScreenSpaceError, false);
  for (const level of Object.keys(TILE_QUALITY_LEVELS))
    assert.equal(tilesetSettingsFor(level).foveatedScreenSpaceError, true);
});

test('a moving camera loads coarser tiles so the view fills fast', () => {
  for (const level of Object.keys(TILE_QUALITY_LEVELS)) {
    const moving = tilesetSettingsFor(level, { moving: true });
    const settled = tilesetSettingsFor(level);
    assert.ok(moving.maximumScreenSpaceError > settled.maximumScreenSpaceError);
  }
});

test('drone mode keeps at least UHD detail', () => {
  assert.equal(
    tilesetSettingsFor('standard', { drone: true }).maximumScreenSpaceError,
    DRONE_SCREEN_SPACE_ERROR,
  );
  assert.equal(
    tilesetSettingsFor('ultra', { drone: true }).maximumScreenSpaceError,
    4,
  );
  assert.equal(
    tilesetSettingsFor('standard', { drone: true, moving: true })
      .maximumScreenSpaceError,
    DRONE_SCREEN_SPACE_ERROR * 2,
  );
});

test('unknown or missing levels fall back to the default', () => {
  assert.equal(normalizeTileQuality('ULTRA'), 'ultra');
  assert.equal(normalizeTileQuality('potato'), DEFAULT_TILE_QUALITY);
  assert.equal(normalizeTileQuality(null), DEFAULT_TILE_QUALITY);
  assert.ok(TILE_QUALITY_LEVELS[DEFAULT_TILE_QUALITY]);
});

test('native resolution is capped per level', () => {
  assert.equal(resolutionScaleFor('standard', 2), 1);
  assert.equal(resolutionScaleFor('high', 2), 0.75);
  assert.equal(resolutionScaleFor('ultra', 2), 1);
  assert.equal(resolutionScaleFor('ultra', 3), 2 / 3);
  assert.equal(resolutionScaleFor('high', 1), 1);
  assert.equal(resolutionScaleFor('ultra', 0), 1);
});

test('peripheral relaxation never exceeds the maximum error (Cesium rule)', () => {
  for (const level of Object.keys(TILE_QUALITY_LEVELS))
    for (const moving of [false, true])
      for (const drone of [false, true]) {
        const s = tilesetSettingsFor(level, { moving, drone });
        assert.ok(
          s.foveatedMinimumScreenSpaceErrorRelaxation <=
            s.maximumScreenSpaceError,
          `${level} moving=${moving} drone=${drone}`,
        );
      }
});

test('the cockpit streams steadily: whole view, no cancelled requests', () => {
  for (const level of Object.keys(TILE_QUALITY_LEVELS)) {
    const cockpit = tilesetSettingsFor(level, { cockpit: true, moving: true });
    assert.equal(cockpit.cullRequestsWhileMoving, false);
    assert.equal(cockpit.foveatedScreenSpaceError, false);
    assert.equal(cockpit.dynamicScreenSpaceError, true);
    assert.equal(
      cockpit.maximumScreenSpaceError,
      tilesetSettingsFor(level, { cockpit: true }).maximumScreenSpaceError,
    );
    assert.ok(
      cockpit.maximumScreenSpaceError <
        tilesetSettingsFor(level, { moving: true }).maximumScreenSpaceError ||
        level === 'standard',
    );
    assert.equal(tilesetSettingsFor(level).cullRequestsWhileMoving, true);
  }
});

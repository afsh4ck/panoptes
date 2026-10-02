import test from 'node:test';
import assert from 'node:assert/strict';
import { PbfWriter as Pbf } from 'pbf';
import {
  BUILDING_ZOOM,
  DEFAULT_BUILDING_HEIGHT_M,
  buildingColor,
  buildingHeights,
  buildingTilesForView,
  createLruCache,
  decodeBuildingTile,
  lonLatTileFloat,
  shouldAutoEnableBuildings,
} from './records.js';

const zigzag = (n) => (n << 1) ^ (n >> 31);

/** Encode one Mapbox Vector Tile layer named `building` with square polygons. */
function buildingTile(features) {
  const keys = [];
  const values = [];
  const keyIndex = (k) => {
    if (!keys.includes(k)) keys.push(k);
    return keys.indexOf(k);
  };
  const valueIndex = (v) => {
    const i = values.findIndex((x) => x === v);
    if (i >= 0) return i;
    values.push(v);
    return values.length - 1;
  };
  const encoded = features.map((feature) => {
    const tags = [];
    for (const [k, v] of Object.entries(feature.properties)) {
      tags.push(keyIndex(k), valueIndex(v));
    }
    // Closed square ring: MoveTo, LineTo x3, ClosePath (tile coords 0..4096).
    const [x0, y0, size] = feature.square;
    const pts = [
      [x0, y0],
      [x0 + size, y0],
      [x0 + size, y0 + size],
      [x0, y0 + size],
    ];
    const geometry = [(1 & 0x7) | (1 << 3)];
    let cx = 0;
    let cy = 0;
    geometry.push(zigzag(pts[0][0] - cx), zigzag(pts[0][1] - cy));
    [cx, cy] = pts[0];
    geometry.push((2 & 0x7) | (3 << 3));
    for (const [x, y] of pts.slice(1)) {
      geometry.push(zigzag(x - cx), zigzag(y - cy));
      [cx, cy] = [x, y];
    }
    geometry.push((7 & 0x7) | (1 << 3));
    return { id: feature.id, tags, geometry };
  });
  const pbf = new Pbf();
  pbf.writeMessage(3, (_, out) => {
    out.writeVarintField(15, 2);
    out.writeStringField(1, 'building');
    for (const f of encoded)
      out.writeMessage(2, (__, o) => {
        o.writeVarintField(1, f.id);
        o.writePackedVarint(2, f.tags);
        o.writeVarintField(3, 3);
        o.writePackedVarint(4, f.geometry);
      });
    for (const k of keys) out.writeStringField(3, k);
    for (const v of values)
      out.writeMessage(4, (___, o) => {
        if (typeof v === 'string') o.writeStringField(1, v);
        else if (Number.isInteger(v)) o.writeVarintField(5, v);
        else o.writeDoubleField(3, v);
      });
    out.writeVarintField(5, 4096);
  });
  return pbf.finish();
}

test('decodes building footprints with heights from a vector tile', () => {
  const bytes = buildingTile([
    {
      id: 1,
      square: [1000, 1000, 200],
      properties: { render_height: 42, render_min_height: 3 },
    },
    { id: 2, square: [2000, 2000, 100], properties: {} },
    {
      id: 3,
      square: [3000, 3000, 100],
      properties: { render_height: 12, hide_3d: 'true' },
    },
  ]);
  const { tile, buildings } = decodeBuildingTile(bytes, 14, 8023, 6177);
  assert.equal(tile, '14/8023/6177');
  assert.equal(buildings.length, 2);
  assert.equal(buildings[0].height, 42);
  assert.equal(buildings[0].minHeight, 3);
  assert.equal(buildings[0].ring.length, 4);
  assert.equal(buildings[1].height, DEFAULT_BUILDING_HEIGHT_M);
  for (const b of buildings) {
    assert.ok(b.centroid[0] > -3.9 && b.centroid[0] < -3.5);
    assert.ok(b.centroid[1] > 40.3 && b.centroid[1] < 40.6);
  }
});

test('height normalization clamps bad values and keeps roofs above bases', () => {
  assert.deepEqual(
    buildingHeights({ render_height: 30, render_min_height: 40 }),
    {
      minHeight: 29,
      height: 30,
    },
  );
  assert.deepEqual(buildingHeights({ render_height: 'x' }), {
    minHeight: 0,
    height: DEFAULT_BUILDING_HEIGHT_M,
  });
  assert.equal(buildingHeights({ hide_3d: true }), null);
});

test('view tiles are z14, nearest the focus first and capped', () => {
  const madrid = { south: 40.39, west: -3.75, north: 40.44, east: -3.66 };
  const tiles = buildingTilesForView(madrid, { lat: 40.4168, lon: -3.7038 }, 6);
  assert.equal(tiles.length, 6);
  assert.ok(tiles.every((t) => t.z === BUILDING_ZOOM));
  const focus = lonLatTileFloat(-3.7038, 40.4168, BUILDING_ZOOM);
  assert.equal(tiles[0].x, Math.floor(focus.x));
  assert.equal(tiles[0].y, Math.floor(focus.y));
  assert.deepEqual(buildingTilesForView(null, null), []);
});

test('LRU cache evicts the least recently used entry', () => {
  const evicted = [];
  const cache = createLruCache(2, (value, key) => evicted.push(key));
  cache.set('a', 1);
  cache.set('b', 2);
  cache.get('a');
  cache.set('c', 3);
  assert.deepEqual(evicted, ['b']);
  assert.deepEqual(cache.keys(), ['a', 'c']);
  cache.clear();
  assert.deepEqual(evicted, ['b', 'a', 'c']);
});

test('auto-enable only without photoreal, share-link layers or a prior choice', () => {
  const base = {
    photorealAvailable: false,
    shareLinkHasLayers: false,
    alreadyAutoEnabled: false,
    alreadyEnabled: false,
  };
  assert.equal(shouldAutoEnableBuildings(base), true);
  assert.equal(
    shouldAutoEnableBuildings({ ...base, photorealAvailable: true }),
    false,
  );
  assert.equal(
    shouldAutoEnableBuildings({ ...base, shareLinkHasLayers: true }),
    false,
  );
  assert.equal(
    shouldAutoEnableBuildings({ ...base, alreadyAutoEnabled: true }),
    false,
  );
  assert.equal(
    shouldAutoEnableBuildings({ ...base, alreadyEnabled: true }),
    false,
  );
});

test('colours lighten with height and warm for towers', () => {
  const low = buildingColor(5);
  const tall = buildingColor(70);
  const tower = buildingColor(200);
  assert.ok(tall[2] > low[2]);
  assert.ok(tower[0] > tower[2]);
});

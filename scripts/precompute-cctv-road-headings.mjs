#!/usr/bin/env node
/**
 * Precompute road-aligned bearings for the highway camera packs whose feeds
 * publish no facing: DGT (Spain), the Servei Català de Trànsit and Open Data
 * Euskadi.
 *
 *   node scripts/precompute-cctv-road-headings.mjs [--out <file>] [--tile-cache <dir>]
 *
 * Loads the packs live, reads OpenStreetMap road geometry from OpenFreeMap
 * vector tiles (z14, keyless) around each camera and writes
 * src/data/local_data/cctv_road_headings/cctv_road_headings.json, which the
 * catalog joins when it serves the cameras (server/providers/cctv/roadHeadings.js).
 * The decision rules live in src/data/cctvRoadHeadings.js.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { PbfReader } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import {
  loadCataloniaSourcesFromSct,
  loadDgtSourcesFromNap,
  loadEuskadiSourcesFromOpenData,
} from '../server/providers/cctv/packs.js';
import { PANOPTES_CCTV_USER_AGENT } from '../server/providers/cctv/constants.js';
import { DEFAULT_ROAD_HEADINGS_FILE } from '../server/providers/cctv/roadHeadings.js';
import {
  bearingDeg,
  distanceM,
  kmUpBearing,
  nearestRoadAxis,
  normalizeRoadRef,
  resolveRoadHeading,
} from '../src/data/cctvRoadHeadings.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
const ZOOM = 14;
const CONCURRENCY = 6;
/** Tiles within this distance of a camera are read, so a road just over a tile edge counts. */
const EDGE_M = 160;
/** A named destination this far away only gives a direction, not a place. */
const FAR_DESTINATION_M = 30_000;
/**
 * Large cities DGT names as a camera's destination ("→ Madrid"), to catch a
 * feed whose travel direction contradicts it. City-centre coordinates.
 */
const DESTINATIONS = Object.freeze({
  MADRID: [40.4168, -3.7038],
  BARCELONA: [41.3874, 2.1686],
  VALENCIA: [39.4699, -0.3763],
  SEVILLA: [37.3891, -5.9845],
  ZARAGOZA: [41.6488, -0.8891],
  MALAGA: [36.7213, -4.4214],
  MURCIA: [37.9922, -1.1307],
  BILBAO: [43.263, -2.935],
  ALICANTE: [38.3452, -0.481],
  CORDOBA: [37.8882, -4.7794],
  VALLADOLID: [41.6523, -4.7245],
  VIGO: [42.2406, -8.7207],
  'A CORUNA': [43.3623, -8.4115],
  GRANADA: [37.1773, -3.5986],
  OVIEDO: [43.3614, -5.8593],
  SANTANDER: [43.4623, -3.81],
  BURGOS: [42.3439, -3.6969],
  LEON: [42.5987, -5.5671],
  SALAMANCA: [40.9701, -5.6635],
  BADAJOZ: [38.8794, -6.9707],
  CADIZ: [36.5271, -6.2886],
  TOLEDO: [39.8628, -4.0273],
  ALBACETE: [38.9943, -1.8585],
  LUGO: [43.0097, -7.556],
  HUELVA: [37.2614, -6.9447],
  ALMERIA: [36.834, -2.4637],
  CASTELLON: [39.9864, -0.0513],
  TARRAGONA: [41.1189, 1.2445],
  LOGRONO: [42.4627, -2.445],
  PAMPLONA: [42.8125, -1.6458],
});
const plainName = (text) =>
  String(text || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .trim();

/** Bearing to the camera's named destination, when it is a known city far away. */
function destinationBearing(camera) {
  const city = DESTINATIONS[plainName(camera.towards)];
  if (!city) return NaN;
  const there = { lat: city[0], lon: city[1] };
  return distanceM(camera, there) >= FAR_DESTINATION_M
    ? bearingDeg(camera, there)
    : NaN;
}

const argValue = (name) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
};

function tileOf(lat, lon, z = ZOOM) {
  const n = 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  return [
    Math.floor(((lon + 180) / 360) * n),
    Math.floor(
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
        n,
    ),
  ];
}

/** z14 tiles within EDGE_M of a camera, as "x/y" keys. */
function tilesAround({ lat, lon }) {
  const dLat = EDGE_M / 111_320;
  const dLon = EDGE_M / (111_320 * Math.cos((lat * Math.PI) / 180));
  const keys = new Set();
  for (const [a, b] of [
    [lat - dLat, lon - dLon],
    [lat - dLat, lon + dLon],
    [lat + dLat, lon - dLon],
    [lat + dLat, lon + dLon],
  ]) {
    keys.add(tileOf(a, b).join('/'));
  }
  return [...keys];
}

/** Road lines of one tile: numbered roads (`transportation_name`) and classed ways. */
function decodeRoadLines(bytes, x, y) {
  const data =
    bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
  const tile = new VectorTile(new PbfReader(data));
  const lines = [];
  for (const name of ['transportation_name', 'transportation']) {
    const layer = tile.layers[name];
    if (!layer) continue;
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i);
      const { geometry } = feature.toGeoJSON(x, y, ZOOM);
      const parts =
        geometry.type === 'LineString'
          ? [geometry.coordinates]
          : geometry.type === 'MultiLineString'
            ? geometry.coordinates
            : [];
      for (const coordinates of parts) {
        lines.push({
          coordinates,
          ref: String(feature.properties.ref || ''),
          class: String(feature.properties.class || ''),
        });
      }
    }
  }
  return lines;
}

/** Tile bytes, read from `--tile-cache <dir>` when present there. */
async function tileBytes(url, key, cacheDir) {
  const file = cacheDir && path.join(cacheDir, `${ZOOM}-${key.replace('/', '-')}.pbf`);
  if (file) {
    try {
      return new Uint8Array(await readFile(file));
    } catch {
      // Not cached yet.
    }
  }
  const bytes = await fetchBytes(url);
  if (file && bytes) {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(file, bytes);
  }
  return bytes;
}

async function fetchBytes(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': PANOPTES_CCTV_USER_AGENT },
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status === 204 || response.status === 404) return null;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (attempt >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}

async function main() {
  const out = path.resolve(ROOT, argValue('--out') || DEFAULT_ROAD_HEADINGS_FILE);
  const tileCache = argValue('--tile-cache');
  const packs = await Promise.all([
    loadDgtSourcesFromNap(),
    loadCataloniaSourcesFromSct(),
    loadEuskadiSourcesFromOpenData(),
  ]);
  const cameras = packs.flat().filter((camera) => normalizeRoadRef(camera.road));
  const byRoad = new Map();
  for (const camera of cameras) {
    const key = normalizeRoadRef(camera.road);
    if (!byRoad.has(key)) byRoad.set(key, []);
    byRoad.get(key).push(camera);
  }

  const tileJson = await (
    await fetch(TILEJSON_URL, {
      headers: { 'User-Agent': PANOPTES_CCTV_USER_AGENT },
    })
  ).json();
  const template = tileJson?.tiles?.[0];
  if (!template?.startsWith('https://tiles.openfreemap.org/')) {
    throw new Error('Unexpected OpenFreeMap TileJSON');
  }

  const wanted = [...new Set(cameras.flatMap(tilesAround))];
  const lines = new Map();
  let cursor = 0;
  let failed = 0;
  async function worker() {
    while (cursor < wanted.length) {
      const key = wanted[cursor++];
      const [x, y] = key.split('/').map(Number);
      const url = template
        .replace('{z}', ZOOM)
        .replace('{x}', x)
        .replace('{y}', y);
      try {
        const bytes = await tileBytes(url, key, tileCache);
        lines.set(key, bytes ? decodeRoadLines(bytes, x, y) : []);
      } catch (error) {
        failed += 1;
        console.warn(`[road-headings] tile ${key}: ${error.message}`);
      }
      if (lines.size % 200 === 0) {
        console.log(`[road-headings] ${lines.size}/${wanted.length} tiles`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const entries = {};
  const counts = { medium: 0, low: 0, unmatched: 0 };
  for (const camera of cameras) {
    const roadLines = tilesAround(camera).flatMap((key) => lines.get(key) || []);
    const axis = nearestRoadAxis(camera, roadLines, camera.road);
    if (!axis) {
      counts.unmatched += 1;
      continue;
    }
    const heading = resolveRoadHeading({
      axisDeg: axis.axisDeg,
      kmUpDeg: kmUpBearing(camera, byRoad.get(normalizeRoadRef(camera.road))),
      travelDirection: camera.travelDirection,
      destinationDeg: destinationBearing(camera),
    });
    counts[heading.confidence] += 1;
    entries[camera.id] = {
      headingDeg: Math.round(heading.headingDeg * 10) / 10,
      confidence: heading.confidence,
      lat: camera.lat,
      lon: camera.lon,
      road: camera.road,
      matchedRef: axis.matchedRef,
    };
  }

  const sorted = Object.fromEntries(
    Object.keys(entries)
      .sort()
      .map((id) => [id, entries[id]]),
  );
  await mkdir(path.dirname(out), { recursive: true });
  const temp = `${out}.tmp`;
  await writeFile(
    temp,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        geometry: 'OpenStreetMap via OpenFreeMap vector tiles, z14',
        cameras: sorted,
      },
      null,
      1,
    )}\n`,
  );
  await rename(temp, out);
  console.log(
    `[road-headings] ${cameras.length} road cameras: ${counts.medium} medium, ${counts.low} low, ${counts.unmatched} without a road nearby; ${wanted.length} tiles (${failed} failed) → ${path.relative(ROOT, out)}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

/**
 * Pure export helpers: turn enabled layers' analyst records into GeoJSON,
 * CSV and KML text. No DOM; the download lives in ./download.js.
 */

/** Default per-layer record cap for an export. */
export const EXPORT_MAX_PER_LAYER = 5000;

const finite = (value) => {
  const number = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(number) ? number : null;
};

/**
 * Read a record's position from any of the field spellings the layers use.
 * @param {object} record
 * @returns {{lat: number, lon: number}|null}
 */
export function recordPosition(record) {
  if (!record || typeof record !== 'object') return null;
  const lat = finite(record.lat ?? record.latitude ?? record.latitudeDeg);
  const lon = finite(
    record.lon ?? record.lng ?? record.longitude ?? record.longitudeDeg,
  );
  if (lat === null || lon === null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

/** Keep JSON-safe scalars only; nested objects flatten to their JSON text. */
function scalarize(value) {
  if (value === null || value === undefined) return null;
  if (['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (Array.isArray(value))
    return value.map((entry) => scalarize(entry)).join('; ');
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Collect records from the enabled layers that expose analyst records.
 * @param {{layers: Array<{id: string, name?: string, enabled?: boolean, source?: string, getAnalystRecords?: Function}>, maxPerLayer?: number}} options
 * @returns {Array<{layerId: string, name: string, source: string, records: object[]}>}
 */
export function collectLayerRecords({
  layers = [],
  maxPerLayer = EXPORT_MAX_PER_LAYER,
} = {}) {
  const collections = [];
  for (const layer of layers) {
    if (!layer?.id || layer.enabled === false) continue;
    if (typeof layer.getAnalystRecords !== 'function') continue;
    let records;
    try {
      records = layer.getAnalystRecords(maxPerLayer);
    } catch {
      records = [];
    }
    if (!Array.isArray(records) || !records.length) continue;
    collections.push({
      layerId: layer.id,
      name: String(layer.name || layer.id),
      source: String(layer.source || ''),
      records: records.slice(0, maxPerLayer),
    });
  }
  return collections;
}

/**
 * GeoJSON FeatureCollection of every positioned record, tagged with its layer.
 * @param {ReturnType<typeof collectLayerRecords>} collections
 * @param {{generatedAt?: Date|string|number}} [options]
 * @returns {object} Parsed GeoJSON (stringify to save).
 */
export function toGeoJson(collections, { generatedAt = Date.now() } = {}) {
  const features = [];
  for (const collection of collections) {
    for (const record of collection.records) {
      const position = recordPosition(record);
      if (!position) continue;
      const properties = {
        layer: collection.layerId,
        layerName: collection.name,
      };
      for (const [key, value] of Object.entries(record)) {
        if (['lat', 'lon', 'lng', 'latitude', 'longitude'].includes(key))
          continue;
        properties[key] = scalarize(value);
      }
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [position.lon, position.lat] },
        properties,
      });
    }
  }
  return {
    type: 'FeatureCollection',
    generatedAt: new Date(generatedAt).toISOString(),
    features,
  };
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * RFC 4180 CSV over the union of record keys. Layer id and name lead the
 * columns when the rows come from collections.
 * @param {object[]|ReturnType<typeof collectLayerRecords>} rows Records, or collections.
 * @returns {string}
 */
export function toCsv(rows) {
  const records = [];
  for (const row of rows) {
    if (row && Array.isArray(row.records)) {
      for (const record of row.records)
        records.push({ layer: row.layerId, layerName: row.name, ...record });
    } else if (row && typeof row === 'object') records.push(row);
  }
  if (!records.length) return '';
  const keys = [];
  const seen = new Set();
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  const lines = [keys.map(csvCell).join(',')];
  for (const record of records)
    lines.push(keys.map((key) => csvCell(scalarize(record[key]))).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

const xml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * KML with one Folder per layer and a Placemark per positioned record.
 * @param {ReturnType<typeof collectLayerRecords>} collections
 * @param {{name?: string}} [options]
 * @returns {string}
 */
export function toKml(collections, { name = 'Layer export' } = {}) {
  const folders = collections.map((collection) => {
    const placemarks = collection.records
      .map((record) => {
        const position = recordPosition(record);
        if (!position) return '';
        const title =
          record.name || record.label || record.id || collection.name;
        const data = Object.entries(record)
          .filter(([, value]) => value !== null && value !== undefined)
          .map(
            ([key, value]) =>
              `<Data name="${xml(key)}"><value>${xml(scalarize(value))}</value></Data>`,
          )
          .join('');
        return `<Placemark><name>${xml(title)}</name><ExtendedData>${data}</ExtendedData><Point><coordinates>${position.lon},${position.lat},0</coordinates></Point></Placemark>`;
      })
      .filter(Boolean)
      .join('');
    return `<Folder><name>${xml(collection.name)}</name>${placemarks}</Folder>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(name)}</name>${folders.join('')}</Document></kml>\n`;
}

/** Count of records that would become features (have a position). */
export function countPositioned(collections) {
  let count = 0;
  for (const collection of collections)
    for (const record of collection.records)
      if (recordPosition(record)) count += 1;
  return count;
}

/** File name for an export of the given format. */
export function exportFilename(format, timestamp) {
  const extension = { geojson: 'geojson', csv: 'csv', kml: 'kml' }[format];
  if (!extension) throw new Error(`Unknown export format: ${format}`);
  return `panoptes-layers-${timestamp}.${extension}`;
}

/** Render collections into the requested format's text. */
export function renderExport(format, collections, options = {}) {
  if (format === 'geojson')
    return {
      text: JSON.stringify(toGeoJson(collections, options)),
      mime: 'application/geo+json',
    };
  if (format === 'csv') return { text: toCsv(collections), mime: 'text/csv' };
  if (format === 'kml')
    return {
      text: toKml(collections, options),
      mime: 'application/vnd.google-earth.kml+xml',
    };
  throw new Error(`Unknown export format: ${format}`);
}

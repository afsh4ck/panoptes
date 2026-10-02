import { validCoordinate } from './cachedRoute.js';

/**
 * NASA EONET v3 GeoJSON normalizer. The GeoJSON endpoint emits one feature
 * per event GEOMETRY (a storm track yields many), so features are folded to
 * the latest position per event id.
 */
export const EONET_GEOJSON_URL =
  'https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&days=30';

const CATEGORY_TO_TYPE = Object.freeze({
  wildfires: 'wildfire',
  severeStorms: 'storm',
  volcanoes: 'volcano',
  floods: 'flood',
  landslides: 'landslide',
  earthquakes: 'EQ',
  drought: 'DR',
  seaLakeIce: 'other',
  dustHaze: 'other',
  manmade: 'other',
  waterColor: 'other',
  temperatureExtremes: 'other',
  snow: 'other',
});

function pointOf(geometry) {
  if (!geometry || typeof geometry !== 'object') return null;
  if (geometry.type === 'Point') {
    const [lon, lat] = geometry.coordinates || [];
    return validCoordinate(lat, lon) ? { lat, lon } : null;
  }
  if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates?.[0])) {
    const ring = geometry.coordinates[0];
    let lat = 0;
    let lon = 0;
    let count = 0;
    for (const position of ring) {
      if (
        !Array.isArray(position) ||
        !validCoordinate(position[1], position[0])
      )
        return null;
      lon += position[0];
      lat += position[1];
      count += 1;
    }
    return count ? { lat: lat / count, lon: lon / count } : null;
  }
  return null;
}

/** Fold EONET GeoJSON features into disaster rows (latest geometry per event). */
export function normalizeEonetGeojson(geojson) {
  const byId = new Map();
  const features = Array.isArray(geojson?.features) ? geojson.features : [];
  for (const feature of features) {
    const properties = feature?.properties;
    if (!properties || typeof properties !== 'object') continue;
    const id = String(properties.id || '').trim();
    if (!id) continue;
    const point = pointOf(feature.geometry);
    if (!point) continue;
    const dateMs = Date.parse(String(properties.date || ''));
    const previous = byId.get(id);
    if (
      previous &&
      Number.isFinite(previous.dateMs) &&
      previous.dateMs >= dateMs
    )
      continue;
    const category = Array.isArray(properties.categories)
      ? properties.categories[0]
      : null;
    const categoryId = String(category?.id || '');
    const magnitudeValue = Number(properties.magnitudeValue);
    const magnitudeUnit = String(properties.magnitudeUnit || '').trim();
    const source = Array.isArray(properties.sources)
      ? properties.sources.find((entry) =>
          /^https?:\/\//.test(entry?.url || ''),
        )
      : null;
    byId.set(id, {
      dateMs,
      row: {
        id: `eonet:${id}`,
        lat: point.lat,
        lon: point.lon,
        source: 'EONET',
        type: CATEGORY_TO_TYPE[categoryId] || 'other',
        title: String(properties.title || '').trim(),
        description: String(category?.title || '').trim(),
        level: 'info',
        score: 0,
        severity: {
          value: Number.isFinite(magnitudeValue) ? magnitudeValue : null,
          unit: magnitudeUnit,
          text: Number.isFinite(magnitudeValue)
            ? `${magnitudeValue} ${magnitudeUnit}`.trim()
            : '',
        },
        population: { value: null, unit: '', text: '' },
        country: '',
        iso3: '',
        link:
          source?.url || previous?.row?.link || String(properties.link || ''),
        from: Number.isFinite(dateMs) ? new Date(dateMs).toISOString() : null,
        to: null,
        updated: Number.isFinite(dateMs)
          ? new Date(dateMs).toISOString()
          : null,
        bbox: null,
        episode: 0,
        current: !properties.closed,
      },
    });
  }
  return [...byId.values()].map((entry) => entry.row);
}

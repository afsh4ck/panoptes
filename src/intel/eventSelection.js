/**
 * @module eventSelection
 * @description Event markers — earthquakes, disaster alerts, conflict events,
 * cyclones and GPS-interference cells — have no click handling of their own.
 * The console reads a picked entity through `eventContextFor` and publishes it
 * as a selection, so the INTEL panel opens its event dossier
 * (src/intel/eventIntel.js). Pure: the caller supplies the entity's id, its
 * plain properties and its position.
 */

/** Entity id prefix → the layer that owns the marker. */
export const EVENT_LAYERS = Object.freeze({
  earthquake: Object.freeze({
    layerId: 'earthquakes',
    layerName: 'Earthquakes (24h)',
    source: 'USGS',
  }),
  disaster: Object.freeze({
    layerId: 'disaster-alerts',
    layerName: 'Disaster Alerts',
    source: 'GDACS · NASA EONET',
  }),
  conflict: Object.freeze({
    layerId: 'conflict-events',
    layerName: 'Conflict Events',
    source: 'GDELT · UCDP · ACLED',
  }),
  cyclone: Object.freeze({
    layerId: 'weather-cyclones',
    layerName: 'Cyclone advisories',
    source: 'NOAA NHC / CPHC',
  }),
  'gps-interference': Object.freeze({
    layerId: 'gps-interference',
    layerName: 'GPS Interference',
    source: 'adsb.lol · ADS-B integrity',
  }),
});

/** The event layer an entity id belongs to, or null. */
export function eventLayerFor(entityId) {
  const prefix = String(entityId || '').split(':')[0];
  return Object.hasOwn(EVENT_LAYERS, prefix) ? EVENT_LAYERS[prefix] : null;
}

/** A cyclone's track and cone pieces select the storm's centre marker. */
export function eventSelectionId(entityId) {
  const id = String(entityId || '');
  if (!id.startsWith('cyclone:')) return id;
  const storm = id.split(':')[1];
  return storm ? `cyclone:${storm}:center` : id;
}

function eventLabel(layerId, props, name) {
  switch (layerId) {
    case 'earthquakes': {
      const mag = Number(props.mag);
      return (
        [
          Number.isFinite(mag) ? `M${mag.toFixed(1)}` : 'Earthquake',
          props.place,
        ]
          .filter(Boolean)
          .join(' · ') || 'Earthquake'
      );
    }
    case 'disaster-alerts':
      return String(props.title || 'Disaster alert');
    case 'conflict-events':
      return String(props.title || props.kind || 'Conflict event');
    case 'weather-cyclones':
      return (
        [props.classification, props.name || name].filter(Boolean).join(' ') ||
        'Tropical cyclone'
      );
    case 'gps-interference':
      return 'GPS interference';
    default:
      return String(name || 'Event');
  }
}

/**
 * Selection record (context-store shape) for a picked event marker, or null
 * when the entity is not an event marker or has no position.
 *
 * @param {{id: string, name?: string, properties?: object,
 *   position?: {lat: number, lon: number}|null}} picked
 * @returns {object|null}
 */
export function eventContextFor({ id, name, properties, position } = {}) {
  const layer = eventLayerFor(id);
  if (
    !layer ||
    !Number.isFinite(position?.lat) ||
    !Number.isFinite(position?.lon)
  )
    return null;
  const props =
    properties && typeof properties === 'object' ? { ...properties } : {};
  return {
    id: eventSelectionId(id),
    layerId: layer.layerId,
    layerName: layer.layerName,
    source: layer.source,
    label: eventLabel(layer.layerId, props, name),
    latitude: position.lat,
    longitude: position.lon,
    properties: props,
  };
}

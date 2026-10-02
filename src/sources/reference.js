import { createUsgsEarthquakeSource } from '../layers/earthquakes/source.js';
import { createWfigsPerimeterSource } from '../layers/perimeters/source.js';
import { createBundledCableSource } from '../layers/submarineCables/bundledSource.js';
import { createEmergencySquawkSource } from '../layers/airEmergencies/source.js';
import { createGpsInterferenceSource } from '../layers/gpsInterference/source.js';
import { createConflictSource } from '../layers/conflicts/source.js';
import { createDisasterSource } from '../layers/disasters/source.js';
import { createRadiationSource } from '../layers/radiation/source.js';
import { createOpenFreeMapBuildingsSource } from '../layers/buildings3d/source.js';

/** Construct the existing reference feeds independently of application setup. */
export function createReferenceSources() {
  return {
    earthquakes: createUsgsEarthquakeSource(),
    'fire-perimeters': createWfigsPerimeterSource(),
    cables: createBundledCableSource(),
    'air-emergencies': createEmergencySquawkSource(),
    'gps-interference': createGpsInterferenceSource(),
    conflicts: createConflictSource(),
    disasters: createDisasterSource(),
    radiation: createRadiationSource(),
    buildings3d: createOpenFreeMapBuildingsSource(),
  };
}

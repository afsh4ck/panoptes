/**
 * Hand-authored maritime chokepoints (strategic straits, canals and gaps).
 *
 * Coordinates mark the narrowest / most-referenced point of each passage and
 * are accurate to roughly 10 km — enough for a globe-scale marker.
 *
 * Output: src/data/local_data/chokepoints/chokepoints.geojsonl
 */
import path from 'node:path';
import {
  datasetDir,
  runDataset,
  writeGeojsonl,
  writeManifest,
} from './lib.mjs';

export const CHOKEPOINTS = [
  [
    'hormuz',
    'Strait of Hormuz',
    56.25,
    26.57,
    'Persian Gulf ↔ Gulf of Oman',
    'Roughly a fifth of global oil trade transits here',
    'IR/OM',
  ],
  [
    'malacca',
    'Strait of Malacca',
    101.3,
    2.5,
    'Indian Ocean ↔ South China Sea',
    'Busiest shipping lane between the Middle East and East Asia',
    'MY/ID/SG',
  ],
  [
    'bab-el-mandeb',
    'Bab-el-Mandeb',
    43.33,
    12.58,
    'Red Sea ↔ Gulf of Aden',
    'Gateway to the Suez route; exposed to Yemen-based attacks',
    'YE/DJ/ER',
  ],
  [
    'suez',
    'Suez Canal',
    32.35,
    30.45,
    'Mediterranean ↔ Red Sea',
    'Shortest Europe–Asia sea route; single blockage halts ~12% of trade',
    'EG',
  ],
  [
    'panama',
    'Panama Canal',
    -79.68,
    9.08,
    'Atlantic ↔ Pacific',
    'Locks constrain draft; drought limits daily transits',
    'PA',
  ],
  [
    'bosporus',
    'Bosporus',
    29.07,
    41.12,
    'Black Sea ↔ Sea of Marmara',
    'Only sea outlet for Black Sea states; Montreux regime',
    'TR',
  ],
  [
    'dardanelles',
    'Dardanelles',
    26.4,
    40.2,
    'Sea of Marmara ↔ Aegean',
    'Second Turkish strait on the Black Sea exit',
    'TR',
  ],
  [
    'gibraltar',
    'Strait of Gibraltar',
    -5.6,
    35.95,
    'Atlantic ↔ Mediterranean',
    'Sole western entrance to the Mediterranean',
    'ES/MA/GI',
  ],
  [
    'taiwan',
    'Taiwan Strait',
    119.5,
    24.5,
    'South China Sea ↔ East China Sea',
    'Principal flashpoint between China and Taiwan',
    'TW/CN',
  ],
  [
    'oresund',
    'Øresund',
    12.75,
    55.85,
    'Baltic ↔ Kattegat',
    'One of the Danish straits controlling Baltic access',
    'DK/SE',
  ],
  [
    'great-belt',
    'Great Belt',
    10.95,
    55.35,
    'Baltic ↔ Kattegat',
    'Deep-water Danish strait used by large Baltic traffic',
    'DK',
  ],
  [
    'lombok',
    'Lombok Strait',
    115.75,
    -8.6,
    'Indian Ocean ↔ Java Sea',
    'Deep-draft alternative to Malacca for supertankers and submarines',
    'ID',
  ],
  [
    'sunda',
    'Sunda Strait',
    105.85,
    -5.95,
    'Indian Ocean ↔ Java Sea',
    'Secondary Indonesian passage between Java and Sumatra',
    'ID',
  ],
  [
    'good-hope',
    'Cape of Good Hope',
    18.47,
    -34.36,
    'Atlantic ↔ Indian Ocean',
    'Fallback route whenever Suez or Bab-el-Mandeb is contested',
    'ZA',
  ],
  [
    'giuk-denmark',
    'GIUK gap · Denmark Strait',
    -27.0,
    66.5,
    'Greenland ↔ Iceland',
    'North Atlantic submarine transit corridor',
    'GL/IS',
  ],
  [
    'giuk-iceland-faroe',
    'GIUK gap · Iceland–Faroe',
    -10.0,
    63.0,
    'Iceland ↔ Faroe Islands',
    'Central segment of the NATO anti-submarine line',
    'IS/FO',
  ],
  [
    'giuk-faroe-shetland',
    'GIUK gap · Faroe–Shetland',
    -3.0,
    61.0,
    'Faroe Islands ↔ Shetland',
    'Eastern segment of the GIUK line',
    'FO/GB',
  ],
  [
    'dover',
    'Strait of Dover',
    1.48,
    51.02,
    'English Channel ↔ North Sea',
    "World's busiest strait by vessel count",
    'GB/FR',
  ],
  [
    'kerch',
    'Kerch Strait',
    36.55,
    45.3,
    'Black Sea ↔ Sea of Azov',
    'Bridge and blockade point in the Russia–Ukraine war',
    'UA/RU',
  ],
  [
    'korea',
    'Korea (Tsushima) Strait',
    129.4,
    34.3,
    'East China Sea ↔ Sea of Japan',
    'Passage between Japan and Korea watched by three navies',
    'JP/KR',
  ],
  [
    'luzon',
    'Luzon Strait (Bashi Channel)',
    121.0,
    21.0,
    'South China Sea ↔ Philippine Sea',
    'Submarine cable corridor and first-island-chain gap',
    'PH/TW',
  ],
  [
    'bering',
    'Bering Strait',
    -169.0,
    65.75,
    'Bering Sea ↔ Chukchi Sea',
    'Only Pacific gateway to the Arctic',
    'US/RU',
  ],
  [
    'mozambique',
    'Mozambique Channel',
    41.5,
    -18.0,
    'Indian Ocean (Africa ↔ Madagascar)',
    'Cape-route tanker lane and LNG corridor',
    'MZ/MG',
  ],
  [
    'sicily',
    'Strait of Sicily',
    11.8,
    37.0,
    'Western ↔ Eastern Mediterranean',
    'Divides the Mediterranean basins; migration and naval lane',
    'IT/TN',
  ],
  [
    'torres',
    'Torres Strait',
    142.3,
    -10.2,
    'Coral Sea ↔ Arafura Sea',
    'Shallow reef passage north of Australia',
    'AU/PG',
  ],
  [
    'windward',
    'Windward Passage',
    -73.8,
    20.0,
    'Atlantic ↔ Caribbean',
    'Deep passage between Cuba and Hispaniola toward Panama',
    'CU/HT',
  ],
  [
    'yucatan',
    'Yucatán Channel',
    -85.8,
    21.7,
    'Caribbean ↔ Gulf of Mexico',
    'Gulf of Mexico entrance for Caribbean traffic',
    'MX/CU',
  ],
  [
    'lancaster',
    'Northwest Passage · Lancaster Sound',
    -84.0,
    74.2,
    'Baffin Bay ↔ Canadian Arctic Archipelago',
    'Eastern entrance of the Northwest Passage',
    'CA',
  ],
  [
    'vilkitsky',
    'Northern Sea Route · Vilkitsky Strait',
    103.5,
    77.9,
    'Kara Sea ↔ Laptev Sea',
    'Ice-bound choke on the Russian Arctic route',
    'RU',
  ],
];

export function chokepointFeatures() {
  return CHOKEPOINTS.map(([slug, name, lon, lat, connects, why, country]) => ({
    id: `chokepoint:${slug}`,
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: {
      name,
      class: 'chokepoint',
      subtitle: connects,
      detail: why,
      country,
      source: 'hand-authored',
      tags: { connects, significance: why },
    },
  }));
}

export async function buildChokepoints({ dryRun } = {}) {
  const features = chokepointFeatures();
  const dir = datasetDir('chokepoints');
  if (dryRun) return { count: features.length, dryRun: true };
  const out = await writeGeojsonl(
    path.join(dir, 'chokepoints.geojsonl'),
    features,
  );
  await writeManifest(
    dir,
    {
      dataset: 'chokepoints',
      file: 'chokepoints.geojsonl',
      source: 'hand-authored (PANOPTES maintainers)',
      license: 'MIT (part of this repository)',
      count: out.count,
      bytes: out.bytes,
      sha256: out.sha256,
      classes: out.classes,
    },
    `# Maritime chokepoints

Hand-authored reference points for the PANOPTES "Chokepoints" layer: the
straits, canals and gaps that concentrate global shipping and naval movement.

- Source: authored in \`scripts/etl/chokepoints.mjs\` (coordinates accurate to ~10 km)
- License: MIT, as part of this repository
- Feature count: ${out.count}
- Runtime file: \`chokepoints.geojsonl\`
- Regenerate: \`node scripts/etl/chokepoints.mjs\`

Each feature carries \`subtitle\` (what the passage connects) and \`detail\`
(why it matters). Edit the table in the script and re-run to change entries.`,
  );
  return { count: out.count, bytes: out.bytes };
}

if (process.argv[1]?.endsWith('chokepoints.mjs')) {
  runDataset('chokepoints', (args) =>
    buildChokepoints({ dryRun: args.dryRun }),
  );
}

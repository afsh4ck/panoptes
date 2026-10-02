/**
 * Aircraft type reference keyed by ICAO type designator (Doc 8643).
 *
 * Primary: ICAO Doc 8643 type list as republished by the OpenSky Network
 * (manufacturer, model, engine count/type, wake category, airframe kind).
 * Dimensions/weights: a hand-checked table of common types from manufacturer
 * published specifications. The FAA Aircraft Characteristics Database is the
 * preferred dimension source, but its page offers no machine-readable download
 * to scripted clients (HTTP 403 / no file link at time of writing).
 *
 * Output: src/data/local_data/aircraft_types/aircraft_types.json
 */
import path from 'node:path';
import {
  clean,
  csvObjects,
  datasetDir,
  fetchText,
  runDataset,
  writeJson,
  writeManifest,
} from './lib.mjs';

export const DOC8643_URL =
  'https://s3.opensky-network.org/data-samples/metadata/doc8643AircraftTypes.csv';

const ENGINE_TYPE = {
  jet: 'jet',
  turboprop: 'turboprop',
  'turboprop/turboshaft': 'turboprop',
  turboshaft: 'turboshaft',
  piston: 'piston',
  electric: 'electric',
  rocket: 'rocket',
};

const AIRFRAME = {
  L: 'landplane',
  S: 'seaplane',
  A: 'amphibian',
  H: 'helicopter',
  G: 'gyrocopter',
  T: 'tiltrotor',
};

/**
 * [designator, wingspan m, length m, height m, MTOW kg, cruise kt, range km,
 *  service ceiling m, typical seats/crew note]
 * Published manufacturer figures for the baseline variant; rounded.
 */
export const DIMENSIONS = [
  ['A319', 35.8, 33.84, 11.76, 75500, 450, 6950, 12130, '124–156 seats'],
  ['A320', 35.8, 37.57, 11.76, 78000, 450, 6150, 12130, '150–180 seats'],
  ['A321', 35.8, 44.51, 11.76, 93500, 450, 5950, 12130, '185–220 seats'],
  ['A19N', 35.8, 33.84, 11.76, 75500, 450, 6850, 12130, '124–156 seats'],
  ['A20N', 35.8, 37.57, 11.76, 79000, 450, 6300, 12130, '150–194 seats'],
  ['A21N', 35.8, 44.51, 11.76, 97000, 450, 7400, 12130, '180–244 seats'],
  ['A332', 60.3, 58.82, 17.39, 251000, 470, 13450, 12500, '246–300 seats'],
  ['A333', 60.3, 63.66, 16.79, 251000, 470, 11750, 12500, '277–440 seats'],
  ['A339', 64.0, 63.66, 16.79, 251000, 470, 13300, 12500, '260–440 seats'],
  ['A346', 63.45, 75.36, 17.22, 380000, 480, 14600, 12500, '320–380 seats'],
  ['A359', 64.75, 66.8, 17.05, 283000, 488, 15000, 13100, '300–350 seats'],
  ['A35K', 64.75, 73.79, 17.08, 319000, 488, 16100, 13100, '350–410 seats'],
  ['A388', 79.75, 72.72, 24.09, 575000, 488, 15000, 13100, '500–850 seats'],
  ['BCS1', 35.1, 35.0, 11.5, 63100, 447, 6300, 12500, '100–135 seats'],
  ['BCS3', 35.1, 38.7, 11.5, 70900, 447, 6300, 12500, '120–160 seats'],
  ['B737', 35.8, 33.6, 12.5, 70080, 453, 6370, 12500, '126–149 seats'],
  ['B738', 35.8, 39.5, 12.5, 79010, 453, 5765, 12500, '162–189 seats'],
  ['B739', 35.8, 42.1, 12.5, 85130, 453, 5425, 12500, '177–220 seats'],
  ['B38M', 35.9, 39.5, 12.3, 82190, 453, 6570, 12500, '162–210 seats'],
  ['B39M', 35.9, 42.2, 12.3, 88310, 453, 6110, 12500, '178–220 seats'],
  ['B744', 64.4, 70.6, 19.4, 396890, 490, 13450, 13750, '416–660 seats'],
  ['B748', 68.4, 76.3, 19.4, 447700, 490, 14320, 13100, '410–605 seats'],
  ['B752', 38.05, 47.3, 13.6, 115680, 461, 7250, 12800, '200–239 seats'],
  ['B763', 47.6, 54.9, 15.85, 186880, 459, 11070, 13100, '218–269 seats'],
  ['B772', 60.9, 63.7, 18.5, 297550, 490, 14310, 13140, '305–440 seats'],
  ['B77W', 64.8, 73.9, 18.5, 351530, 490, 13650, 13140, '365–550 seats'],
  ['B788', 60.1, 56.7, 17.0, 227930, 488, 13530, 13100, '242–248 seats'],
  ['B789', 60.1, 62.8, 17.0, 254010, 488, 14010, 13100, '290–296 seats'],
  ['B78X', 60.1, 68.3, 17.0, 254010, 488, 11910, 13100, '330–336 seats'],
  ['E170', 26.0, 29.9, 9.67, 37200, 447, 3735, 12500, '66–78 seats'],
  ['E75L', 28.65, 31.68, 9.86, 40370, 447, 4074, 12500, '76–88 seats'],
  ['E190', 28.72, 36.24, 10.57, 51800, 447, 4537, 12500, '96–114 seats'],
  ['E195', 28.72, 38.65, 10.57, 52290, 447, 4260, 12500, '100–124 seats'],
  ['E290', 33.72, 36.25, 10.96, 56400, 450, 5278, 12500, '97–114 seats'],
  ['E295', 35.12, 41.5, 10.9, 62500, 450, 4800, 12500, '120–146 seats'],
  ['CRJ7', 23.24, 32.51, 7.57, 34020, 447, 2655, 12500, '66–78 seats'],
  ['CRJ9', 24.85, 36.4, 7.51, 38330, 447, 2876, 12500, '76–90 seats'],
  ['AT72', 27.05, 27.17, 7.65, 23000, 275, 1528, 7620, '68–78 seats'],
  ['AT76', 27.05, 27.17, 7.65, 23000, 275, 1528, 7620, '68–78 seats'],
  ['DH8D', 28.4, 32.8, 8.3, 29260, 360, 2040, 8230, '68–90 seats'],
  [
    'C130',
    40.4,
    29.8,
    11.6,
    70300,
    292,
    3800,
    10060,
    'Tactical airlifter; ~92 troops',
  ],
  [
    'C30J',
    40.4,
    29.8,
    11.8,
    74390,
    348,
    3300,
    8615,
    'Tactical airlifter; ~92 troops',
  ],
  [
    'C17',
    51.75,
    53.0,
    16.8,
    265350,
    450,
    4480,
    13716,
    'Strategic airlifter; 77,500 kg payload',
  ],
  [
    'A400',
    42.4,
    45.1,
    14.7,
    141000,
    421,
    3300,
    11300,
    'Airlifter; 37,000 kg payload',
  ],
  [
    'K35R',
    39.9,
    41.5,
    12.7,
    146300,
    460,
    2400,
    15240,
    'Aerial refueling tanker',
  ],
  [
    'E3TF',
    44.4,
    46.6,
    12.6,
    147400,
    360,
    7400,
    12500,
    'AWACS airborne early warning',
  ],
  ['P8', 37.64, 39.47, 12.83, 85820, 440, 7500, 12500, 'Maritime patrol / ASW'],
  ['R135', 39.9, 41.5, 12.7, 146000, 430, 6500, 15240, 'Signals intelligence'],
  ['Q4', 39.9, 14.5, 4.7, 14630, 310, 22780, 18288, 'Global Hawk HALE UAV'],
  ['Q9', 20.1, 11.0, 3.8, 4760, 170, 1850, 15240, 'Reaper MALE UAV'],
  [
    'F16',
    9.96,
    15.06,
    4.88,
    19190,
    0,
    4220,
    15240,
    'Single-seat multirole fighter',
  ],
  ['F35', 10.7, 15.7, 4.4, 31750, 0, 2200, 15240, 'Stealth multirole fighter'],
  ['EUFI', 10.95, 15.96, 5.28, 23500, 0, 2900, 16765, 'Multirole fighter'],
  ['B52', 56.4, 48.5, 12.4, 220000, 450, 14160, 15000, 'Strategic bomber'],
  [
    'H60',
    16.36,
    19.76,
    5.13,
    9980,
    150,
    590,
    5790,
    'Black Hawk utility helicopter',
  ],
  ['EC35', 10.2, 12.16, 3.51, 2980, 136, 635, 6100, 'Light twin helicopter'],
  [
    'B06',
    10.16,
    11.82,
    2.83,
    1450,
    116,
    690,
    4115,
    'JetRanger light helicopter',
  ],
  ['C172', 11.0, 8.28, 2.72, 1111, 122, 1185, 4100, '4 seats'],
  ['PC12', 16.28, 14.4, 4.26, 4740, 285, 3417, 9144, '6–9 seats'],
  [
    'GLF6',
    30.36,
    30.41,
    7.72,
    47600,
    488,
    13890,
    15545,
    'Ultra-long-range business jet',
  ],
  [
    'C68A',
    22.05,
    19.37,
    6.25,
    13970,
    441,
    6390,
    13716,
    'Citation Latitude business jet',
  ],
];

/** Identity for designators newer than the Doc 8643 snapshot. */
const IDENTITY_FALLBACK = {
  E290: ['EMBRAER', 'E190-E2', 2, 'jet', 'M'],
  E295: ['EMBRAER', 'E195-E2', 2, 'jet', 'M'],
};

/** Pick the representative model/manufacturer for one designator's rows. */
export function representative(rows, code = '') {
  const norm = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
  const modelCount = new Map();
  const mfrCount = new Map();
  for (const row of rows) {
    const key = norm(row.model);
    modelCount.set(key, (modelCount.get(key) || 0) + 1);
    mfrCount.set(row.manufacturer, (mfrCount.get(row.manufacturer) || 0) + 1);
  }
  const score = (row) =>
    (modelCount.get(norm(row.model)) || 0) * 100 +
    (/\d/.test(row.model) ? 150 : 0) -
    (/\b(BBJ\d?|ACJ|VIP|Prestige|Business Jet)\b/i.test(row.model) ? 120 : 0) +
    (code && norm(row.model).startsWith(code[0].toLowerCase()) ? 20 : 0) -
    row.model.length;
  const best = [...rows].sort((a, b) => score(b) - score(a))[0];
  const sameModel = rows.filter((row) => norm(row.model) === norm(best.model));
  const manufacturer = sameModel
    .map((row) => row.manufacturer)
    .sort((a, b) => (mfrCount.get(b) || 0) - (mfrCount.get(a) || 0))[0];
  return { model: best.model, manufacturer };
}

export async function buildAircraftTypes({ dryRun } = {}) {
  const dir = datasetDir('aircraft_types');
  const file = path.join(dir, 'aircraft_types.json');
  let rows = [];
  let error = '';
  try {
    rows = csvObjects(await fetchText(DOC8643_URL, { timeoutMs: 120_000 }));
  } catch (fetchError) {
    error = fetchError.message;
    console.warn(`  Doc 8643 download failed: ${error}`);
  }
  const grouped = new Map();
  for (const row of rows) {
    const code = clean(row.Designator).toUpperCase();
    if (!/^[A-Z0-9]{2,4}$/.test(code)) continue;
    const entry = {
      manufacturer: clean(row.ManufacturerCode),
      model: clean(row.ModelFullName),
      raw: row,
    };
    if (!grouped.has(code)) grouped.set(code, []);
    grouped.get(code).push(entry);
  }
  const types = {};
  for (const [code, group] of grouped) {
    const { model, manufacturer } = representative(group, code);
    const row = group.find((item) => item.model === model)?.raw || group[0].raw;
    const engines = Number.parseInt(row.EngineCount, 10);
    const description = clean(row.Description);
    const variants = [...new Set(group.map((item) => item.model))]
      .filter((name) => name && name !== model)
      .slice(0, 6);
    const manufacturers = [...new Set(group.map((item) => item.manufacturer))]
      .filter((name) => name && name !== manufacturer)
      .slice(0, 4);
    types[code] = {
      manufacturer,
      model,
      variants,
      otherManufacturers: manufacturers,
      airframe:
        AIRFRAME[description[0]] ||
        clean(row.AircraftDescription).toLowerCase(),
      engines: Number.isFinite(engines) ? engines : null,
      engineType:
        ENGINE_TYPE[clean(row.EngineType).toLowerCase()] ||
        clean(row.EngineType).toLowerCase() ||
        null,
      wakeCategory: clean(row.WTC) || null,
      description,
      source: 'ICAO Doc 8643 (OpenSky)',
    };
  }
  for (const [
    code,
    [manufacturer, model, engines, engineType, wake],
  ] of Object.entries(IDENTITY_FALLBACK)) {
    if (types[code]) continue;
    types[code] = {
      manufacturer,
      model,
      variants: [],
      otherManufacturers: [],
      airframe: 'landplane',
      engines,
      engineType,
      wakeCategory: wake,
      description: '',
      source: 'hand-authored',
    };
  }
  let dimensioned = 0;
  for (const [
    code,
    span,
    length,
    height,
    mtow,
    cruise,
    range,
    ceiling,
    note,
  ] of DIMENSIONS) {
    const entry = (types[code] ||= {
      manufacturer: null,
      model: null,
      airframe: null,
      engines: null,
      engineType: null,
      wakeCategory: null,
      description: '',
      source: 'hand-authored',
    });
    Object.assign(entry, {
      wingspanM: span,
      lengthM: length,
      heightM: height,
      mtowKg: mtow,
      cruiseKt: cruise || null,
      rangeKm: range,
      ceilingM: ceiling,
      capacity: note,
      dimensionsSource:
        'manufacturer published specifications (baseline variant)',
    });
    dimensioned++;
  }
  for (const entry of Object.values(types)) {
    if (!entry.variants?.length) delete entry.variants;
    if (!entry.otherManufacturers?.length) delete entry.otherManufacturers;
  }
  const count = Object.keys(types).length;
  console.log(
    `  ${rows.length} Doc 8643 rows → ${count} designators, ${dimensioned} with dimensions`,
  );
  if (dryRun) return { count, dimensioned, dryRun: true };
  const out = await writeJson(file, {
    generatedAt: new Date().toISOString(),
    source:
      'ICAO Doc 8643 aircraft type designators (OpenSky Network mirror) + hand-checked dimensions',
    count,
    dimensioned,
    types,
  });
  await writeManifest(
    dir,
    {
      dataset: 'aircraft_types',
      file: 'aircraft_types.json',
      sources: [
        { name: 'ICAO Doc 8643 via OpenSky Network', url: DOC8643_URL },
        {
          name: 'Manufacturer published specifications (hand-checked table in scripts/etl/aircraft-types.mjs)',
        },
      ],
      faaNote:
        'FAA Aircraft Characteristics Database not machine-downloadable at build time (HTTP 403 to scripted clients)',
      error: error || undefined,
      count,
      dimensioned,
      bytes: out.bytes,
      sha256: out.sha256,
    },
    `# Aircraft types

Reference data for the PANOPTES aircraft inspector, keyed by ICAO type
designator (the \`typeCode\` adsbdb returns, e.g. \`A320\`, \`B738\`, \`C30J\`).

- Identity (manufacturer, model, variants, airframe, engine count/type, wake
  category): ICAO Doc 8643 as republished by the [OpenSky Network](https://opensky-network.org/datasets/metadata/)
  — reference data; ICAO retains rights in Doc 8643, used here for lookup
- Dimensions and performance (wingspan, length, height, MTOW, cruise, range,
  ceiling, capacity) for ${dimensioned} common civil and military types: hand-checked
  manufacturer published figures for the baseline variant (approximate)
- Designators: ${count.toLocaleString('en-US')}${error ? ` (Doc 8643 download failed: ${error})` : ''}
- The FAA Aircraft Characteristics Database would add dimensions for ~1,500
  types but was not downloadable by script at build time; extend
  \`DIMENSIONS\` in the script or add an FAA parser when a file URL is available.
- Regenerate: \`node scripts/etl/aircraft-types.mjs\`

Shape: \`{ types: { "<ICAO>": { manufacturer, model, variants?, airframe,
engines, engineType, wakeCategory, wingspanM?, lengthM?, heightM?, mtowKg?,
cruiseKt?, rangeKm?, ceilingM?, capacity? } } }\`.
Retrieved ${new Date().toISOString().slice(0, 10)}.`,
  );
  return { count, dimensioned, bytes: out.bytes };
}

if (process.argv[1]?.endsWith('aircraft-types.mjs')) {
  runDataset('aircraft_types', (args) =>
    buildAircraftTypes({ dryRun: args.dryRun }),
  );
}

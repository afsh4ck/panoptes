/**
 * Large + medium airports and named military airfields from OurAirports.
 *
 * Source: https://ourairports.com/data/ (public domain)
 * Output: src/data/local_data/airports/airports.geojsonl
 */
import path from 'node:path';
import {
  clean,
  countryNameFromIso2,
  csvObjects,
  datasetDir,
  fetchText,
  runDataset,
  titleCase,
  writeGeojsonl,
  writeManifest,
} from './lib.mjs';

export const OURAIRPORTS_URL =
  'https://davidmegginson.github.io/ourairports-data/airports.csv';

const MILITARY_NAME =
  /\b(air ?base|AFB|air force|naval air|marine corps air|army air ?field|army heliport|military|RAF |RAAF|RCAF|luftwaffe|fliegerhorst|base a[ée]rea|base a[ée]rienne|base naval|aeronaval)\b/i;

/** Map one OurAirports row to the shared contract (null when out of scope). */
export function airportFeature(row) {
  const type = clean(row.type);
  const name = clean(row.name);
  const military = MILITARY_NAME.test(name);
  const inScope =
    ['large_airport', 'medium_airport'].includes(type) ||
    (military && type !== 'closed');
  if (!inScope) return null;
  const lon = Number(row.longitude_deg);
  const lat = Number(row.latitude_deg);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const iso2 = clean(row.iso_country).toUpperCase();
  const icao = clean(row.icao_code) || clean(row.gps_code);
  const iata = clean(row.iata_code);
  const municipality = clean(row.municipality);
  const elevation = Number(row.elevation_ft);
  const klass = military ? 'military_airfield' : type;
  const codes = [icao, iata].filter(Boolean).join(' / ');
  return {
    id: `ourairports:${clean(row.id) || clean(row.ident)}`,
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: {
      name: name || `${titleCase(klass)} (${iso2})`,
      class: klass,
      subtitle: [titleCase(klass.replace('_airport', ' airport')), codes]
        .filter(Boolean)
        .join(' · '),
      detail:
        [municipality, countryNameFromIso2(iso2) || iso2]
          .filter(Boolean)
          .join(', ') + ' · OurAirports',
      country: iso2,
      source: 'OurAirports',
      tags: {
        ident: clean(row.ident),
        icao_code: icao,
        iata_code: iata,
        elevation_ft: Number.isFinite(elevation) ? elevation : undefined,
        municipality,
        iso_country: iso2,
        iso_region: clean(row.iso_region),
        scheduled_service: clean(row.scheduled_service),
        ourairports_type: type,
      },
    },
  };
}

export async function buildAirports({ limit, dryRun } = {}) {
  const text = await fetchText(OURAIRPORTS_URL, { timeoutMs: 180_000 });
  const rows = csvObjects(text);
  console.log(`  ${rows.length} OurAirports rows`);
  let features = rows.map(airportFeature).filter(Boolean);
  if (Number.isFinite(limit)) features = features.slice(0, limit);
  const dir = datasetDir('airports');
  if (dryRun) return { count: features.length, dryRun: true };
  const out = await writeGeojsonl(
    path.join(dir, 'airports.geojsonl'),
    features,
  );
  await writeManifest(
    dir,
    {
      dataset: 'airports',
      file: 'airports.geojsonl',
      source: 'OurAirports airports.csv',
      url: OURAIRPORTS_URL,
      license: 'Public domain (OurAirports)',
      filter:
        'type in {large_airport, medium_airport} OR name matches military pattern (not closed)',
      count: out.count,
      bytes: out.bytes,
      sha256: out.sha256,
      classes: out.classes,
    },
    `# Airports

Bundled for the PANOPTES "Airports" infrastructure layer.

- Source: [OurAirports](https://ourairports.com/data/) \`airports.csv\`
- License: public domain (released by OurAirports contributors)
- Filter: large and medium airports worldwide, plus any airfield whose name reads as military (air base, AFB, naval air station, …) regardless of size
- Feature count: ${out.count.toLocaleString('en-US')}
- Runtime file: \`airports.geojsonl\`
- Regenerate: \`node scripts/etl/airports.mjs\`

\`class\` is \`large_airport\`, \`medium_airport\` or \`military_airfield\`.
Retrieved ${new Date().toISOString().slice(0, 10)}.`,
  );
  return {
    count: out.count,
    invalid: out.invalid,
    bytes: out.bytes,
    classes: out.classes,
  };
}

if (process.argv[1]?.endsWith('airports.mjs')) {
  runDataset('airports', (args) =>
    buildAirports({ limit: args.limit, dryRun: args.dryRun }),
  );
}

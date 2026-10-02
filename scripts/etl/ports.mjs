/**
 * Ports from the NGA World Port Index (Pub. 150), public domain.
 *
 * Output: src/data/local_data/ports/ports.geojsonl
 */
import path from 'node:path';
import {
  clean,
  countryNameFromIso2,
  csvObjects,
  datasetDir,
  fetchText,
  runDataset,
  writeGeojsonl,
  writeManifest,
} from './lib.mjs';

export const WPI_URL =
  'https://msi.nga.mil/api/publications/download?key=16920959/SFH00000/UpdatedPub150.csv&type=view';

const SIZE_CLASS = {
  large: 'port_large',
  medium: 'port_medium',
  small: 'port_small',
  'very small': 'port_very_small',
};

function pick(row, pattern) {
  const key = Object.keys(row).find((name) => pattern.test(name));
  return key ? clean(row[key]) : '';
}

/** Map one WPI row to the shared contract. */
export function portFeature(row) {
  const lat = Number(pick(row, /^latitude$/i));
  const lon = Number(pick(row, /^longitude$/i));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const name = pick(row, /^main port name$/i);
  const number = pick(row, /^world port index number$/i);
  const iso2 = pick(row, /^country code$/i).toUpperCase();
  const size = pick(row, /^harbor size$/i);
  const type = pick(row, /^harbor type$/i);
  const use = pick(row, /^harbor use$/i);
  const water = pick(row, /^world water body$/i);
  const region = pick(row, /^region name$/i);
  const locode = pick(row, /^un\/locode$/i);
  const maxLength = Number(pick(row, /^maximum vessel length/i));
  const channelDepth = Number(pick(row, /^channel depth/i));
  const countryName = countryNameFromIso2(iso2) || iso2;
  const klass = SIZE_CLASS[size.toLowerCase()] || 'port_unknown';
  return {
    id: `wpi:${number || `${lon},${lat}`}`,
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: {
      name: name || `Port (${countryName})`,
      class: klass,
      subtitle: [size ? `${size} port` : 'Port', type]
        .filter(Boolean)
        .join(' · '),
      detail: [countryName, water || region].filter(Boolean).join(' · '),
      country: iso2,
      source: 'NGA WPI',
      tags: {
        wpi_number: number,
        harbor_size: size,
        harbor_type: type,
        harbor_use: use,
        locode,
        region,
        water_body: water,
        max_vessel_length_m:
          Number.isFinite(maxLength) && maxLength > 0 ? maxLength : undefined,
        channel_depth_m:
          Number.isFinite(channelDepth) && channelDepth > 0
            ? channelDepth
            : undefined,
      },
    },
  };
}

export async function buildPorts({ limit, dryRun } = {}) {
  const text = await fetchText(WPI_URL, { timeoutMs: 180_000 });
  const rows = csvObjects(text);
  console.log(
    `  ${rows.length} WPI rows; columns: ${Object.keys(rows[0] || {})
      .slice(0, 8)
      .join(', ')}…`,
  );
  let features = rows.map(portFeature).filter(Boolean);
  if (Number.isFinite(limit)) features = features.slice(0, limit);
  const dir = datasetDir('ports');
  if (dryRun) return { count: features.length, dryRun: true };
  const out = await writeGeojsonl(path.join(dir, 'ports.geojsonl'), features);
  await writeManifest(
    dir,
    {
      dataset: 'ports',
      file: 'ports.geojsonl',
      source: 'NGA World Port Index (Pub. 150)',
      url: WPI_URL,
      license: 'Public domain (U.S. Government work)',
      count: out.count,
      bytes: out.bytes,
      sha256: out.sha256,
      classes: out.classes,
    },
    `# Ports (World Port Index)

Bundled for the PANOPTES "Ports" infrastructure layer.

- Source: [NGA Maritime Safety Information — World Port Index, Pub. 150](https://msi.nga.mil/Publications/WPI)
- License: public domain (U.S. Government work); no attribution required, credited anyway
- Feature count: ${out.count.toLocaleString('en-US')}
- Runtime file: \`ports.geojsonl\`
- Regenerate: \`node scripts/etl/ports.mjs\`

\`class\` is the WPI harbor size (\`port_large\`, \`port_medium\`, \`port_small\`,
\`port_very_small\`, \`port_unknown\`); \`tags\` keep harbor type/use, UN/LOCODE,
region, water body, maximum vessel length and channel depth.
Retrieved ${new Date().toISOString().slice(0, 10)}.`,
  );
  return {
    count: out.count,
    invalid: out.invalid,
    bytes: out.bytes,
    classes: out.classes,
  };
}

if (process.argv[1]?.endsWith('ports.mjs')) {
  runDataset('ports', (args) =>
    buildPorts({ limit: args.limit, dryRun: args.dryRun }),
  );
}

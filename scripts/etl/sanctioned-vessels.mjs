/**
 * Sanctioned vessels from the OpenSanctions consolidated sanctions dataset.
 *
 * Streams targets.simple.csv (~75 MB) and keeps only `Vessel` rows, indexed
 * by IMO and MMSI so the live AIS layer can flag matches offline.
 *
 * Source: https://www.opensanctions.org/datasets/sanctions/ (CC BY-NC 4.0)
 * Output: src/data/local_data/sanctioned_vessels/sanctioned_vessels.json
 */
import path from 'node:path';
import {
  clean,
  datasetDir,
  fetchWithRetry,
  formatBytes,
  runDataset,
  streamCsv,
  writeJson,
  writeManifest,
} from './lib.mjs';

export const OPENSANCTIONS_URL =
  'https://data.opensanctions.org/datasets/latest/sanctions/targets.simple.csv';

const splitList = (value) =>
  String(value || '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);

/** Extract IMO (7 digits) and MMSI (9 digits) identifiers from the list column. */
export function parseVesselIdentifiers(identifiers) {
  let imo = '';
  let mmsi = '';
  for (const raw of splitList(identifiers)) {
    const token = raw.replace(/\s+/g, '').toUpperCase();
    const imoMatch = /^(?:IMO)?(\d{7})$/.exec(token);
    const mmsiMatch = /^(?:MMSI)?(\d{9})$/.exec(token);
    if (imoMatch && !imo) imo = imoMatch[1];
    else if (mmsiMatch && !mmsi) mmsi = mmsiMatch[1];
  }
  return { imo, mmsi };
}

export async function buildSanctionedVessels({ dryRun, limit } = {}) {
  const dir = datasetDir('sanctioned_vessels');
  const file = path.join(dir, 'sanctioned_vessels.json');
  const vessels = [];
  let header = null;
  let rows = 0;
  let bytesHint = 0;
  try {
    const response = await fetchWithRetry(OPENSANCTIONS_URL, {
      timeoutMs: 900_000,
      retries: 1,
    });
    bytesHint = Number(response.headers.get('content-length')) || 0;
    console.log(`  streaming ${formatBytes(bytesHint)} from OpenSanctions…`);
    await streamCsv(response.body, (row) => {
      if (!header) {
        header = row.map((name) => name.trim());
        return;
      }
      rows++;
      const record = Object.fromEntries(
        header.map((name, i) => [name, row[i] ?? '']),
      );
      if (clean(record.schema) !== 'Vessel') return;
      if (Number.isFinite(limit) && vessels.length >= limit) return;
      const { imo, mmsi } = parseVesselIdentifiers(record.identifiers);
      vessels.push({
        id: clean(record.id),
        name: clean(record.name),
        aliases: splitList(record.aliases).slice(0, 8),
        imo,
        mmsi,
        countries: splitList(record.countries).slice(0, 6),
        sanctions: splitList(record.sanctions)
          .map((program) => program.slice(0, 80))
          .slice(0, 6),
        datasets: splitList(record.datasets ?? record.dataset).slice(0, 6),
        lastSeen: clean(record.last_seen),
      });
    });
  } catch (error) {
    console.warn(`  OpenSanctions download failed: ${error.message}`);
    if (dryRun) return { count: 0, failed: true };
    await writeJson(file, {
      generatedAt: new Date().toISOString(),
      source: 'OpenSanctions sanctions dataset',
      url: OPENSANCTIONS_URL,
      license: 'CC BY-NC 4.0',
      count: 0,
      error: error.message,
      byImo: {},
      byMmsi: {},
      vessels: [],
    });
    await writeManifest(
      dir,
      { dataset: 'sanctioned_vessels', count: 0, error: error.message },
      readme(0, error.message),
    );
    return { count: 0, failed: true, error: error.message };
  }
  console.log(`  ${rows} rows scanned, ${vessels.length} vessels`);
  if (dryRun) return { count: vessels.length, dryRun: true };
  const byImo = {};
  const byMmsi = {};
  vessels.forEach((vessel, index) => {
    if (vessel.imo && byImo[vessel.imo] === undefined)
      byImo[vessel.imo] = index;
    if (vessel.mmsi && byMmsi[vessel.mmsi] === undefined)
      byMmsi[vessel.mmsi] = index;
  });
  const out = await writeJson(file, {
    generatedAt: new Date().toISOString(),
    source: 'OpenSanctions sanctions dataset (targets.simple.csv)',
    url: OPENSANCTIONS_URL,
    license: 'CC BY-NC 4.0',
    count: vessels.length,
    withImo: Object.keys(byImo).length,
    withMmsi: Object.keys(byMmsi).length,
    byImo,
    byMmsi,
    vessels,
  });
  await writeManifest(
    dir,
    {
      dataset: 'sanctioned_vessels',
      file: 'sanctioned_vessels.json',
      source: 'OpenSanctions sanctions dataset',
      url: OPENSANCTIONS_URL,
      license: 'CC BY-NC 4.0',
      count: vessels.length,
      withImo: Object.keys(byImo).length,
      withMmsi: Object.keys(byMmsi).length,
      bytes: out.bytes,
      sha256: out.sha256,
    },
    readme(vessels.length),
  );
  return {
    count: vessels.length,
    withImo: Object.keys(byImo).length,
    withMmsi: Object.keys(byMmsi).length,
    bytes: out.bytes,
  };
}

function readme(count, error = '') {
  return `# Sanctioned vessels

Vessel entities from the OpenSanctions consolidated sanctions list, bundled so
PANOPTES can flag AIS contacts by IMO / MMSI without a network call.

- Source: [OpenSanctions — Consolidated Sanctions](https://www.opensanctions.org/datasets/sanctions/), \`targets.simple.csv\`
- License: **CC BY-NC 4.0 — NonCommercial.** Commercial deployments must license
  the data from OpenSanctions or remove this file.
- Vessel count: ${count.toLocaleString('en-US')}${error ? ` (download failed: ${error})` : ''}
- Runtime file: \`sanctioned_vessels.json\` — \`byImo\` and \`byMmsi\` map identifiers
  to indexes in \`vessels\`
- Regenerate: \`node scripts/etl/sanctioned-vessels.mjs\` (streams ~75 MB; nothing is cached)

Only Vessel-schema rows are kept; names, aliases, flag countries, sanction
programs and source datasets are retained. No personal data is bundled.
Retrieved ${new Date().toISOString().slice(0, 10)}.`;
}

if (process.argv[1]?.endsWith('sanctioned-vessels.mjs')) {
  runDataset('sanctioned_vessels', (args) =>
    buildSanctionedVessels({ dryRun: args.dryRun, limit: args.limit }),
  );
}

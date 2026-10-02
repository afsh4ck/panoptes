import { recordPosition } from './exportLayers.js';

/**
 * Situation report: Markdown built from the live application state. Pure —
 * the caller gathers layers, the selected subject, alerts and zones, and the
 * download helper saves the text.
 */

/** Records shown per layer in the report body. */
export const REPORT_RECORDS_PER_LAYER = 25;
/** Fields that never earn a column: positions are shown once, ids are noise. */
const HIDDEN_FIELDS = new Set([
  'lat',
  'lon',
  'lng',
  'latitude',
  'longitude',
  'latitudeDeg',
  'longitudeDeg',
  'position',
  'entity',
]);
/** Preferred column order when a record has these keys. */
const PREFERRED_FIELDS = [
  'name',
  'label',
  'callsign',
  'registration',
  'type',
  'class',
  'operator',
  'country',
  'mag',
  'magnitude',
  'severity',
  'alertLevel',
  'status',
  'time',
  'updated',
  'source',
];

const text = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

/** Escape Markdown table cell content. */
const cell = (value) =>
  text(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();

function formatTime(value) {
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return text(value) || 'unknown';
  return `${new Date(ms).toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

function formatCoordinate(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 'unknown';
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`;
}

function table(headers, rows) {
  if (!rows.length) return '_none_\n';
  const line = (values) => `| ${values.map(cell).join(' | ')} |`;
  return [
    line(headers),
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(line),
    '',
  ].join('\n');
}

function feedStatus(stats = {}) {
  if (!stats || typeof stats !== 'object') return 'unknown';
  if (stats.error || stats.lastError) return 'degraded';
  if (stats.stale) return 'stale';
  if (stats.loading) return 'loading';
  if (stats.fallback === true) return 'fallback';
  if (stats.partial === true) return 'partial';
  return 'nominal';
}

function columnsFor(records) {
  const keys = new Set();
  for (const record of records)
    for (const key of Object.keys(record || {}))
      if (!HIDDEN_FIELDS.has(key) && record[key] !== null) keys.add(key);
  const preferred = PREFERRED_FIELDS.filter((key) => keys.has(key));
  const rest = [...keys].filter((key) => !preferred.includes(key)).sort();
  return [...preferred, ...rest].slice(0, 6);
}

function layerSection(layer) {
  const records = (layer.records || []).slice(0, REPORT_RECORDS_PER_LAYER);
  const lines = [`### ${layer.name || layer.id}`, ''];
  const count = layer.stats?.count;
  if (Number.isFinite(count))
    lines.push(`Records loaded: ${count.toLocaleString('en-US')}`, '');
  if (!records.length) {
    lines.push('_No records captured for this layer._', '');
    return lines.join('\n');
  }
  const columns = columnsFor(records);
  const rows = records.map((record) => {
    const position = recordPosition(record);
    return [
      ...columns.map((key) => record[key]),
      position ? formatCoordinate(position.lat, position.lon) : '',
    ];
  });
  lines.push(table([...columns, 'position'], rows));
  return lines.join('\n');
}

function subjectSection(selected) {
  if (!selected) return '';
  const lines = ['## Selected subject', ''];
  lines.push(`**${text(selected.title) || 'Unknown subject'}**`);
  if (selected.subtitle) lines.push(`${text(selected.subtitle)}`);
  if (selected.kind) lines.push(`Kind: ${text(selected.kind)}`);
  if (Array.isArray(selected.badges) && selected.badges.length)
    lines.push(`Badges: ${selected.badges.map(text).join(', ')}`);
  lines.push('');
  for (const section of selected.sections || []) {
    if (!section) continue;
    lines.push(`### ${text(section.heading) || 'Details'}`, '');
    const rows = (section.rows || [])
      .map((row) =>
        Array.isArray(row) ? [row[0], row[1]] : [row?.label, row?.value],
      )
      .filter(([label]) => text(label));
    lines.push(table(['Field', 'Value'], rows));
  }
  if (Array.isArray(selected.links) && selected.links.length) {
    lines.push('Links:', '');
    for (const link of selected.links)
      if (link?.url)
        lines.push(`- [${text(link.label) || link.url}](${link.url})`);
    lines.push('');
  }
  if (Array.isArray(selected.notes) && selected.notes.length) {
    lines.push('Notes:', '');
    for (const note of selected.notes) lines.push(`- ${text(note)}`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Build the Markdown situation report.
 * @param {object} input
 * @param {Date|string|number} [input.generatedAt]
 * @param {{lat: number, lon: number, altM?: number, headingDeg?: number}} [input.camera]
 * @param {Array<{id: string, name: string, enabled?: boolean, source?: string, stats?: object, records?: object[]}>} [input.layers]
 * @param {object|null} [input.selected] Intel model: `{kind, title, subtitle, badges, sections, links, notes}`.
 * @param {Array<{severity?: string, title: string, detail?: string, time?: number|string}>} [input.alerts]
 * @param {Array<{name: string, lat: number, lon: number, radiusKm?: number}>} [input.zones]
 * @param {{name?: string}} [input.brand]
 * @returns {string}
 */
export function buildSituationReport({
  generatedAt = Date.now(),
  camera = null,
  layers = [],
  selected = null,
  alerts = [],
  zones = [],
  brand = { name: 'PANOPTES' },
} = {}) {
  const name = text(brand?.name) || 'PANOPTES';
  const active = layers.filter((layer) => layer && layer.enabled !== false);
  const lines = [
    `# ${name} situation report`,
    '',
    `Generated: ${formatTime(generatedAt)}`,
    '',
  ];

  lines.push('## Viewpoint', '');
  if (camera && Number.isFinite(camera.lat) && Number.isFinite(camera.lon)) {
    lines.push(`- Center: ${formatCoordinate(camera.lat, camera.lon)}`);
    if (Number.isFinite(camera.altM))
      lines.push(
        `- Camera height: ${Math.round(camera.altM).toLocaleString('en-US')} m`,
      );
    if (Number.isFinite(camera.headingDeg))
      lines.push(`- Heading: ${Math.round(camera.headingDeg)}°`);
  } else lines.push('- Camera position unavailable');
  lines.push('');

  lines.push('## Active layers', '');
  lines.push(
    table(
      ['Layer', 'Records', 'Source', 'Status'],
      active.map((layer) => [
        layer.name || layer.id,
        Number.isFinite(layer.stats?.count)
          ? layer.stats.count.toLocaleString('en-US')
          : '',
        layer.source || layer.stats?.source || '',
        feedStatus(layer.stats),
      ]),
    ),
  );

  if (active.length) {
    lines.push('## Layer detail', '');
    for (const layer of active) lines.push(layerSection(layer));
  }

  const subject = subjectSection(selected);
  if (subject) lines.push(subject);

  if (Array.isArray(alerts) && alerts.length) {
    lines.push('## Alerts', '');
    lines.push(
      table(
        ['Time', 'Severity', 'Alert', 'Detail'],
        alerts.map((alert) => [
          alert?.time ? formatTime(alert.time) : '',
          alert?.severity || '',
          alert?.title || '',
          alert?.detail || '',
        ]),
      ),
    );
  }

  if (Array.isArray(zones) && zones.length) {
    lines.push('## Watch zones', '');
    lines.push(
      table(
        ['Zone', 'Center', 'Radius'],
        zones.map((zone) => [
          zone?.name || 'zone',
          formatCoordinate(Number(zone?.lat), Number(zone?.lon)),
          Number.isFinite(zone?.radiusKm) ? `${zone.radiusKm} km` : '',
        ]),
      ),
    );
  }

  const sources = [
    ...new Set(
      active
        .map((layer) => text(layer.source || layer.stats?.source).trim())
        .filter(Boolean),
    ),
  ];
  lines.push('## Data provenance', '');
  if (sources.length) for (const source of sources) lines.push(`- ${source}`);
  else lines.push('- No source attribution captured');
  lines.push('');
  lines.push(
    '---',
    '',
    '_Mapped is not confirmed: community and automated feeds describe what was reported, not verified capability, occupancy or status. Live feeds may be stale or on a fallback; check each layer status above before acting on this report._',
    '',
  );
  return lines.join('\n');
}

/** File name for a report generated at the given time. */
export function reportFilename(generatedAt = Date.now()) {
  const iso = new Date(generatedAt).toISOString();
  return `panoptes-report-${iso.slice(0, 19).replace(/[-:]/g, '')}Z.md`;
}

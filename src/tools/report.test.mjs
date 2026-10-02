import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSituationReport, reportFilename } from './report.js';

const input = () => ({
  generatedAt: Date.UTC(2026, 8, 30, 18, 15, 0),
  camera: { lat: 40.4168, lon: -3.7038, altM: 12345.6, headingDeg: 90.4 },
  layers: [
    {
      id: 'earthquakes',
      name: 'Earthquakes',
      enabled: true,
      source: 'USGS',
      stats: { count: 2 },
      records: [
        { name: 'M5.1 - Chile', mag: 5.1, lat: -33.4, lon: -70.6, time: 1 },
        { name: 'M2.5 | pipe', mag: 2.5, lat: 10, lon: 20, time: 2 },
      ],
    },
    {
      id: 'flights',
      name: 'Live Flights',
      enabled: true,
      stats: { count: 11000, source: 'OpenSky', stale: true },
      records: [],
    },
    { id: 'off', name: 'Disabled', enabled: false, stats: { count: 9 } },
  ],
  selected: {
    kind: 'aircraft',
    title: 'IBE6250',
    subtitle: 'Airbus A350-900 · Iberia',
    badges: ['LIVE', 'A359'],
    sections: [
      {
        heading: 'Airframe',
        rows: [{ label: 'Registration', value: 'EC-NCX' }, ['MTOW', '280 t']],
      },
    ],
    links: [{ label: 'Photos', url: 'https://example.test/photos' }],
    notes: ['Route from adsbdb; unverified.'],
  },
  alerts: [
    {
      severity: 'high',
      title: 'Squawk 7700',
      detail: 'IBE6250',
      time: Date.UTC(2026, 8, 30, 18, 0),
    },
  ],
  zones: [{ name: 'Rota watch', lat: 36.62, lon: -6.35, radiusKm: 50 }],
});

test('buildSituationReport renders every section in order', () => {
  const markdown = buildSituationReport(input());
  const order = [
    '# PANOPTES situation report',
    'Generated: 2026-09-30 18:15:00 UTC',
    '## Viewpoint',
    '- Center: 40.4168° N, 3.7038° W',
    '- Camera height: 12,346 m',
    '- Heading: 90°',
    '## Active layers',
    '| Earthquakes | 2 | USGS | nominal |',
    '| Live Flights | 11,000 | OpenSky | stale |',
    '## Layer detail',
    '### Earthquakes',
    '| name | mag | time | position |',
    '| M2.5 \\| pipe | 2.5 | 2 | 10.0000° N, 20.0000° E |',
    '### Live Flights',
    '_No records captured for this layer._',
    '## Selected subject',
    '**IBE6250**',
    'Badges: LIVE, A359',
    '### Airframe',
    '| Registration | EC-NCX |',
    '| MTOW | 280 t |',
    '- [Photos](https://example.test/photos)',
    '- Route from adsbdb; unverified.',
    '## Alerts',
    '| 2026-09-30 18:00:00 UTC | high | Squawk 7700 | IBE6250 |',
    '## Watch zones',
    '| Rota watch | 36.6200° N, 6.3500° W | 50 km |',
    '## Data provenance',
    '- USGS',
    '- OpenSky',
    'Mapped is not confirmed',
  ];
  let cursor = -1;
  for (const needle of order) {
    const next = markdown.indexOf(needle, cursor + 1);
    assert.ok(next > cursor, `expected "${needle}" after position ${cursor}`);
    cursor = next;
  }
  assert.ok(!markdown.includes('Disabled'));
});

test('buildSituationReport tolerates an empty state and custom brand', () => {
  const markdown = buildSituationReport({ brand: { name: 'Fork' } });
  assert.ok(markdown.startsWith('# Fork situation report'));
  assert.ok(markdown.includes('- Camera position unavailable'));
  assert.ok(markdown.includes('_none_'));
  assert.ok(markdown.includes('- No source attribution captured'));
  assert.ok(!markdown.includes('## Selected subject'));
  assert.ok(!markdown.includes('## Alerts'));
});

test('reportFilename is timestamped and stable', () => {
  assert.equal(
    reportFilename(Date.UTC(2026, 8, 30, 18, 15, 0)),
    'panoptes-report-20260930T181500Z.md',
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLaunchIntelModel,
  describeCountdown,
  isRawLaunchLibraryLaunch,
  normalizeLaunchForIntel,
} from './launchIntel.js';

const NOW = Date.parse('2026-09-30T18:00:00Z');

/** Shape produced by src/layers/launches/model.js normalizeRocketLaunches. */
const LAYER_RECORD = {
  id: 'f4a1c2d3-1111-2222-3333-444455556666',
  name: 'Falcon 9 Block 5 | Starlink Group 10-30',
  status: 'Launch Successful',
  launchTime: '2026-09-29T14:12:00.000Z',
  launchSite: 'Space Launch Complex 40',
  lat: 28.56194,
  lon: -80.57735,
  provider: 'SpaceX',
  mission: 'A batch of satellites for the Starlink mega-constellation.',
  missionName: 'Starlink Group 10-30',
  satelliteQuery: 'Starlink Group 10-30',
  payloads: [
    {
      id: 'p1',
      name: 'Starlink V2 Mini',
      type: 'Communications',
      manufacturer: 'SpaceX',
      operator: 'SpaceX',
      destination: 'Low Earth Orbit',
      amount: 24,
      massKg: 800,
    },
  ],
  recoveryStages: [
    {
      id: 's1',
      category: 'LAUNCHER',
      name: 'Core · B1083',
      serial: 'B1083',
      reused: true,
      flightNumber: 12,
      status: 'RECOVERED',
      destination: 'A Shortfall of Gravitas',
      downrangeKm: 632,
    },
  ],
  trajectory: [],
  timeline: [
    { name: 'MECO', relativeTime: 'PT2M27S', offsetSeconds: 147 },
    { name: 'SECO-1', relativeTime: 'PT8M45S', offsetSeconds: 525 },
  ],
  orbit: { name: 'Low Earth Orbit', abbrev: 'LEO' },
  source: 'Launch Library 2',
  inWindow: true,
};

/** Trimmed raw Launch Library 2 launch object. */
const RAW_LAUNCH = {
  id: 'f4a1c2d3-1111-2222-3333-444455556666',
  slug: 'falcon-9-block-5-starlink-group-10-30',
  name: 'Falcon 9 Block 5 | Starlink Group 10-30',
  status: {
    name: 'Go for Launch',
    abbrev: 'Go',
    description: 'Current T-0 confirmed by official or reliable sources.',
  },
  net: '2026-10-01T02:30:00Z',
  window_start: '2026-10-01T02:30:00Z',
  window_end: '2026-10-01T06:00:00Z',
  net_precision: { name: 'Minute' },
  probability: 90,
  weather_concerns: 'Cumulus cloud rule',
  launch_service_provider: {
    name: 'SpaceX',
    abbrev: 'SpX',
    type: { name: 'Commercial' },
    country: [{ name: 'United States of America' }],
  },
  rocket: {
    configuration: {
      name: 'Falcon 9',
      full_name: 'Falcon 9 Block 5',
      variant: 'Block 5',
      family: [{ name: 'Falcon' }],
    },
    launcher_stage: [
      {
        id: 1,
        type: 'Core',
        reused: true,
        launcher_flight_number: 12,
        launcher: { serial_number: 'B1083' },
        landing: {
          attempt: true,
          success: null,
          type: { name: 'ASDS' },
          landing_location: { name: 'A Shortfall of Gravitas' },
          downrange_distance: 632,
        },
      },
    ],
    spacecraft_stage: null,
  },
  mission: {
    name: 'Starlink Group 10-30',
    description: 'A batch of satellites for the Starlink mega-constellation.',
    type: 'Communications',
    orbit: { name: 'Low Earth Orbit', abbrev: 'LEO' },
    agencies: [{ name: 'SpaceX' }],
  },
  pad: {
    name: 'Space Launch Complex 40',
    latitude: '28.56194122',
    longitude: '-80.57735736',
    location: { name: 'Cape Canaveral SFS, FL, USA', country_code: 'USA' },
    wiki_url:
      'https://en.wikipedia.org/wiki/Cape_Canaveral_Space_Launch_Complex_40',
    map_url: 'https://www.google.com/maps?q=28.56194122,-80.57735736',
    total_launch_count: 300,
  },
  image: {
    image_url:
      'https://thespacedevs-prod.nyc3.digitaloceanspaces.com/media/images/falcon_9_image.jpg',
  },
  vid_urls: [
    { url: 'https://www.youtube.com/watch?v=abc' },
    { url: 'javascript:alert(1)' },
  ],
  info_urls: [{ url: 'https://www.spacex.com/launches/' }],
  program: [{ name: 'Starlink' }],
  timeline: [{ type: { abbrev: 'MECO' }, relative_time: 'PT2M27S' }],
};

test('isRawLaunchLibraryLaunch separates raw feed objects from layer records', () => {
  assert.equal(isRawLaunchLibraryLaunch(RAW_LAUNCH), true);
  assert.equal(isRawLaunchLibraryLaunch(LAYER_RECORD), false);
  assert.equal(isRawLaunchLibraryLaunch(null), false);
});

test('describeCountdown formats T-minus and T-plus', () => {
  assert.equal(describeCountdown('2026-09-30T20:14:05Z', NOW), 'T-02:14:05');
  assert.equal(describeCountdown('2026-09-27T14:00:00Z', NOW), 'T+3 d 4 h');
  assert.equal(describeCountdown(null, NOW), '');
});

test('normalizeLaunchForIntel maps the raw feed object', () => {
  const info = normalizeLaunchForIntel(RAW_LAUNCH);
  assert.equal(info.vehicle, 'Falcon 9 Block 5');
  assert.equal(info.vehicleFamily, 'Falcon');
  assert.equal(info.provider, 'SpaceX');
  assert.equal(info.providerCountry, 'United States of America');
  assert.equal(info.pad.lat, 28.56194122);
  assert.equal(info.pad.location, 'Cape Canaveral SFS, FL, USA');
  assert.equal(info.pad.totalLaunches, 300);
  assert.equal(
    info.image,
    'https://thespacedevs-prod.nyc3.digitaloceanspaces.com/media/images/falcon_9_image.jpg',
  );
  assert.deepEqual(info.webcastUrls, ['https://www.youtube.com/watch?v=abc']);
  assert.equal(info.recoveryStages[0].status, 'RECOVERY ATTEMPT');
  assert.equal(info.recoveryStages[0].serial, 'B1083');
  assert.deepEqual(info.program, ['Starlink']);
  assert.equal(info.timeline[0].name, 'MECO');
});

test('buildLaunchIntelModel from the layer record', () => {
  const model = buildLaunchIntelModel({ launch: LAYER_RECORD, nowMs: NOW });
  assert.equal(model.kind, 'launch');
  assert.equal(model.id, `launch:${LAYER_RECORD.id}`);
  assert.equal(model.title, 'Starlink Group 10-30');
  assert.equal(model.subtitle, 'Falcon 9 Block 5 · SpaceX · Launch Successful');
  const headings = model.sections.map((section) => section.heading);
  assert.deepEqual(headings, [
    'MISSION',
    'VEHICLE',
    'PAYLOADS',
    'RECOVERY',
    'PROVIDER',
    'PAD',
    'TIMELINE',
  ]);
  const mission = Object.fromEntries(
    model.sections[0].rows.map((row) => [row.label, row.value]),
  );
  assert.equal(mission.NET, '2026-09-29 14:12 UTC (T+1 d 3 h)');
  assert.equal(mission['Target orbit'], 'Low Earth Orbit (LEO)');
  const payloads = model.sections[2].rows;
  assert.equal(payloads[0].label, 'Starlink V2 Mini ×24');
  assert.equal(
    payloads[0].value,
    'Communications · 800 kg · SpaceX · Low Earth Orbit',
  );
  const recovery = model.sections[3].rows[0];
  assert.equal(
    recovery.value,
    'RECOVERED · A Shortfall of Gravitas · 632 km downrange · reused · flight 12',
  );
  assert.deepEqual(
    model.badges.map((badge) => badge.label),
    ['LAUNCH SUCCESSFUL', 'T+1 d 3 h', 'LEO'],
  );
  assert.equal(model.badges[0].tone, 'ok');
  assert.equal(model.photo, null);
  assert.ok(
    model.links.some((link) => link.label === 'Launch Library 2 record'),
  );
  assert.ok(model.notes.some((note) => /layer record/.test(note)));
});

test('buildLaunchIntelModel from the raw feed object carries media and links', () => {
  const model = buildLaunchIntelModel({ launch: RAW_LAUNCH, nowMs: NOW });
  assert.equal(model.subtitle, 'Falcon 9 Block 5 · SpaceX · Go for Launch');
  assert.equal(model.photo.src, RAW_LAUNCH.image.image_url);
  const mission = Object.fromEntries(
    model.sections[0].rows.map((row) => [row.label, row.value]),
  );
  assert.equal(mission.NET, '2026-10-01 02:30 UTC (T-08:30:00)');
  assert.equal(mission.Window, '2026-10-01 02:30 UTC → 2026-10-01 06:00 UTC');
  assert.equal(mission['Go probability'], '90%');
  assert.equal(mission.Program, 'Starlink');
  const labels = model.links.map((link) => link.label);
  assert.deepEqual(labels, [
    'Webcast',
    'Mission info',
    'Pad on Wikipedia',
    'Pad map',
    'Space Launch Now',
    'Launch Library 2 record',
    'Wikipedia search',
  ]);
  assert.ok(model.links.every((link) => /^https:\/\//.test(link.href)));
  assert.equal(model.badges[0].tone, 'neutral');
  assert.equal(buildLaunchIntelModel({ launch: null }), null);
});

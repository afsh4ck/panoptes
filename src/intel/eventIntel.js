/**
 * @module eventIntel
 * @description Dossier for a selected event: earthquake (USGS), fire (NASA
 * FIRMS), disaster alert (GDACS / EONET), conflict event (GDELT / UCDP /
 * ACLED), tropical cyclone (NHC / CPHC) or GPS-interference cell. Pure:
 * everything comes from the selection record the layer published.
 */
// Namespace import: Vite serves mgrs as ESM named exports, while Node's
// CommonJS interop exposes it only as a default.
import * as mgrsModule from 'mgrs';
import {
  cleanText,
  createIntelModel,
  fmtDate,
  fmtNumber,
  fmtSpeed,
  intelRow,
} from './intelModel.js';

const mgrsForward = mgrsModule.forward || mgrsModule.default?.forward;

const ACCENTS = Object.freeze({
  earthquakes: '#ff7a45',
  'local-firms': '#ff4d4f',
  'disaster-alerts': '#ffd166',
  'conflict-events': '#ff4d4f',
  'weather-cyclones': '#8ab4f8',
  'gps-interference': '#c084fc',
});

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const ROMAN = [
  'I',
  'II',
  'III',
  'IV',
  'V',
  'VI',
  'VII',
  'VIII',
  'IX',
  'X',
  'XI',
  'XII',
];

const num = (value) => {
  if (value === null || value === undefined || value === '') return NaN;
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
};

/** "12 min ago" / "3 h ago" / "2 d ago". */
export function timeAgo(ms, nowMs) {
  const age = nowMs - num(ms);
  if (!Number.isFinite(age) || age < 0) return '';
  const minutes = Math.floor(age / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

const when = (ms, nowMs) =>
  Number.isFinite(num(ms))
    ? [fmtDate(num(ms)), timeAgo(ms, nowMs)].filter(Boolean).join(' · ')
    : '';

const intensity = (value) => {
  const v = num(value);
  return v >= 1 ? ROMAN[Math.min(12, Math.round(v)) - 1] : '';
};

const compass = (degrees) => {
  const d = num(degrees);
  return Number.isFinite(d)
    ? COMPASS[Math.round((((d % 360) + 360) % 360) / 45) % 8]
    : '';
};

function locationRows(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  let mgrs = '';
  try {
    mgrs = mgrsForward ? mgrsForward([lon, lat], 4) : '';
  } catch {
    mgrs = '';
  }
  return [
    intelRow('Latitude', lat.toFixed(5), { mono: true }),
    intelRow('Longitude', lon.toFixed(5), { mono: true }),
    intelRow('MGRS', mgrs, { mono: true }),
  ];
}

const PAGER = Object.freeze({
  green: ['Green — little or no response expected', 'ok'],
  yellow: ['Yellow — local or regional response', 'warn'],
  orange: ['Orange — national response', 'alert'],
  red: ['Red — international response', 'alert'],
});

function earthquake(props, nowMs) {
  const mag = num(props.mag);
  const depth = num(props.depth);
  const pager = PAGER[cleanText(props.alert)];
  const url = cleanText(props.url);
  const badges = [];
  if (pager)
    badges.push({
      label: `PAGER ${props.alert.toUpperCase()}`,
      tone: pager[1],
    });
  if (props.tsunami === true || props.tsunami === 'yes')
    badges.push({ label: 'TSUNAMI FLAG', tone: 'alert' });
  if (props.status === 'reviewed')
    badges.push({ label: 'REVIEWED', tone: 'ok' });
  else if (props.status) badges.push({ label: 'AUTOMATIC', tone: 'neutral' });
  const depthClass = !Number.isFinite(depth)
    ? ''
    : depth < 70
      ? 'shallow'
      : depth < 300
        ? 'intermediate'
        : 'deep';
  return {
    title: [
      Number.isFinite(mag) ? `M${mag.toFixed(1)}` : 'Earthquake',
      cleanText(props.place),
    ]
      .filter(Boolean)
      .join(' · '),
    subtitle: ['Earthquake', when(props.time, nowMs)]
      .filter(Boolean)
      .join(' · '),
    badges,
    sections: [
      {
        heading: 'EVENT',
        rows: [
          intelRow(
            'Magnitude',
            Number.isFinite(mag)
              ? [mag.toFixed(1), cleanText(props.magType)]
                  .filter(Boolean)
                  .join(' ')
              : '',
          ),
          intelRow(
            'Depth',
            Number.isFinite(depth)
              ? `${fmtNumber(depth, { digits: 1 })} km · ${depthClass}`
              : '',
          ),
          intelRow('Time', when(props.time, nowMs)),
          intelRow('Review status', props.status),
          intelRow('Significance', props.sig),
        ],
      },
      {
        heading: 'IMPACT',
        rows: [
          intelRow('PAGER alert', pager?.[0]),
          intelRow(
            'Tsunami',
            props.tsunami === true || props.tsunami === 'yes'
              ? 'Flagged by USGS for an oceanic event; check the official warning centres'
              : '',
          ),
          intelRow(
            'Felt reports',
            Number.isFinite(num(props.felt))
              ? `${fmtNumber(num(props.felt))} (Did You Feel It?)`
              : '',
          ),
          intelRow('Max reported intensity', intensity(props.cdi)),
          intelRow('ShakeMap intensity', intensity(props.mmi)),
        ],
      },
    ],
    links: url
      ? [
          { label: 'USGS event page', href: url },
          { label: 'ShakeMap', href: `${url}/shakemap` },
          { label: 'Did You Feel It?', href: `${url}/dyfi` },
        ]
      : [],
    notes: ['Automatic USGS solutions are revised as more stations report.'],
  };
}

function fire(props, nowMs, lat, lon) {
  const frp = num(props.frp);
  const confidence = cleanText(props.confidence);
  const pct = num(props.confidencePct);
  const brightness = num(props.brightness);
  const badges = [];
  if (confidence)
    badges.push({
      label: `${confidence.toUpperCase()} CONFIDENCE`,
      tone: /high/i.test(confidence) ? 'alert' : 'neutral',
    });
  if (props.daynight)
    badges.push({
      label: cleanText(props.daynight).toUpperCase(),
      tone: 'neutral',
    });
  const acquired = num(props.acquired);
  return {
    title: Number.isFinite(frp)
      ? `Fire · FRP ${fmtNumber(frp, { digits: 1 })} MW`
      : 'Fire detection',
    subtitle: [cleanText(props.sensor), cleanText(props.satellite)]
      .filter((value) => value && value !== 'unknown')
      .join(' · '),
    badges,
    sections: [
      {
        heading: 'DETECTION',
        rows: [
          intelRow(
            'Fire radiative power',
            Number.isFinite(frp) ? `${fmtNumber(frp, { digits: 1 })} MW` : '',
          ),
          intelRow(
            'Confidence',
            [confidence, Number.isFinite(pct) ? `${pct}%` : '']
              .filter(Boolean)
              .join(' · '),
          ),
          intelRow(
            'Brightness temperature',
            Number.isFinite(brightness)
              ? `${fmtNumber(brightness, { digits: 1 })} K`
              : '',
          ),
          intelRow(
            'Acquired',
            Number.isFinite(acquired) ? when(acquired, nowMs) : props.age,
          ),
          intelRow('Sensor', props.sensor === 'unknown' ? '' : props.sensor),
          intelRow('Satellite', props.satellite),
          intelRow('Day / night', props.daynight),
        ],
      },
    ],
    links:
      Number.isFinite(lat) && Number.isFinite(lon)
        ? [
            {
              label: 'NASA FIRMS map',
              href: `https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${lon.toFixed(3)},${lat.toFixed(3)},12.0z`,
            },
          ]
        : [],
    notes: [
      'A thermal anomaly seen from orbit: industry, gas flares and volcanoes also trigger detections.',
    ],
  };
}

const LEVEL_TONES = Object.freeze({
  red: 'alert',
  orange: 'warn',
  green: 'ok',
});

function disaster(props, nowMs) {
  const level = cleanText(props.level).toLowerCase();
  const link = cleanText(props.link);
  return {
    title: cleanText(props.title) || 'Disaster alert',
    subtitle: [cleanText(props.type), cleanText(props.country)]
      .filter(Boolean)
      .join(' · '),
    badges: [
      ...(level
        ? [
            {
              label: `${level.toUpperCase()} ALERT`,
              tone: LEVEL_TONES[level] || 'neutral',
            },
          ]
        : []),
      ...(props.type
        ? [{ label: cleanText(props.type).toUpperCase(), tone: 'neutral' }]
        : []),
    ],
    sections: [
      {
        heading: 'ALERT',
        rows: [
          intelRow('Type', props.type),
          intelRow('Alert level', level),
          intelRow('Severity', props.severity),
          intelRow('Country', props.country),
          intelRow('Source', props.source),
          intelRow('Updated', when(props.updated, nowMs)),
        ],
      },
    ],
    links: link
      ? [{ label: `${cleanText(props.source) || 'Source'} report`, href: link }]
      : [],
    notes: [],
  };
}

function conflict(props, nowMs) {
  const fatalities = num(props.fatalities);
  const url = cleanText(props.url);
  const source = cleanText(props.source);
  return {
    title: cleanText(props.title) || cleanText(props.kind) || 'Conflict event',
    subtitle: [cleanText(props.kind), cleanText(props.country)]
      .filter(Boolean)
      .join(' · '),
    badges: [
      ...(props.kind
        ? [{ label: cleanText(props.kind).toUpperCase(), tone: 'warn' }]
        : []),
      ...(fatalities > 0
        ? [{ label: `${fmtNumber(fatalities)} FATALITIES`, tone: 'alert' }]
        : []),
    ],
    sections: [
      {
        heading: 'EVENT',
        rows: [
          intelRow('Type', props.kind),
          intelRow('Country', props.country),
          intelRow(
            'Reported fatalities',
            Number.isFinite(fatalities) ? fmtNumber(fatalities) : '',
          ),
          intelRow(
            'Media mentions',
            Number.isFinite(num(props.mentions))
              ? fmtNumber(num(props.mentions))
              : '',
          ),
          intelRow('Time', when(props.time, nowMs)),
          intelRow('Source', source),
        ],
      },
    ],
    links: url ? [{ label: 'Source article', href: url }] : [],
    notes: [
      source === 'GDELT'
        ? 'GDELT events are machine-coded from news reports and can be duplicated or misplaced.'
        : 'Researcher-coded event; figures are revised as reporting improves.',
    ],
  };
}

const STORM_CLASSES = Object.freeze({
  TD: 'Tropical depression',
  TS: 'Tropical storm',
  HU: 'Hurricane',
  MH: 'Major hurricane',
  STD: 'Subtropical depression',
  STS: 'Subtropical storm',
  PTC: 'Post-tropical cyclone',
  PC: 'Potential tropical cyclone',
});

/** Saffir-Simpson category from sustained wind in knots, or ''. */
export function saffirSimpson(windKt) {
  const kt = num(windKt);
  if (!Number.isFinite(kt) || kt < 64) return '';
  if (kt >= 137) return 'Category 5';
  if (kt >= 113) return 'Category 4';
  if (kt >= 96) return 'Category 3';
  if (kt >= 83) return 'Category 2';
  return 'Category 1';
}

function cyclone(props, nowMs) {
  const code = cleanText(props.classification).toUpperCase();
  const klass = STORM_CLASSES[code] || code;
  const category = saffirSimpson(props.windKt);
  const movementKt = num(props.movementKt);
  const advisoryUrl = cleanText(props.advisoryUrl);
  return {
    title:
      [klass, cleanText(props.name)].filter(Boolean).join(' ') ||
      'Tropical cyclone',
    subtitle: [cleanText(props.basin), category].filter(Boolean).join(' · '),
    badges: [
      ...(category ? [{ label: category.toUpperCase(), tone: 'alert' }] : []),
      ...(code ? [{ label: code, tone: 'warn' }] : []),
    ],
    sections: [
      {
        heading: 'STORM',
        rows: [
          intelRow('Classification', klass),
          intelRow('Basin', props.basin),
          intelRow('Max sustained wind', fmtSpeed(props.windKt)),
          intelRow('Category', category),
          intelRow(
            'Minimum pressure',
            Number.isFinite(num(props.pressureHpa))
              ? `${fmtNumber(num(props.pressureHpa))} hPa`
              : '',
          ),
          intelRow(
            'Movement',
            Number.isFinite(movementKt)
              ? `${compass(props.movementDeg)} at ${fmtNumber(movementKt)} kt`
              : '',
          ),
          intelRow('Advisory', props.advisoryNumber),
          intelRow('Position time', when(props.positionAt, nowMs)),
        ],
      },
    ],
    links: advisoryUrl
      ? [{ label: 'Official advisory', href: advisoryUrl }]
      : [],
    notes: [
      'Official forecasts and warnings come from the issuing centre; check the advisory.',
    ],
  };
}

function gpsInterference(props) {
  const ratio = num(props.ratio);
  const level = cleanText(props.level);
  return {
    title: 'GPS interference',
    subtitle: level ? `${level} level` : '',
    badges: level ? [{ label: level.toUpperCase(), tone: 'warn' }] : [],
    sections: [
      {
        heading: 'CELL',
        rows: [
          intelRow('Level', level),
          intelRow('Aircraft sampled', props.total),
          intelRow('Degraded navigation', props.bad),
          intelRow(
            'Degraded share',
            Number.isFinite(ratio) ? `${fmtNumber(ratio * 100)}%` : '',
          ),
        ],
      },
    ],
    links: [],
    notes: [
      'Inferred from aircraft reporting degraded ADS-B navigation integrity (NIC/NACp): jamming, spoofing and onboard faults look alike.',
    ],
  };
}

const BUILDERS = Object.freeze({
  earthquakes: earthquake,
  'local-firms': fire,
  'disaster-alerts': disaster,
  'conflict-events': conflict,
  'weather-cyclones': cyclone,
  'gps-interference': gpsInterference,
});

/**
 * Build the event dossier from the selection record.
 * @param {object} input
 * @param {object} input.subject Panel subject.
 * @param {object|null} input.live Selected context record.
 * @param {number} [input.nowMs]
 * @returns {object} IntelModel.
 */
export function buildEventIntelModel({
  subject = {},
  live = null,
  nowMs = Date.now(),
} = {}) {
  const record = live || subject.record || {};
  const props =
    record.properties && typeof record.properties === 'object'
      ? record.properties
      : {};
  const layerId = cleanText(record.layerId || subject.layerId);
  const lat = Number(record.latitude ?? subject.latitude);
  const lon = Number(record.longitude ?? subject.longitude);
  const build = BUILDERS[layerId];
  const parts = build
    ? build(props, nowMs, lat, lon)
    : {
        title: cleanText(record.label) || 'Event',
        subtitle: '',
        badges: [],
        sections: [],
        links: [],
        notes: [],
      };
  const { entity: _entity, dataSource: _dataSource, ...rawRecord } = record;
  return createIntelModel({
    kind: 'event',
    id: cleanText(record.id || subject.id),
    title: parts.title,
    subtitle: parts.subtitle,
    accent: ACCENTS[layerId] || '#f5a524',
    badges: parts.badges,
    photo: null,
    sections: [
      ...parts.sections,
      { heading: 'LOCATION', rows: locationRows(lat, lon) },
      {
        heading: 'PROVENANCE',
        rows: [
          intelRow('Layer', record.layerName || layerId),
          intelRow('Source', record.source),
        ],
      },
    ],
    links: parts.links,
    raw: rawRecord,
    fetchedAt: nowMs,
    notes: parts.notes,
  });
}

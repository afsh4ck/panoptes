/**
 * Vessel intelligence card model.
 *
 * Pure. Reduces the AIS record the vessels layer holds (see `normalizeVessel`
 * in `src/layers/vessels/records.js` and the context-store registration in
 * `src/layers/vessels/selection.js`) to one IntelModel, decoding the AIS ship
 * type code, the flag state from the MMSI maritime identification digits, and
 * a match against the bundled OpenSanctions vessel index when it is present.
 *
 * Output: `{kind, id, title, subtitle, accent, badges, photo, sections, links,
 *   raw, fetchedAt, notes}`.
 */

import { createIntelModel, sanitizeHref } from './intelModel.js';

const text = (value) => {
  const t = String(value ?? '').trim();
  return t && t !== 'undefined' && t !== 'null' ? t : '';
};
const finite = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const fmt = (value, digits = 0) =>
  Number.isFinite(value)
    ? value.toLocaleString('en-US', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    : '—';
const truncate = (value, max = 120) => {
  const t = text(value);
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** Only absolute http(s) links reach the card (shared contract rule). */
export function safeHttpUrl(value) {
  return sanitizeHref(value);
}

export const DARK_AFTER_MS = 6 * 3600_000;

/**
 * ITU-R M.585 ship type codes (AIS message 5 / 24B), first digit = category,
 * second = hazardous cargo class for WIG / HSC / passenger / cargo / tanker /
 * other. Codes 0 and 1–19 are "not available" / reserved.
 */
const TYPE_CATEGORIES = Object.freeze({
  2: ['WIG craft', 'wig'],
  4: ['High-speed craft', 'hsc'],
  6: ['Passenger ship', 'passenger'],
  7: ['Cargo ship', 'cargo'],
  8: ['Tanker', 'tanker'],
  9: ['Other vessel', 'other'],
});
const TYPE_SPECIFIC = Object.freeze({
  30: ['Fishing vessel', 'fishing'],
  31: ['Towing vessel', 'tug'],
  32: ['Towing vessel (tow > 200 m or > 25 m beam)', 'tug'],
  33: ['Dredging or underwater operations', 'other'],
  34: ['Diving operations', 'other'],
  35: ['Military operations', 'military'],
  36: ['Sailing vessel', 'sailing'],
  37: ['Pleasure craft', 'pleasure'],
  50: ['Pilot vessel', 'pilot'],
  51: ['Search and rescue vessel', 'sar'],
  52: ['Tug', 'tug'],
  53: ['Port tender', 'other'],
  54: ['Anti-pollution equipment', 'other'],
  55: ['Law enforcement vessel', 'law'],
  56: ['Spare — local vessel', 'other'],
  57: ['Spare — local vessel', 'other'],
  58: ['Medical transport', 'other'],
  59: ['Non-combatant ship (RR Resolution 18)', 'other'],
});
const HAZARD_CLASSES = Object.freeze({ 1: 'A', 2: 'B', 3: 'C', 4: 'D' });
const CATEGORY_KEYWORDS = Object.freeze([
  ['tanker', 'tanker'],
  ['cargo', 'cargo'],
  ['passenger', 'passenger'],
  ['fish', 'fishing'],
  ['military', 'military'],
  ['warship', 'military'],
  ['law', 'law'],
  ['rescue', 'sar'],
  ['sar', 'sar'],
  ['tug', 'tug'],
  ['tow', 'tug'],
  ['pilot', 'pilot'],
  ['high speed', 'hsc'],
  ['hsc', 'hsc'],
  ['wig', 'wig'],
  ['sail', 'sailing'],
  ['pleasure', 'pleasure'],
  ['yacht', 'pleasure'],
]);

/**
 * Decode an AIS ship type. Accepts the numeric code (number or string) or a
 * text label already produced upstream.
 * @param {number|string|null|undefined} value
 * @returns {{code: number|null, label: string, category: string, hazardous: string|null}}
 */
export function decodeAisShipType(value) {
  const raw = text(value);
  const code = /^\d{1,3}$/.test(raw) ? Number(raw) : null;
  if (code === null) {
    if (!raw)
      return {
        code: null,
        label: 'Not available',
        category: 'unknown',
        hazardous: null,
      };
    const lower = raw.toLowerCase();
    const match = CATEGORY_KEYWORDS.find(([keyword]) =>
      lower.includes(keyword),
    );
    return {
      code: null,
      label: raw,
      category: match ? match[1] : 'other',
      hazardous: null,
    };
  }
  if (code === 0)
    return {
      code,
      label: 'Not available',
      category: 'unknown',
      hazardous: null,
    };
  if (TYPE_SPECIFIC[code]) {
    const [label, category] = TYPE_SPECIFIC[code];
    return { code, label, category, hazardous: null };
  }
  const tens = Math.floor(code / 10);
  const units = code % 10;
  const category = TYPE_CATEGORIES[tens];
  if (!category || code < 20 || code > 99)
    return {
      code,
      label: `Reserved type ${code}`,
      category: 'unknown',
      hazardous: null,
    };
  const [base, key] = category;
  const hazardous = HAZARD_CLASSES[units] || null;
  const suffix =
    units === 0
      ? ''
      : hazardous
        ? ` — hazardous cargo category ${hazardous}`
        : units === 9
          ? ' — no additional information'
          : ' — reserved subtype';
  return { code, label: `${base}${suffix}`, category: key, hazardous };
}

/**
 * ITU maritime identification digits → flag state. Transcribed from the ITU
 * MID allocation table (Recommendation ITU-R M.585 / Table of MIDs).
 */
export const MID_TABLE = Object.freeze({
  201: 'Albania',
  202: 'Andorra',
  203: 'Austria',
  204: 'Portugal (Azores)',
  205: 'Belgium',
  206: 'Belarus',
  207: 'Bulgaria',
  208: 'Vatican City',
  209: 'Cyprus',
  210: 'Cyprus',
  211: 'Germany',
  212: 'Cyprus',
  213: 'Georgia',
  214: 'Moldova',
  215: 'Malta',
  216: 'Armenia',
  218: 'Germany',
  219: 'Denmark',
  220: 'Denmark',
  224: 'Spain',
  225: 'Spain',
  226: 'France',
  227: 'France',
  228: 'France',
  229: 'Malta',
  230: 'Finland',
  231: 'Faroe Islands',
  232: 'United Kingdom',
  233: 'United Kingdom',
  234: 'United Kingdom',
  235: 'United Kingdom',
  236: 'Gibraltar',
  237: 'Greece',
  238: 'Croatia',
  239: 'Greece',
  240: 'Greece',
  241: 'Greece',
  242: 'Morocco',
  243: 'Hungary',
  244: 'Netherlands',
  245: 'Netherlands',
  246: 'Netherlands',
  247: 'Italy',
  248: 'Malta',
  249: 'Malta',
  250: 'Ireland',
  251: 'Iceland',
  252: 'Liechtenstein',
  253: 'Luxembourg',
  254: 'Monaco',
  255: 'Portugal (Madeira)',
  256: 'Malta',
  257: 'Norway',
  258: 'Norway',
  259: 'Norway',
  261: 'Poland',
  262: 'Montenegro',
  263: 'Portugal',
  264: 'Romania',
  265: 'Sweden',
  266: 'Sweden',
  267: 'Slovakia',
  268: 'San Marino',
  269: 'Switzerland',
  270: 'Czech Republic',
  271: 'Türkiye',
  272: 'Ukraine',
  273: 'Russia',
  274: 'North Macedonia',
  275: 'Latvia',
  276: 'Estonia',
  277: 'Lithuania',
  278: 'Slovenia',
  279: 'Serbia',
  301: 'Anguilla',
  303: 'United States (Alaska)',
  304: 'Antigua and Barbuda',
  305: 'Antigua and Barbuda',
  306: 'Curaçao / Sint Maarten / Caribbean Netherlands',
  307: 'Aruba',
  308: 'Bahamas',
  309: 'Bahamas',
  310: 'Bermuda',
  311: 'Bahamas',
  312: 'Belize',
  314: 'Barbados',
  316: 'Canada',
  319: 'Cayman Islands',
  321: 'Costa Rica',
  323: 'Cuba',
  325: 'Dominica',
  327: 'Dominican Republic',
  329: 'Guadeloupe',
  330: 'Grenada',
  331: 'Greenland',
  332: 'Guatemala',
  334: 'Honduras',
  336: 'Haiti',
  338: 'United States',
  339: 'Jamaica',
  341: 'Saint Kitts and Nevis',
  343: 'Saint Lucia',
  345: 'Mexico',
  347: 'Martinique',
  348: 'Montserrat',
  350: 'Nicaragua',
  351: 'Panama',
  352: 'Panama',
  353: 'Panama',
  354: 'Panama',
  355: 'Panama',
  356: 'Panama',
  357: 'Panama',
  358: 'Puerto Rico',
  359: 'El Salvador',
  361: 'Saint Pierre and Miquelon',
  362: 'Trinidad and Tobago',
  364: 'Turks and Caicos Islands',
  366: 'United States',
  367: 'United States',
  368: 'United States',
  369: 'United States',
  370: 'Panama',
  371: 'Panama',
  372: 'Panama',
  373: 'Panama',
  374: 'Panama',
  375: 'Saint Vincent and the Grenadines',
  376: 'Saint Vincent and the Grenadines',
  377: 'Saint Vincent and the Grenadines',
  378: 'British Virgin Islands',
  379: 'United States Virgin Islands',
  401: 'Afghanistan',
  403: 'Saudi Arabia',
  405: 'Bangladesh',
  408: 'Bahrain',
  410: 'Bhutan',
  412: 'China',
  413: 'China',
  414: 'China',
  416: 'Taiwan',
  417: 'Sri Lanka',
  419: 'India',
  422: 'Iran',
  423: 'Azerbaijan',
  425: 'Iraq',
  428: 'Israel',
  431: 'Japan',
  432: 'Japan',
  434: 'Turkmenistan',
  436: 'Kazakhstan',
  437: 'Uzbekistan',
  438: 'Jordan',
  440: 'South Korea',
  441: 'South Korea',
  443: 'Palestine',
  445: 'North Korea',
  447: 'Kuwait',
  450: 'Lebanon',
  451: 'Kyrgyzstan',
  453: 'Macao',
  455: 'Maldives',
  457: 'Mongolia',
  459: 'Nepal',
  461: 'Oman',
  463: 'Pakistan',
  466: 'Qatar',
  468: 'Syria',
  470: 'United Arab Emirates',
  471: 'United Arab Emirates',
  472: 'Tajikistan',
  473: 'Yemen',
  475: 'Yemen',
  477: 'Hong Kong',
  478: 'Bosnia and Herzegovina',
  501: 'Adélie Land (France)',
  503: 'Australia',
  506: 'Myanmar',
  508: 'Brunei',
  510: 'Micronesia',
  511: 'Palau',
  512: 'New Zealand',
  514: 'Cambodia',
  515: 'Cambodia',
  516: 'Christmas Island',
  518: 'Cook Islands',
  520: 'Fiji',
  523: 'Cocos (Keeling) Islands',
  525: 'Indonesia',
  529: 'Kiribati',
  531: 'Laos',
  533: 'Malaysia',
  536: 'Northern Mariana Islands',
  538: 'Marshall Islands',
  540: 'New Caledonia',
  542: 'Niue',
  544: 'Nauru',
  546: 'French Polynesia',
  548: 'Philippines',
  550: 'Timor-Leste',
  553: 'Papua New Guinea',
  555: 'Pitcairn Islands',
  557: 'Solomon Islands',
  559: 'American Samoa',
  561: 'Samoa',
  563: 'Singapore',
  564: 'Singapore',
  565: 'Singapore',
  566: 'Singapore',
  567: 'Thailand',
  570: 'Tonga',
  572: 'Tuvalu',
  574: 'Vietnam',
  576: 'Vanuatu',
  577: 'Vanuatu',
  578: 'Wallis and Futuna',
  601: 'South Africa',
  603: 'Angola',
  605: 'Algeria',
  607: 'Saint Paul and Amsterdam Islands',
  608: 'Ascension Island',
  609: 'Burundi',
  610: 'Benin',
  611: 'Botswana',
  612: 'Central African Republic',
  613: 'Cameroon',
  615: 'Congo',
  616: 'Comoros',
  617: 'Cabo Verde',
  618: 'Crozet Archipelago',
  619: "Côte d'Ivoire",
  620: 'Comoros',
  621: 'Djibouti',
  622: 'Egypt',
  624: 'Ethiopia',
  625: 'Eritrea',
  626: 'Gabon',
  627: 'Ghana',
  629: 'Gambia',
  630: 'Guinea-Bissau',
  631: 'Equatorial Guinea',
  632: 'Guinea',
  633: 'Burkina Faso',
  634: 'Kenya',
  635: 'Kerguelen Islands',
  636: 'Liberia',
  637: 'Liberia',
  638: 'South Sudan',
  642: 'Libya',
  644: 'Lesotho',
  645: 'Mauritius',
  647: 'Madagascar',
  649: 'Mali',
  650: 'Mozambique',
  654: 'Mauritania',
  655: 'Malawi',
  656: 'Niger',
  657: 'Nigeria',
  659: 'Namibia',
  660: 'Réunion',
  661: 'Rwanda',
  662: 'Sudan',
  663: 'Senegal',
  664: 'Seychelles',
  665: 'Saint Helena',
  666: 'Somalia',
  667: 'Sierra Leone',
  668: 'São Tomé and Príncipe',
  669: 'Eswatini',
  670: 'Chad',
  671: 'Togo',
  672: 'Tunisia',
  674: 'Tanzania',
  675: 'Uganda',
  676: 'DR Congo',
  677: 'Tanzania',
  678: 'Zambia',
  679: 'Zimbabwe',
  701: 'Argentina',
  710: 'Brazil',
  720: 'Bolivia',
  725: 'Chile',
  730: 'Colombia',
  735: 'Ecuador',
  740: 'Falkland Islands',
  745: 'French Guiana',
  750: 'Guyana',
  755: 'Paraguay',
  760: 'Peru',
  765: 'Suriname',
  770: 'Uruguay',
  775: 'Venezuela',
});

/**
 * Flag state and station kind from an MMSI.
 * @param {string|number} mmsi
 * @returns {{mmsi: string, mid: string|null, country: string|null, kind: string}}
 */
export function flagFromMmsi(mmsi) {
  const id = text(mmsi).replace(/\D/g, '');
  const result = { mmsi: id, mid: null, country: null, kind: 'unknown' };
  if (id.length !== 9) return result;
  let midStart = 0;
  if (id.startsWith('00')) {
    result.kind = 'coast-station';
    midStart = 2;
  } else if (id.startsWith('0')) {
    result.kind = 'group';
    midStart = 1;
  } else if (id.startsWith('111')) {
    result.kind = 'sar-aircraft';
    midStart = 3;
  } else if (id.startsWith('99')) {
    result.kind = 'aton';
    midStart = 2;
  } else if (id.startsWith('98')) {
    result.kind = 'craft';
    midStart = 2;
  } else if (id.startsWith('970')) {
    result.kind = 'sar-transponder';
    return result;
  } else if (id.startsWith('972')) {
    result.kind = 'man-overboard';
    return result;
  } else if (id.startsWith('974')) {
    result.kind = 'epirb';
    return result;
  } else {
    result.kind = 'ship';
  }
  const mid = id.slice(midStart, midStart + 3);
  result.mid = mid;
  result.country = MID_TABLE[Number(mid)] || null;
  return result;
}

let sanctionsPromise = null;

/**
 * Lazily load the bundled OpenSanctions vessel index. Absent or unreadable
 * data resolves to null so the card renders without a sanctions verdict.
 * @param {{fetchImpl?: Function, url?: string|URL}} [options]
 * @returns {Promise<object|null>}
 */
export function loadSanctionsIndex({ fetchImpl, url } = {}) {
  if (!sanctionsPromise) {
    sanctionsPromise = (async () => {
      try {
        const target =
          url ||
          new URL(
            '../data/local_data/sanctioned_vessels/sanctioned_vessels.json',
            import.meta.url,
          );
        const fetcher = fetchImpl || ((...args) => globalThis.fetch(...args));
        const response = await fetcher(target);
        if (!response?.ok) return null;
        const index = await response.json();
        return index && typeof index === 'object' ? index : null;
      } catch {
        return null;
      }
    })();
  }
  return sanctionsPromise;
}

/** Test seam: forget a cached index. */
export function resetSanctionsIndexForTest() {
  sanctionsPromise = null;
}

function resolveIndexed(index, value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  const list = Array.isArray(index?.vessels) ? index.vessels : [];
  if (typeof value === 'number') return list[value] || null;
  return list.find((entry) => entry?.id === value) || null;
}

/**
 * Match a vessel against the bundled index by IMO, then MMSI.
 * @param {object|null} index `{byImo, byMmsi, vessels}`.
 * @param {{imo?: string, mmsi?: string}} vessel
 * @returns {object|null} Matched record with `matchedBy`.
 */
export function matchSanctionedVessel(index, { imo, mmsi } = {}) {
  if (!index || typeof index !== 'object') return null;
  const imoKey = text(imo).replace(/\D/g, '');
  if (imoKey && imoKey !== '0' && index.byImo) {
    const hit = resolveIndexed(index, index.byImo[imoKey]);
    if (hit) return { ...hit, matchedBy: 'IMO' };
  }
  const mmsiKey = text(mmsi).replace(/\D/g, '');
  if (mmsiKey && index.byMmsi) {
    const hit = resolveIndexed(index, index.byMmsi[mmsiKey]);
    if (hit) return { ...hit, matchedBy: 'MMSI' };
  }
  return null;
}

/** Accept a layer record, a context-store record, or a display row. */
function normalizeLive(live) {
  if (!live || typeof live !== 'object') return null;
  const props =
    live.properties && typeof live.properties === 'object'
      ? live.properties
      : {};
  const mmsi = text(props.mmsi || live.mmsi || live.id).replace(/^ais-/, '');
  const lastEpoch =
    finite(live.lastPositionEpoch) ??
    finite(live.last_position_epoch) ??
    (text(live.lastPositionUtc || live.last_position_UTC)
      ? Date.parse(live.lastPositionUtc || live.last_position_UTC) / 1000
      : null);
  return {
    mmsi,
    name: text(live.name || live.label || props.name),
    imo: text(live.imo || props.imo).replace(/^IMO\s*/i, ''),
    callsign: text(live.callsign || props.callsign),
    type: props.type ?? live.type ?? '',
    destination: text(live.destination || props.destination),
    speedKt:
      finite(live.speed) ?? finite(props.speedKt) ?? finite(live.speedKt),
    courseDeg: finite(live.course) ?? finite(props.course),
    headingDeg: finite(live.heading) ?? finite(props.heading),
    lat: finite(live.lat) ?? finite(live.latitude),
    lon: finite(live.lon) ?? finite(live.longitude),
    lastPositionMs: Number.isFinite(lastEpoch) ? lastEpoch * 1000 : null,
    draughtM: finite(live.draught || props.draught),
    lengthM: finite(live.length || props.length),
    beamM: finite(live.beam || props.beam),
    eta: text(live.eta || props.eta),
    navStatus: text(live.navStatus || props.navStatus),
  };
}

function ageText(ms, nowMs) {
  if (!Number.isFinite(ms) || !Number.isFinite(nowMs)) return '';
  const abs = Math.max(0, nowMs - ms);
  if (abs < 90_000) return `${Math.round(abs / 1000)} s ago`;
  if (abs < 5_400_000) return `${Math.round(abs / 60_000)} min ago`;
  if (abs < 172_800_000) return `${(abs / 3_600_000).toFixed(1)} h ago`;
  return `${(abs / 86_400_000).toFixed(1)} d ago`;
}

const CATEGORY_ACCENT = Object.freeze({
  military: '#ffb347',
  law: '#ff7a59',
  sar: '#ff5c5c',
  tanker: '#ff9f43',
  cargo: '#4fd8ff',
  passenger: '#9be564',
  fishing: '#7fd1ae',
  tug: '#c8d0d8',
  pilot: '#c8d0d8',
  hsc: '#9fb3ff',
  wig: '#9fb3ff',
  sailing: '#ffe08a',
  pleasure: '#ffe08a',
});

/**
 * Build the vessel intel model.
 * @param {{live: object, sanctions?: object|null, nowMs?: number}} options
 *   `sanctions` is the bundled index from `loadSanctionsIndex()` (or a
 *   pre-matched hit with `matchedBy`), `live` the selected vessel record.
 * @returns {object|null} IntelModel, or null without a vessel.
 */
export function buildVesselIntelModel({
  live,
  sanctions = null,
  nowMs = Date.now(),
} = {}) {
  const vessel = normalizeLive(live);
  if (!vessel || (!vessel.mmsi && !vessel.name)) return null;
  const shipType = decodeAisShipType(vessel.type);
  const flag = flagFromMmsi(vessel.mmsi);
  const sanctionHit =
    sanctions && sanctions.matchedBy
      ? sanctions
      : matchSanctionedVessel(sanctions, {
          imo: vessel.imo,
          mmsi: vessel.mmsi,
        });
  const positionAge =
    vessel.lastPositionMs !== null ? nowMs - vessel.lastPositionMs : null;
  const dark = positionAge !== null && positionAge > DARK_AFTER_MS;
  const name =
    vessel.name && vessel.name !== vessel.mmsi
      ? vessel.name
      : `MMSI ${vessel.mmsi}`;
  const sections = [];
  const notes = [];

  const identity = [
    { label: 'Name', value: name },
    { label: 'MMSI', value: vessel.mmsi || '—', mono: true },
    {
      label: 'IMO',
      value: vessel.imo && vessel.imo !== '0' ? vessel.imo : '—',
      mono: true,
    },
  ];
  if (vessel.callsign)
    identity.push({ label: 'Call sign', value: vessel.callsign, mono: true });
  identity.push({
    label: 'Flag (MMSI MID)',
    value: flag.country
      ? `${flag.country} (MID ${flag.mid})`
      : flag.kind === 'ship'
        ? `Unallocated MID ${flag.mid || '—'}`
        : `${flag.kind.replace(/-/g, ' ')} identity`,
  });
  if (flag.kind !== 'ship')
    notes.push(
      'The MMSI is not a ship station identity; treat position reports accordingly.',
    );
  if (Number.isFinite(vessel.lengthM) || Number.isFinite(vessel.beamM))
    identity.push({
      label: 'Dimensions',
      value: `${fmt(vessel.lengthM)} m × ${fmt(vessel.beamM)} m`,
    });
  if (Number.isFinite(vessel.draughtM))
    identity.push({ label: 'Draught', value: `${fmt(vessel.draughtM, 1)} m` });
  sections.push({ heading: 'IDENTITY', rows: identity });

  const voyage = [];
  voyage.push({ label: 'Destination', value: vessel.destination || '—' });
  if (vessel.eta) voyage.push({ label: 'ETA', value: vessel.eta });
  if (vessel.navStatus)
    voyage.push({ label: 'Nav status', value: vessel.navStatus });
  voyage.push({
    label: 'Speed',
    value: Number.isFinite(vessel.speedKt)
      ? `${fmt(vessel.speedKt, 1)} kn (${fmt(vessel.speedKt * 1.852, 0)} km/h)`
      : '—',
  });
  voyage.push({
    label: 'Course / heading',
    value: `${Number.isFinite(vessel.courseDeg) ? `${fmt(vessel.courseDeg, 0)}°` : '—'} / ${Number.isFinite(vessel.headingDeg) ? `${fmt(vessel.headingDeg, 0)}°` : '—'}`,
  });
  if (Number.isFinite(vessel.lat) && Number.isFinite(vessel.lon))
    voyage.push({
      label: 'Last position',
      value: `${fmt(vessel.lat, 4)}°, ${fmt(vessel.lon, 4)}°`,
      mono: true,
    });
  if (vessel.lastPositionMs !== null)
    voyage.push({
      label: 'Reported',
      value: `${new Date(vessel.lastPositionMs).toISOString().replace('T', ' ').slice(0, 16)} UTC (${ageText(vessel.lastPositionMs, nowMs)})`,
    });
  sections.push({ heading: 'VOYAGE', rows: voyage });

  const classification = [
    {
      label: 'AIS ship type',
      value:
        shipType.code !== null
          ? `${shipType.label} (${shipType.code})`
          : shipType.label,
    },
    {
      label: 'Category',
      value:
        shipType.category === 'unknown' ? '—' : shipType.category.toUpperCase(),
    },
  ];
  if (shipType.hazardous)
    classification.push({
      label: 'Hazardous cargo',
      value: `Category ${shipType.hazardous}`,
    });
  classification.push({
    label: 'Note',
    value: 'Type and dimensions are self-reported by the vessel transponder.',
  });
  sections.push({ heading: 'CLASSIFICATION', rows: classification });

  const sanctionRows = [];
  if (sanctionHit) {
    sanctionRows.push({
      label: 'Match',
      value: `Listed vessel (matched by ${sanctionHit.matchedBy})`,
    });
    if (
      sanctionHit.name &&
      text(sanctionHit.name).toUpperCase() !== name.toUpperCase()
    )
      sanctionRows.push({
        label: 'Listed name',
        value: text(sanctionHit.name),
      });
    if (Array.isArray(sanctionHit.programs) && sanctionHit.programs.length)
      sanctionRows.push({
        label: 'Programs',
        value: truncate(sanctionHit.programs.join(', '), 160),
      });
    if (Array.isArray(sanctionHit.datasets) && sanctionHit.datasets.length)
      sanctionRows.push({
        label: 'Lists',
        value: truncate(sanctionHit.datasets.join(', '), 160),
      });
    if (Array.isArray(sanctionHit.sanctions) && sanctionHit.sanctions.length)
      sanctionRows.push({
        label: 'Measures',
        value: truncate(sanctionHit.sanctions.join('; '), 200),
      });
    if (sanctionHit.flag)
      sanctionRows.push({
        label: 'Listed flag',
        value: text(sanctionHit.flag),
      });
    if (sanctionHit.lastSeen)
      sanctionRows.push({
        label: 'Last seen in lists',
        value: text(sanctionHit.lastSeen),
      });
    if (safeHttpUrl(sanctionHit.url))
      sanctionRows.push({
        label: 'Source record',
        value: 'OpenSanctions',
        href: safeHttpUrl(sanctionHit.url),
      });
  } else if (sanctions) {
    sanctionRows.push({
      label: 'Match',
      value: `No match by IMO/MMSI in the bundled lists${text(sanctions.generatedAt) ? ` (as of ${text(sanctions.generatedAt).slice(0, 10)})` : ''}`,
    });
  } else {
    sanctionRows.push({ label: 'Match', value: 'Sanctions index not loaded' });
  }
  sections.push({ heading: 'SANCTIONS SCREEN', rows: sanctionRows });

  const badges = [];
  if (sanctionHit) badges.push({ label: 'SANCTIONED', tone: 'alert' });
  if (dark) badges.push({ label: 'DARK', tone: 'warn' });
  if (shipType.category === 'military')
    badges.push({ label: 'MILITARY', tone: 'alert' });
  if (shipType.category === 'law')
    badges.push({ label: 'LAW ENFORCEMENT', tone: 'warn' });
  if (shipType.category === 'sar') badges.push({ label: 'SAR', tone: 'warn' });
  if (shipType.hazardous)
    badges.push({ label: `HAZMAT ${shipType.hazardous}`, tone: 'warn' });
  if (!badges.length && shipType.category !== 'unknown')
    badges.push({ label: shipType.category.toUpperCase(), tone: 'neutral' });
  if (dark)
    notes.push(
      `No AIS position for ${ageText(vessel.lastPositionMs, nowMs).replace(' ago', '')}: the transponder may be off, out of receiver range, or spoofed.`,
    );

  const links = [];
  const imo = vessel.imo && vessel.imo !== '0' ? vessel.imo : '';
  if (imo) {
    links.push({
      label: 'VesselFinder',
      href: `https://www.vesselfinder.com/vessels/details/${encodeURIComponent(imo)}`,
    });
    links.push({
      label: 'BalticShipping',
      href: `https://www.balticshipping.com/vessel/imo/${encodeURIComponent(imo)}`,
    });
  } else if (vessel.mmsi) {
    links.push({
      label: 'VesselFinder',
      href: `https://www.vesselfinder.com/?mmsi=${encodeURIComponent(vessel.mmsi)}`,
    });
  }
  if (vessel.mmsi)
    links.push({
      label: 'MarineTraffic search',
      href: `https://www.marinetraffic.com/en/ais/index/search/all?keyword=${encodeURIComponent(vessel.mmsi)}`,
    });
  if (imo || vessel.mmsi)
    links.push({
      label: 'OpenSanctions search',
      href: `https://www.opensanctions.org/search/?q=${encodeURIComponent(imo || vessel.mmsi)}`,
    });
  if (imo)
    notes.push(
      'Equasis (login required) holds inspection and ownership history for this IMO number.',
    );
  notes.push(
    'Live data: AIS via AISStream. Sanctions: bundled OpenSanctions vessel extract (non-commercial licence).',
  );

  return createIntelModel({
    kind: 'vessel',
    id: `vessel:${vessel.mmsi || name}`,
    title: truncate(name, 80),
    subtitle: [
      shipType.label.split(' — ')[0],
      flag.country,
      vessel.destination ? `→ ${vessel.destination}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    accent: sanctionHit
      ? '#ff5c5c'
      : CATEGORY_ACCENT[shipType.category] || '#9fb3c4',
    badges,
    photo: null,
    sections,
    links,
    raw: { vessel, shipType, flag, sanctionHit },
    fetchedAt: null,
    notes,
  });
}

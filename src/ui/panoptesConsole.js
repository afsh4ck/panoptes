import * as Cesium from 'cesium';
import { BRAND } from '../brand.js';
import { createThemeController, bindThemeToggle } from './theme.js';
import { createIntelPanel } from './intelPanel.js';
import { createAlertsPanel } from './alertsPanel.js';
import { createCasePanel } from './casePanel.js';
import { createCommandPalette } from './commandPalette.js';
import { createExportMenu } from './exportMenu.js';
import { layerPanelGroup } from './layerPanel.js';
import { createZoneStore } from '../alerts/zones.js';
import { createAlertStore } from '../alerts/store.js';
import { createAlertEngine } from '../alerts/engine.js';
import { buildSituationReport, reportFilename } from '../tools/report.js';
import { collectLayerRecords } from '../tools/exportLayers.js';
import { downloadText } from '../tools/download.js';
import {
  getSelectedEntityContext,
  registerEntityContext,
  selectEntityContext,
} from '../data/contextStore.js';
import { isPointerFree } from '../data/inputOwnership.js';
import { STRATEGIC_LAYER_SPECS } from '../data/strategicLayers.js';
import { hasRealName } from '../layers/strategicSites/model.js';
import {
  fetchAircraftIntel,
  buildAircraftIntelModel,
} from '../intel/aircraftIntel.js';
import {
  fetchSatelliteIntel,
  buildSatelliteIntelModel,
} from '../intel/satelliteIntel.js';
import {
  buildVesselIntelModel,
  loadSanctionsIndex,
} from '../intel/vesselIntel.js';
import { buildLaunchIntelModel } from '../intel/launchIntel.js';
import { buildSiteIntelModel } from '../intel/siteIntel.js';
import { fetchSiteWikidata } from '../intel/siteWikidata.js';
import { buildEventIntelModel } from '../intel/eventIntel.js';
import {
  eventContextFor,
  eventLayerFor,
  eventSelectionId,
} from '../intel/eventSelection.js';
import {
  NEARBY_RADIUS_KM,
  nearbyEntries,
  nearbySection,
  positionOf,
} from '../intel/nearby.js';
import { shouldAutoEnableBuildings } from '../layers/buildings3d/records.js';
import { createFlightRouteOverlay } from './flightRouteOverlay.js';
import { formatDuration, formatUtcTime } from './flightRouteModel.js';
import { createDroneMode } from './droneMode.js';
import { createBasemapDimmer } from './basemapDim.js';
import { createCctvCatalogBar } from './cctvCatalogBar.js';
import { createRoutePlanner } from './routePlanner.js';
import { installZonePersistence } from '../annotations/zonePersistence.js';
import { fetchVesselPhoto } from '../intel/vesselPhoto.js';
import { createTileQuality } from './tileQuality.js';
import { createDayNight } from './dayNight.js';
import { TILE_QUALITY_LEVELS } from './tileQualityModel.js';

const BUILDINGS_LAYER_ID = 'osm-buildings-3d';
const BUILDINGS_AUTO_KEY = 'panoptes:buildings-auto:v1';
/** Set when the operator explicitly picks a flat map while photoreal is available. */
const MAP_USER_FLAT_KEY = 'panoptes:map-user-flat:v1';
const REGION_NOTICE_KEY = 'panoptes:google-eea-notice:v1';

/**
 * @module panoptesConsole
 * @description Composition owner for the PANOPTES console surfaces that sit on
 * top of the inherited shell: theme, INTEL / ALERTS / CASE rail panels, the
 * Ctrl+K command palette and the layer export menu. The shell constructs it
 * once, hands it the data manager when the catalog is registered, and
 * destroys it on dispose. Nothing here owns a layer or a data source.
 */

/** Strategic datasets indexed for the command palette (largest last). */
const PALETTE_SITE_LAYERS = Object.freeze([
  ['strategic-chokepoints', 'chokepoint', 200],
  ['strategic-nuclear-sites', 'nuclear', 3000],
  ['strategic-military-bases', 'base', 20000],
  ['strategic-volcanoes', 'volcano', 2000],
  ['strategic-ports', 'port', 5000],
]);

function safeStorage(windowRef) {
  try {
    return windowRef?.localStorage || null;
  } catch {
    return null;
  }
}

/** Read one bundled GeoJSONL file into palette rows; never throws. */
async function loadSiteRows(spec, kind, cap, signal) {
  try {
    const response = await fetch(spec.url, { signal });
    if (!response.ok) return [];
    const text = await response.text();
    const rows = [];
    for (const line of text.split('\n')) {
      if (rows.length >= cap) break;
      if (!line.trim()) continue;
      let feature;
      try {
        feature = JSON.parse(line);
      } catch {
        continue;
      }
      const [lon, lat] = feature?.geometry?.coordinates || [];
      const name = String(feature?.properties?.name || '').trim();
      if (!hasRealName(name) || !Number.isFinite(lat) || !Number.isFinite(lon))
        continue;
      rows.push({
        id: `${spec.id}:${feature.id ?? rows.length}`,
        name,
        lat,
        lon,
        kind,
        subtitle: feature.properties.subtitle || spec.name,
      });
    }
    return rows;
  } catch {
    return [];
  }
}

/**
 * Create the console. Every surface is optional: a missing template node
 * simply skips that surface.
 * @param {object} options
 * @param {Cesium.Viewer} options.viewer
 * @param {Document} options.document
 * @param {object} options.services Shell services (layers, CITY_POIS, flyToGlobeView).
 * @param {object} options.actions Shell callbacks: showToast, scheduleLayout,
 *   setPanelCollapsed(id, collapsed), setStyle(style), toggleHud().
 * @param {object|null} [options.placeSearch] `{geocode(query, {signal})}`.
 */
export function createPanoptesConsole({
  viewer,
  document,
  services = {},
  actions = {},
  placeSearch = null,
}) {
  const windowRef = document.defaultView || globalThis.window;
  const storage = safeStorage(windowRef);
  const lifetime = new AbortController();
  let dataManager = null;
  const toast = (text) => actions.showToast?.(text);
  const byId = (id) => document.getElementById(id);

  // ── Camera helpers ────────────────────────────────────────────────
  function cameraCenter() {
    const carto = viewer?.camera?.positionCartographic;
    if (!carto) return null;
    return {
      lat: Cesium.Math.toDegrees(carto.latitude),
      lon: Cesium.Math.toDegrees(carto.longitude),
      altM: carto.height,
      heading: Cesium.Math.toDegrees(viewer.camera.heading),
      pitch: Cesium.Math.toDegrees(viewer.camera.pitch),
    };
  }

  /** Fly so the target sits in view at `rangeM`, looking at it obliquely. */
  function flyTo({ lat, lon, rangeM, altM, heading = 0, pitch = -55 } = {}) {
    if (!viewer || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const range = Number.isFinite(rangeM)
      ? rangeM
      : Number.isFinite(altM)
        ? altM
        : 60_000;
    viewer.trackedEntity = undefined;
    viewer.camera.cancelFlight();
    viewer.camera.flyToBoundingSphere(
      new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(lon, lat), 1),
      {
        offset: new Cesium.HeadingPitchRange(
          Cesium.Math.toRadians(heading),
          Cesium.Math.toRadians(Math.min(-10, pitch)),
          Math.max(500, range),
        ),
        duration: 1.8,
      },
    );
  }

  // ── Layer access (the manager's rows plus their module methods) ─────
  function layerModule(id) {
    return dataManager?.layers?.get?.(id)?.module || null;
  }
  function layerRows() {
    const rows = dataManager?.getAll?.() || [];
    return rows.map((row) => {
      const module = layerModule(row.id);
      return {
        ...row,
        getAnalystRecords:
          typeof module?.getAnalystRecords === 'function'
            ? (max) => module.getAnalystRecords(max)
            : undefined,
      };
    });
  }
  const catalog = { get: (id) => layerModule(id) || undefined };

  // ── Theme ─────────────────────────────────────────────────────────
  // Dark only: no stored preference and no OS light-mode following.
  const theme = createThemeController({
    document,
    storage: null,
    windowRef: null,
  });
  const releaseThemeToggle = bindThemeToggle(byId('theme-toggle'), theme);

  // ── INTEL ─────────────────────────────────────────────────────────
  /** Wikidata label languages, the interface language first. */
  const wikidataLanguages = () =>
    /^es\b/i.test(document.documentElement?.lang || 'es')
      ? ['es', 'en']
      : ['en', 'es'];

  /** NEARBY: what the enabled layers hold around the dossier's subject. */
  function nearbyFor({ subject, live, model } = {}) {
    const origin = [live, subject, subject?.record, model?.raw]
      .map(positionOf)
      .find(Boolean);
    if (!origin) return null;
    const collections = collectLayerRecords({
      layers: layerRows(),
      maxPerLayer: 20_000,
    });
    return nearbySection(
      nearbyEntries(origin, collections, { subjectLayerId: subject?.layerId }),
      { radiusKm: NEARBY_RADIUS_KM },
    );
  }

  const intel = createIntelPanel({
    document,
    root: byId('intel-panel'),
    rail: byId('right-context-rail'),
    services: {
      aircraft: { fetch: fetchAircraftIntel, build: buildAircraftIntelModel },
      satellite: {
        fetch: fetchSatelliteIntel,
        // The panel hands the camera center as {lat, lon}; the builder takes
        // an observer in degrees plus a precomputed next pass when available.
        build: (input = {}) => {
          const center = input.observer || null;
          const observer =
            center && Number.isFinite(center.lat) && Number.isFinite(center.lon)
              ? {
                  latDeg: center.lat,
                  lonDeg: center.lon,
                  label: 'Camera center',
                }
              : null;
          const tracked = services.satellitesLayer?.getTrackedSatellite?.();
          let nextPass = null;
          try {
            nextPass =
              observer && tracked
                ? services.satellitesLayer?.getNextSatellitePass?.(
                    tracked.noradId,
                    observer,
                  ) || null
                : null;
          } catch {
            nextPass = null;
          }
          return buildSatelliteIntelModel({
            ...input,
            observer,
            nextPass,
            satrec: input.satrec || tracked?.satrec,
          });
        },
      },
      vessel: {
        // The AIS dossier, plus an open-source photo (Wikidata by IMO/MMSI,
        // else a Commons file whose name matches the vessel).
        build: async (input = {}) => {
          const model = buildVesselIntelModel(input);
          if (!model || model.photo) return model;
          const record = input.vessel || input.live || {};
          const props = record.properties || {};
          const photo = await fetchVesselPhoto(
            {
              imo: record.imo || props.imo,
              mmsi: String(
                props.mmsi || record.mmsi || record.id || '',
              ).replace(/^ais-/, ''),
              name: record.name || props.name || model.title,
            },
            { signal: input.signal },
          ).catch(() => null);
          return photo ? { ...model, photo } : model;
        },
        loadSanctions: loadSanctionsIndex,
      },
      launch: { build: buildLaunchIntelModel },
      site: {
        fetch: (options) =>
          fetchSiteWikidata({ ...options, languages: wikidataLanguages() }),
        build: buildSiteIntelModel,
      },
      event: { build: buildEventIntelModel },
      nearby: nearbyFor,
      getSelectedEntityContext: () => getSelectedEntityContext({ dataManager }),
      getTrackedSatellite: () =>
        services.satellitesLayer?.getTrackedSatellite?.() ?? null,
      getSelectedVessel: () =>
        services.aisLiveVesselsLayer?.getSelectedVessel?.() ?? null,
      getSelectedLaunch: () =>
        services.rocketLaunchesLayer?.getSelectedLaunch?.() ?? null,
      observer: () => cameraCenter(),
    },
    actions: {
      showToast: toast,
      scheduleLayout: () => actions.scheduleLayout?.(),
      flyTo: ({ lat, lon }) => flyTo({ lat, lon, rangeM: 40_000 }),
      // A NEARBY camera opens in the CAMERAS panel and the view flies to it.
      openCamera: (cameraId) => {
        if (!layerModule('cctv')?.selectCamera?.(cameraId, { focus: true }))
          toast('Camera unavailable');
      },
    },
  });

  // ── Event markers → INTEL ─────────────────────────────────────────
  // Earthquakes, disaster alerts, conflict events, cyclones and GPS
  // interference cells have no click handling of their own: a click on one
  // publishes it as the selection, so INTEL opens its event dossier.
  const toDegrees = (cartographic) =>
    cartographic
      ? {
          lat: Cesium.Math.toDegrees(cartographic.latitude),
          lon: Cesium.Math.toDegrees(cartographic.longitude),
        }
      : null;
  function entityPosition(entity, time) {
    const cartesian = entity.position?.getValue?.(time);
    if (cartesian)
      return toDegrees(Cesium.Cartographic.fromCartesian(cartesian));
    const rectangle = entity.rectangle?.coordinates?.getValue?.(time);
    return rectangle ? toDegrees(Cesium.Rectangle.center(rectangle)) : null;
  }
  const eventClicks = viewer?.scene?.canvas
    ? new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    : null;
  eventClicks?.setInputAction((click) => {
    if (!isPointerFree()) return;
    const entity = viewer.scene.pick(click.position)?.id;
    if (!(entity instanceof Cesium.Entity) || !eventLayerFor(entity.id)) return;
    const time = viewer.clock?.currentTime || Cesium.JulianDate.now();
    // A cyclone's track or cone selects its centre marker, which carries the data.
    const marker =
      entity.entityCollection?.getById?.(eventSelectionId(entity.id)) || entity;
    const context = eventContextFor({
      id: marker.id,
      name: marker.name,
      properties: marker.properties?.getValue?.(time) || {},
      position: entityPosition(marker, time) || entityPosition(entity, time),
    });
    if (!context) return;
    registerEntityContext(marker, context);
    selectEntityContext(marker);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  // ── ALERTS ────────────────────────────────────────────────────────
  const zones = createZoneStore({ storage });
  const alertStore = createAlertStore({ storage });
  const engine = createAlertEngine({
    catalog,
    getLayers: () => dataManager?.getAll?.() || [],
    zones,
    store: alertStore,
    windowRef,
    cesiumFromDegrees: (lon, lat) => Cesium.Cartesian3.fromDegrees(lon, lat),
    cesiumToDegrees: (cartesian) => {
      const carto = Cesium.Cartographic.fromCartesian(cartesian);
      return carto
        ? {
            lat: Cesium.Math.toDegrees(carto.latitude),
            lon: Cesium.Math.toDegrees(carto.longitude),
          }
        : null;
    },
  });
  const alerts = createAlertsPanel({
    document,
    root: byId('alerts-panel'),
    engine,
    zones,
    store: alertStore,
    actions: {
      showToast: toast,
      flyTo: ({ lat, lon, rangeM }) =>
        flyTo({ lat, lon, rangeM: rangeM || 150_000 }),
      getCameraCenter: cameraCenter,
      scheduleLayout: () => actions.scheduleLayout?.(),
    },
  });

  // ── Report + CASE ─────────────────────────────────────────────────
  function situationReport() {
    const camera = cameraCenter();
    const rows = layerRows();
    const collections = collectLayerRecords({ layers: rows, maxPerLayer: 25 });
    const recordsById = new Map(collections.map((c) => [c.layerId, c.records]));
    return buildSituationReport({
      generatedAt: Date.now(),
      camera: camera && {
        lat: camera.lat,
        lon: camera.lon,
        altM: camera.altM,
        headingDeg: camera.heading,
      },
      layers: rows
        .filter((row) => row.enabled)
        .map((row) => ({
          id: row.id,
          name: row.name,
          enabled: true,
          source: row.source,
          stats: row.stats,
          records: recordsById.get(row.id) || [],
        })),
      selected: intel?.currentModel?.() || null,
      alerts: alertStore.list?.() || [],
      zones: zones.list?.() || [],
      brand: { name: BRAND.name },
    });
  }

  function downloadReport() {
    downloadText(
      reportFilename(Date.now()),
      situationReport(),
      'text/markdown',
    );
    toast('Situation report downloaded');
  }

  const casePanel = createCasePanel({
    document,
    root: byId('case-panel'),
    storage,
    actions: {
      getCameraCenter: cameraCenter,
      flyTo,
      getSelectedSubject: () => {
        const record = getSelectedEntityContext({ dataManager });
        return record &&
          Number.isFinite(record.latitude) &&
          Number.isFinite(record.longitude)
          ? {
              id: String(record.id),
              label: record.label || String(record.id),
              lat: record.latitude,
              lon: record.longitude,
            }
          : null;
      },
      showToast: toast,
      exportReport: situationReport,
      download: downloadText,
      onCountChanged: () => actions.scheduleLayout?.(),
    },
  });

  // ── Export menu in the DATA LAYERS panel ─────────────────────────
  const exportMenu = createExportMenu({
    document,
    anchor: document.querySelector('#data-panel .data-panel-inner'),
    getLayers: layerRows,
    showToast: toast,
    download: downloadText,
  });

  // ── Command palette ───────────────────────────────────────────────
  let sitesPromise = null;
  function loadSites() {
    if (!sitesPromise)
      sitesPromise = Promise.all(
        PALETTE_SITE_LAYERS.map(([id, kind, cap]) => {
          const spec = STRATEGIC_LAYER_SPECS.find((entry) => entry.id === id);
          return spec
            ? loadSiteRows(spec, kind, cap, lifetime.signal)
            : Promise.resolve([]);
        }),
      ).then((groups) => groups.flat());
    return sitesPromise;
  }
  function cityRows() {
    const rows = [];
    for (const [key, city] of Object.entries(services.CITY_POIS || {})) {
      const first = city?.pois?.[0];
      if (first)
        rows.push({
          id: `city:${key}`,
          name: city.name,
          lat: first.lat,
          lon: first.lon,
          kind: 'city',
          subtitle: 'City preset',
        });
      for (const poi of city?.pois || [])
        rows.push({
          id: `poi:${key}:${poi.name}`,
          name: poi.name,
          lat: poi.lat,
          lon: poi.lon,
          kind: 'poi',
          subtitle: city.name,
        });
    }
    return rows;
  }
  const openPanel = (id) => {
    const panel = byId(id);
    if (!panel) return;
    panel.hidden = false;
    actions.setPanelCollapsed?.(id, false);
    actions.scheduleLayout?.();
  };
  // ── Flight search: type a callsign (e.g. AFR36KN) in the palette ─────
  const CALLSIGN_QUERY = /^[A-Z]{2,4}[0-9][A-Z0-9]{0,5}$/;
  function paletteQuery() {
    return String(byId('command-palette')?.querySelector('input')?.value || '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '');
  }
  function flightRecords() {
    const rows = [];
    for (const [layerId, kind] of [
      ['flights', 'Live flights'],
      ['military', 'Military flights'],
    ]) {
      try {
        for (const r of layerModule(layerId)?.getAnalystRecords?.() || [])
          if (r?.callsign && r?.icao24) rows.push({ ...r, layerId, kind });
      } catch {
        /* layer not ready */
      }
    }
    return rows;
  }
  async function trackCallsign(callsign, layerId = 'flights') {
    const find = () =>
      flightRecords().find(
        (r) => String(r.callsign).trim().toUpperCase() === callsign,
      );
    let hit = find();
    if (!hit) {
      if (!dataManager?.isEnabled?.(layerId))
        await Promise.resolve(
          dataManager?.setEnabled?.(layerId, true, { origin: 'user' }),
        ).catch(() => {});
      toast(`Searching flight · ${callsign}`);
      for (let i = 0; i < 25 && !hit; i++) {
        await new Promise((resolve) => windowRef.setTimeout(resolve, 1000));
        hit = find();
      }
    }
    if (!hit) {
      toast(`Flight not found · ${callsign}`);
      return;
    }
    const ok = layerModule(hit.layerId)?.trackById?.(hit.icao24, {
      origin: 'user',
    });
    if (!ok) toast(`Flight not found · ${callsign}`);
  }
  function flightLevel(altitudeM) {
    if (!Number.isFinite(altitudeM) || altitudeM <= 0) return '';
    return `FL${String(Math.round(altitudeM * 0.0328084)).padStart(3, '0')}`;
  }
  function flightActions() {
    const query = paletteQuery();
    if (query.length < 3 || !CALLSIGN_QUERY.test(query)) return [];
    const matches = flightRecords()
      .filter((r) => String(r.callsign).trim().toUpperCase().startsWith(query))
      .slice(0, 8)
      .map((r) => {
        const callsign = String(r.callsign).trim().toUpperCase();
        return {
          id: `track-flight-${r.icao24}`,
          label: `Track flight · ${callsign}`,
          hint: [r.kind, r.originCountry, flightLevel(r.altitudeM)]
            .filter(Boolean)
            .join(' · '),
          run: () => trackCallsign(callsign, r.layerId),
        };
      });
    if (matches.length) return matches;
    // Not loaded yet (layer off or not in the current feed): search on demand.
    return [
      {
        id: `track-flight-search-${query}`,
        label: `Track flight · ${query}`,
        hint: 'Live flights',
        run: () => trackCallsign(query, 'flights'),
      },
    ];
  }

  const STYLE_ACTIONS = [
    ['normal', 'Normal'],
    ['retro', 'CRT'],
    ['surveillance', 'Night vision (NVG)'],
    ['thermal', 'Thermal (FLIR)'],
  ];
  const palette = createCommandPalette({
    document,
    root: byId('command-palette'),
    storage,
    providers: {
      layers: () =>
        (dataManager?.getAll?.() || [])
          .filter((row) => row.showInTogglePanel)
          .map((row) => ({
            id: row.id,
            name: row.name,
            icon: row.icon,
            enabled: row.enabled,
            group: layerPanelGroup(row.id),
          })),
      toggleLayer: (id, enabled) =>
        dataManager?.setEnabled?.(id, enabled, { origin: 'user' }),
      locations: async () => [...cityRows(), ...(await loadSites())],
      flyTo,
      actions: () => [
        ...flightActions(),
        {
          id: 'reset-globe',
          label: 'Reset to full globe',
          hint: 'Camera',
          run: () => byId('reset-globe-view')?.click(),
        },
        {
          id: 'toggle-theme',
          label: 'Toggle light / dark theme',
          hint: 'Interface',
          run: () => theme.toggle(),
        },
        {
          id: 'open-alerts',
          label: 'Open ALERTS and watch zones',
          hint: 'Panel',
          run: () => openPanel('alerts-panel'),
        },
        {
          id: 'open-case',
          label: 'Open CASE notes',
          hint: 'Panel',
          run: () => openPanel('case-panel'),
        },
        {
          id: 'report',
          label: 'Download situation report (Markdown)',
          hint: 'Export',
          run: downloadReport,
        },
        {
          id: 'share',
          label: 'Copy share link',
          hint: 'Share',
          run: () => byId('share-btn')?.click(),
        },
        {
          id: 'clear-layers',
          label: 'Turn off all data layers',
          hint: 'Layers',
          run: () => byId('clear-selected-layers')?.click(),
        },
        {
          id: 'toggle-hud',
          label: 'Toggle intelligence HUD',
          hint: 'Display',
          run: () => actions.toggleHud?.(),
        },
        {
          id: 'drone',
          label: 'UHD drone · fly with WASD and the mouse',
          hint: 'Camera',
          run: () => drone?.toggle(),
        },
        ...Object.values(TILE_QUALITY_LEVELS).map((settings) => ({
          id: `tile-quality-${settings.id}`,
          label: `3D detail · ${settings.label}`,
          hint: 'Display',
          run: () => tileQuality?.set(settings.id),
        })),
        ...STYLE_ACTIONS.map(([style, label]) => ({
          id: `style-${style}`,
          label: `Visual style: ${label}`,
          hint: 'Style',
          run: () => actions.setStyle?.(style),
        })),
      ],
      searchPlaces: placeSearch?.geocode
        ? async (query, { signal }) => {
            const result = await placeSearch.geocode(query, { signal });
            const place = result?.place || result;
            const lat = Number(place?.lat);
            const lon = Number(place?.lng ?? place?.lon);
            return Number.isFinite(lat) && Number.isFinite(lon)
              ? [{ name: place.name || query, lat, lon }]
              : [];
          }
        : undefined,
    },
  });

  engine.start();

  // ── 3D buildings without Google 3D ────────────────────────────────
  // Fresh sessions without photorealistic tiles get OpenStreetMap 3D
  // buildings switched on once; an EEA refusal of the Google key is explained
  // once. Runs after share/local state restoration has had its turn.
  let buildingsTimer = null;
  function scheduleBuildingsDefault() {
    clearTimeout(buildingsTimer);
    buildingsTimer = setTimeout(applyBuildingsDefault, 2500);
    // State restoration can re-apply a saved flat map after the first pass;
    // re-check once it has certainly settled.
    for (const delay of [7000, 15000])
      setTimeout(() => {
        if (windowRef?.__panoptesMapStatus?.photoreal) ensurePhotoreal();
      }, delay);
  }
  function userPrefersFlatMap() {
    try {
      return storage?.getItem(MAP_USER_FLAT_KEY) === '1';
    } catch {
      return false;
    }
  }
  function ensurePhotoreal() {
    if (userPrefersFlatMap()) return;
    const chip = document.querySelector(
      '#map-stack-chips [data-stack-id="photoreal"]',
    );
    const controller = windowRef?.__godsEyeView?.mapStackController;
    if (controller?.getActiveId?.() && controller.getActiveId() !== 'photoreal')
      Promise.resolve(controller.setStack('photoreal')).catch(() => {});
    else if (
      !controller &&
      chip &&
      chip.getAttribute('aria-pressed') !== 'true'
    )
      chip.click();
    if (dataManager?.isEnabled?.(BUILDINGS_LAYER_ID))
      Promise.resolve(
        dataManager.setEnabled(BUILDINGS_LAYER_ID, false, { origin: 'tool' }),
      ).catch(() => {});
  }
  // Remember an explicit operator choice of map source (real clicks only).
  const onMapChipClick = (event) => {
    if (!event.isTrusted) return;
    const chip = event.target?.closest?.('[data-stack-id]');
    if (!chip || !windowRef?.__panoptesMapStatus?.photoreal) return;
    try {
      if (chip.dataset.stackId === 'photoreal')
        storage?.removeItem(MAP_USER_FLAT_KEY);
      else storage?.setItem(MAP_USER_FLAT_KEY, '1');
    } catch {
      /* best effort */
    }
  };
  document.addEventListener('click', onMapChipClick, true);
  function applyBuildingsDefault() {
    const status = windowRef?.__panoptesMapStatus;
    if (!status || !dataManager?.layers?.has?.(BUILDINGS_LAYER_ID)) return;
    let autoDone = false;
    let noticeShown = false;
    try {
      autoDone = storage?.getItem(BUILDINGS_AUTO_KEY) === '1';
      noticeShown = storage?.getItem(REGION_NOTICE_KEY) === '1';
    } catch {
      /* storage unavailable */
    }
    const hash = String(windowRef?.location?.hash || '');
    // Photorealistic 3D (real textured buildings) wins whenever it is
    // available, unless the operator explicitly picked a flat map while it
    // was. Restored sessions and old share links that carry map=esri-imagery
    // are moved onto it, and the untextured OSM buildings stand down.
    if (status.photoreal) {
      ensurePhotoreal();
      return;
    }
    if (
      shouldAutoEnableBuildings({
        photorealAvailable: status.photoreal,
        shareLinkHasLayers: /[#&]l=[^&]/.test(hash),
        alreadyAutoEnabled: autoDone,
        alreadyEnabled: dataManager.isEnabled?.(BUILDINGS_LAYER_ID),
      })
    ) {
      Promise.resolve(
        dataManager.setEnabled(BUILDINGS_LAYER_ID, true, { origin: 'tool' }),
      ).catch(() => {});
      try {
        storage?.setItem(BUILDINGS_AUTO_KEY, '1');
      } catch {
        /* best effort */
      }
    }
    if (status.regionBlocked && !noticeShown) {
      toast(
        'Google 3D is not available for this key in your region (EEA). Showing OpenStreetMap 3D buildings. Add a free Cesium ion token in POWER UP for photorealistic 3D.',
      );
      try {
        storage?.setItem(REGION_NOTICE_KEY, '1');
      } catch {
        /* best effort */
      }
    }
  }

  // ── Release tracking ──────────────────────────────────────────────
  // While the camera follows an aircraft, satellite or vessel, a chip at the
  // top of the view names the subject and releases the camera (also Esc), so
  // the operator can always get back to free navigation.
  const TRACKING_LAYERS = Object.freeze({
    flights: 'flightsLayer',
    military: 'militaryFlightsLayer',
    'local-adsb': 'localAdsbLayer',
    satellites: 'satellitesLayer',
    'ais-live-vessels': 'aisLiveVesselsLayer',
  });
  const releaseChip = document.createElement('div');
  releaseChip.className = 'pnp-tracking-chip';
  releaseChip.hidden = true;
  releaseChip.setAttribute('role', 'status');
  const releaseLabel = document.createElement('span');
  releaseLabel.className = 'pnp-tracking-label';
  const releaseButton = document.createElement('button');
  releaseButton.type = 'button';
  releaseButton.className = 'pnp-tracking-release';
  releaseButton.textContent = 'RELEASE CAMERA · ESC';
  releaseButton.title = 'Stop following and move the map freely (Esc)';
  const releaseRoute = document.createElement('span');
  releaseRoute.className = 'pnp-tracking-route';
  releaseRoute.hidden = true;
  // Camera modes for a tracked aircraft: chase, cockpit, top-down, orbit.
  const CAMERA_MODES = [
    ['follow', 'Follow', 'Chase camera behind the aircraft'],
    ['cockpit', 'Cockpit', 'First-person view from the aircraft'],
    ['top', 'Top-down', 'Look straight down on the aircraft'],
    ['orbit', 'Orbit', 'Slowly circle around the aircraft'],
  ];
  const cameraModes = document.createElement('div');
  cameraModes.className = 'pnp-camera-modes';
  cameraModes.setAttribute('role', 'radiogroup');
  cameraModes.setAttribute('aria-label', 'Camera mode');
  cameraModes.hidden = true;
  for (const [mode, label, title] of CAMERA_MODES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pnp-camera-mode';
    button.dataset.cameraMode = mode;
    button.setAttribute('role', 'radio');
    button.title = title;
    button.textContent = label;
    cameraModes.appendChild(button);
  }
  releaseChip.append(releaseLabel, releaseRoute, cameraModes, releaseButton);
  let cameraMode = 'follow';
  let followViewFrom = null;
  let orbitRemove = null;
  const shell = () => windowRef?.__godsEyeView?.styleManager || null;
  // Leaving the cockpit while it wore the Cyber skin hands the whole
  // interface back to the default orange theme (Tactical HUD), and Cyber's
  // FLIR look goes with it.
  let wasCockpit = Boolean(document.body?.classList?.contains('cockpit-mode'));
  const Observer = windowRef?.MutationObserver;
  const cockpitExitObserver = Observer
    ? new Observer(() => {
        const inCockpit = document.body.classList.contains('cockpit-mode');
        if (
          wasCockpit &&
          !inCockpit &&
          document.documentElement.dataset.uiTheme === 'cyber'
        )
          shell()?._setHudVariant?.('tactical', { applyVisualDefaults: true });
        wasCockpit = inCockpit;
      })
    : null;
  if (document.body)
    cockpitExitObserver?.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
    });
  function renderCameraModes() {
    for (const button of cameraModes.children) {
      const on = button.dataset.cameraMode === cameraMode;
      button.classList.toggle('active', on);
      button.setAttribute('aria-checked', String(on));
    }
  }
  function stopOrbit() {
    orbitRemove?.();
    orbitRemove = null;
  }
  function retrack(entity, viewFrom) {
    if (!viewer || !entity) return;
    if (viewFrom) entity.viewFrom = viewFrom;
    viewer.trackedEntity = undefined;
    viewer.trackedEntity = entity;
    viewer.scene.requestRender();
  }
  function setCameraMode(mode) {
    if (!viewer || !trackedSubject) return;
    const previous = cameraMode;
    if (previous === mode) return;
    stopOrbit();
    if (previous === 'cockpit') {
      shell()?.controlCockpit?.('exit');
      // Back outside: focus on the tracked aircraft again.
      setAircraftFocus(true);
    }
    cameraMode = mode;
    renderCameraModes();
    if (mode === 'cockpit') {
      enterCockpit();
      return;
    }
    const entity = viewer.trackedEntity;
    if (!entity) return;
    if (!followViewFrom && entity.viewFrom?.getValue)
      followViewFrom = entity.viewFrom.getValue(viewer.clock.currentTime);
    else if (!followViewFrom && entity.viewFrom)
      followViewFrom = entity.viewFrom;
    const base = followViewFrom
      ? Cesium.Cartesian3.clone(followViewFrom)
      : new Cesium.Cartesian3(0, -4000, 2500);
    const range = Cesium.Cartesian3.magnitude(base) || 5000;
    if (mode === 'top') {
      retrack(entity, new Cesium.Cartesian3(0, -range * 0.05, range * 1.4));
      return;
    }
    retrack(entity, base);
    if (mode === 'orbit') {
      const spin = () => {
        if (viewer.trackedEntity !== entity) return stopOrbit();
        viewer.camera.rotateRight(0.006);
      };
      viewer.scene.preRender.addEventListener(spin);
      orbitRemove = () => viewer.scene.preRender.removeEventListener(spin);
    }
  }
  // Cockpit sits on the Contacts context: establish it (as voice does)
  // when entry is refused, then enter.
  async function enterCockpit() {
    const manager = shell();
    let result = manager?.controlCockpit?.('enter');
    if (result?.ok === false && typeof manager?.setContextMode === 'function') {
      const context = await Promise.resolve(
        manager.setContextMode('flights', { claimVisualAuthority: false }),
      ).catch(() => null);
      if (context?.ok !== false) {
        await new Promise((resolve) => windowRef.setTimeout(resolve, 400));
        result = manager.controlCockpit('enter');
      }
    }
    // The cockpit Contacts roster needs the surrounding traffic.
    if (result?.ok) setAircraftFocus(false);
    if (result?.ok === false || !result) {
      toast(result?.error || 'Cockpit view unavailable');
      cameraMode = 'follow';
      renderCameraModes();
    }
  }
  const onCameraModeClick = (event) => {
    const mode =
      event.target?.closest?.('[data-camera-mode]')?.dataset?.cameraMode;
    if (mode) setCameraMode(mode);
  };
  cameraModes.addEventListener('click', onCameraModeClick);
  function resetCameraModes(aircraft) {
    stopOrbit();
    cameraMode = 'follow';
    followViewFrom = null;
    cameraModes.hidden = !aircraft;
    renderCameraModes();
  }
  // Tracked aircraft: published route, progress and ETA on the globe.
  const flightRoute = viewer
    ? createFlightRouteOverlay({
        viewer,
        services,
        intelModel: () => intel?.currentModel?.() || null,
        onSummary: (summary) => {
          releaseRoute.hidden = !summary;
          if (!summary) return;
          releaseRoute.textContent = `${summary.origin.code || '---'} → ${summary.destination.code || '---'} · ${Math.round(summary.remainingKm).toLocaleString('en-US')} KM LEFT · ETA ${formatUtcTime(summary.etaMs)} (${formatDuration(summary.remainingMinutes)})`;
        },
      })
    : null;
  document.body.appendChild(releaseChip);
  let trackedSubject = null;
  // Focus mode: while an aircraft is tracked, every other aircraft is hidden.
  const AIRCRAFT_LAYERS = new Set(['flights', 'military']);
  function setAircraftFocus(on) {
    for (const key of ['flightsLayer', 'militaryFlightsLayer']) {
      try {
        services[key]?.setFleetHidden?.(on);
      } catch {
        /* layer not ready */
      }
    }
  }
  function releaseTracking() {
    if (cameraMode === 'cockpit') shell()?.controlCockpit?.('exit');
    resetCameraModes(false);
    setAircraftFocus(false);
    for (const key of Object.values(TRACKING_LAYERS)) {
      try {
        services[key]?.stopTracking?.({ origin: 'user' });
      } catch {
        /* a layer without tracking state */
      }
    }
    try {
      if (viewer) {
        viewer.trackedEntity = undefined;
        viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      }
    } catch {
      /* camera already free */
    }
    trackedSubject = null;
    releaseChip.hidden = true;
  }
  const onSubjectSelected = (event) => {
    const detail = event?.detail || {};
    if (!TRACKING_LAYERS[detail.layerId]) return;
    trackedSubject = detail;
    setAircraftFocus(AIRCRAFT_LAYERS.has(detail.layerId));
    resetCameraModes(AIRCRAFT_LAYERS.has(detail.layerId));
    releaseLabel.textContent = `TRACKING · ${String(detail.label || detail.id || '').toUpperCase()}`;
    releaseChip.hidden = false;
  };
  const onSubjectCleared = (event) => {
    const detail = event?.detail || {};
    if (
      trackedSubject &&
      detail.layerId &&
      detail.layerId !== trackedSubject.layerId
    )
      return;
    trackedSubject = null;
    setAircraftFocus(false);
    resetCameraModes(false);
    releaseChip.hidden = true;
  };
  const onReleaseKey = (event) => {
    if (event.key !== 'Escape' || !trackedSubject) return;
    if (event.target?.matches?.('input, textarea, select')) return;
    releaseTracking();
  };
  releaseButton.addEventListener('click', releaseTracking);
  windowRef?.addEventListener?.(
    'gev:awareness-subject-selected',
    onSubjectSelected,
  );
  windowRef?.addEventListener?.(
    'gev:awareness-subject-cleared',
    onSubjectCleared,
  );
  document.addEventListener('keydown', onReleaseKey, true);

  // ── 3D detail (photoreal tile refinement and pixel density) ────────
  const qualityButtons = [...document.querySelectorAll('[data-tile-quality]')];
  const qualityStatus = byId('tile-quality-status');
  function renderQuality(level) {
    for (const button of qualityButtons) {
      const on = button.dataset.tileQuality === level;
      button.classList.toggle('active', on);
      button.setAttribute('aria-pressed', String(on));
    }
    if (qualityStatus)
      qualityStatus.textContent = (
        TILE_QUALITY_LEVELS[level]?.label || level
      ).toUpperCase();
  }
  const tileQuality = viewer
    ? createTileQuality({
        viewer,
        windowRef,
        storage,
        onChange: (level) => {
          renderQuality(level);
          toast(`3D detail · ${TILE_QUALITY_LEVELS[level]?.label || level}`);
        },
      })
    : null;
  if (tileQuality) renderQuality(tileQuality.get());
  const onQualityClick = (event) => {
    const level = event.currentTarget?.dataset?.tileQuality;
    if (level) tileQuality?.set(level);
  };
  for (const button of qualityButtons)
    button.addEventListener('click', onQualityClick);

  // ── DRAW drawer: the drawing tool gets its own rail entry ──────────
  // The DISPLAY panel's draw group moves here with its listeners intact.
  const drawSlot = document.querySelector('[data-draw-slot]');
  const drawGroup = byId('draw-toggle')?.closest('.pp-toggle-group');
  if (drawSlot && drawGroup && drawGroup.parentElement !== drawSlot)
    drawSlot.appendChild(drawGroup);

  // Marked zones: every mark on the board, each with fly-to and delete.
  const drawList = document.createElement('div');
  drawList.className = 'draw-zone-list';
  drawSlot?.appendChild(drawList);
  const SHAPE_LABELS = { area: 'Area', route: 'Line', pin: 'Pin' };
  const ZONE_COLORS = {
    primary: '#f5a524',
    amber: '#ffbf47',
    cyan: '#22d3ee',
    green: '#4ade80',
    red: '#ef4444',
  };
  const annotationsEngine = () => windowRef?.__godsEyeView?.annotations || null;
  function zoneCenter(anno) {
    const pts = [];
    const push = (lon, lat) => {
      if (Number.isFinite(lon) && Number.isFinite(lat)) pts.push([lon, lat]);
    };
    if (Array.isArray(anno.ring))
      for (const [lon, lat] of anno.ring) push(lon, lat);
    if (Array.isArray(anno.path))
      for (const pt of anno.path) push(pt.lon, pt.lat);
    push(anno.longitude ?? anno.lon, anno.latitude ?? anno.lat);
    if (!pts.length) return null;
    const lon = pts.reduce((a, q) => a + q[0], 0) / pts.length;
    const lat = pts.reduce((a, q) => a + q[1], 0) / pts.length;
    return { lon, lat };
  }
  let drawListKey = '';
  function renderDrawList() {
    const engine = annotationsEngine();
    const marks = engine?.list?.() || [];
    const key = marks.map((m) => `${m.id}:${m.label}:${m.color}`).join('|');
    if (key === drawListKey) return;
    drawListKey = key;
    drawList.textContent = '';
    if (!marks.length) {
      const empty = document.createElement('p');
      empty.className = 'draw-zone-empty';
      empty.textContent = 'No marked zones yet.';
      drawList.appendChild(empty);
      return;
    }
    const title = document.createElement('div');
    title.className = 'draw-zone-title';
    title.textContent = 'Marked zones';
    drawList.appendChild(title);
    for (const mark of marks) {
      const row = document.createElement('div');
      row.className = 'draw-zone-row';
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'draw-zone-go';
      go.title = 'Fly to this zone';
      const dot = document.createElement('span');
      dot.className = 'draw-zone-dot';
      dot.style.background = ZONE_COLORS[mark.color] || ZONE_COLORS.primary;
      const name = document.createElement('span');
      name.className = 'draw-zone-name';
      name.textContent = mark.label || SHAPE_LABELS[mark.type] || 'Mark';
      const kind = document.createElement('span');
      kind.className = 'draw-zone-kind';
      kind.textContent = SHAPE_LABELS[mark.type] || mark.type || '';
      go.append(dot, name, kind);
      go.addEventListener('click', () => {
        const center = zoneCenter(mark);
        if (center)
          flyTo({ lat: center.lat, lon: center.lon, rangeM: 2500, pitch: -50 });
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'draw-zone-remove';
      remove.title = 'Delete this zone';
      remove.setAttribute('aria-label', 'Delete this zone');
      remove.textContent = '✕';
      remove.addEventListener('click', () => {
        engine?.remove?.(mark.id);
        drawListKey = '';
        renderDrawList();
        viewer?.scene?.requestRender();
      });
      row.append(go, remove);
      drawList.appendChild(row);
    }
  }
  const drawListTimer = windowRef?.setInterval?.(() => {
    if (byId('draw-panel')?.classList.contains('collapsed')) return;
    renderDrawList();
  }, 700);

  // Marked zones are kept in this browser until deleted.
  const zonePersistence = installZonePersistence({
    getEngine: () => windowRef?.__godsEyeView?.annotations || null,
    windowRef,
  });

  // ── ROUTE drawer: A to B on foot, by car or by air, played live ────
  const routePlanner = viewer
    ? createRoutePlanner({
        viewer,
        document,
        root: document.querySelector('[data-route-root]'),
        geocode: placeSearch?.geocode
          ? (query, options) => placeSearch.geocode(query, options)
          : null,
        toast,
      })
    : null;

  // ── Dense point layers dim the basemap so their symbols stay legible ──
  const DIMMING_LAYERS = Object.freeze({ traffic: 0.38 });
  const basemapDim = viewer ? createBasemapDimmer({ viewer, windowRef }) : null;

  // Celestial view: the Earth also shows day and night from the real sun.
  const dayNight = viewer ? createDayNight({ viewer }) : null;
  const celestialButton = byId('celestial-toggle');
  const syncDayNight = () =>
    dayNight?.setEnabled(
      celestialButton?.getAttribute('aria-pressed') === 'true',
    );
  const celestialObserver =
    celestialButton && windowRef?.MutationObserver
      ? new windowRef.MutationObserver(syncDayNight)
      : null;
  celestialObserver?.observe(celestialButton, {
    attributes: true,
    attributeFilter: ['aria-pressed'],
  });
  syncDayNight();
  const syncBasemapDim = () => {
    let dim = 0;
    for (const [id, amount] of Object.entries(DIMMING_LAYERS))
      if (dataManager?.isEnabled?.(id)) dim = Math.max(dim, amount);
    basemapDim?.set(dim);
  };
  const dimTimer = windowRef?.setInterval?.(syncBasemapDim, 1000);

  // ── CAMERAS drawer: totals, All / Live video filter, street search ──
  const cctvCatalog = createCctvCatalogBar({
    document,
    getLayer: () => layerModule('cctv'),
    setLiveOnly: (liveOnly) =>
      Promise.resolve(
        dataManager?.setLayerParams?.('cctv', { liveOnly }, { origin: 'user' }),
      ).catch(() => {}),
  });

  // ── UHD drone free-flight camera ──────────────────────────────────
  const droneButtons = [...document.querySelectorAll('[data-drone-toggle]')];
  const drone = viewer
    ? createDroneMode({
        viewer,
        document,
        tileQuality,
        releaseTracking,
        onChange: (on) => {
          if (on) {
            // Give the drone the whole view: close the presets popover.
            const tray = byId('control-panel-toggle');
            if (tray?.getAttribute('aria-expanded') === 'true') tray.click();
          }
          for (const button of droneButtons) {
            button.classList.toggle('active', on);
            button.setAttribute('aria-pressed', String(on));
          }
          toast(
            on
              ? 'UHD drone · WASD move · click + mouse look · Shift/E up · Q/C down · Esc exit'
              : 'UHD drone off',
          );
        },
      })
    : null;
  const onDroneClick = () => drone?.toggle();
  for (const button of droneButtons)
    button.addEventListener('click', onDroneClick);

  // The workstation top bar search field opens the palette.
  const openPalette = () => palette?.open();
  windowRef?.addEventListener?.('panoptes:open-palette', openPalette);

  return {
    attachDataManager(manager) {
      dataManager = manager || null;
      if (dataManager) scheduleBuildingsDefault();
    },
    toggleCommandPalette() {
      palette?.toggle();
    },
    toggleDrone() {
      drone?.toggle();
    },
    downloadReport,
    destroy() {
      releaseButton.removeEventListener('click', releaseTracking);
      cameraModes.removeEventListener('click', onCameraModeClick);
      stopOrbit();
      for (const button of droneButtons)
        button.removeEventListener('click', onDroneClick);
      for (const button of qualityButtons)
        button.removeEventListener('click', onQualityClick);
      drone?.destroy();
      windowRef?.clearInterval?.(dimTimer);
      basemapDim?.destroy();
      routePlanner?.destroy();
      zonePersistence?.destroy();
      cockpitExitObserver?.disconnect();
      celestialObserver?.disconnect();
      dayNight?.destroy();
      windowRef?.clearInterval?.(drawListTimer);
      cctvCatalog?.destroy();
      tileQuality?.destroy();
      if (eventClicks && !eventClicks.isDestroyed()) eventClicks.destroy();
      windowRef?.removeEventListener?.(
        'gev:awareness-subject-selected',
        onSubjectSelected,
      );
      windowRef?.removeEventListener?.(
        'gev:awareness-subject-cleared',
        onSubjectCleared,
      );
      document.removeEventListener('keydown', onReleaseKey, true);
      releaseChip.remove();
      flightRoute?.destroy();
      lifetime.abort();
      clearTimeout(buildingsTimer);
      windowRef?.removeEventListener?.('panoptes:open-palette', openPalette);
      engine.destroy?.() ?? engine.stop();
      for (const surface of [palette, exportMenu, casePanel, alerts, intel])
        surface?.destroy?.();
      releaseThemeToggle?.();
      theme.destroy?.();
      dataManager = null;
    },
  };
}

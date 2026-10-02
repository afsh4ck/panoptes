# Layer SDK — adding a data layer to PANOPTES

PANOPTES layers are plain modules with a small lifecycle contract. This guide
is the shortest path from "I have a feed" to "it is a toggle in DATA LAYERS,
it survives share links, and voice/analyst queries can read it".

## 1. Pick the layer shape

| Shape | Use when | Template to copy |
| --- | --- | --- |
| **Static dataset** | A bundled file that changes rarely (bases, ports, plants) | `src/data/strategicLayers.js` + `scripts/etl/*` |
| **Live snapshot** | A feed you poll on an interval (quakes, conflicts, alerts) | `src/layers/earthquakes/` + `server/providers/events/` |
| **Viewport-bound** | Data that only makes sense for the current view (GPS interference, OSM installations) | `src/layers/gpsInterference/` |
| **Tracking** | Moving contacts with selection and readouts (flights, vessels) | `src/layers/flights/` |

Static datasets go through the ETL pipeline (`docs/ETL.md`): one GeoJSONL file
per dataset with `name`, `class`, `subtitle`, `detail`, `country`, `source` and
`tags` properties. Registering one is a spec entry in
`STRATEGIC_LAYER_SPECS` — no rendering code.

## 2. The layer contract

```js
export function createMyLayer({ source, overlayHost }) {
  return {
    id: 'my-layer',            // kebab-case, unique, stable forever (share links)
    name: 'My Layer',          // panel label
    icon: '◎',                 // one glyph (text, not an icon-font ligature)
    source: 'Provider name',   // attribution shown in the row meta
    updateInterval: 60_000,    // ms between update() calls while enabled
    init(viewer) {},           // create data sources; no fetches
    enable(viewer) {},         // show + start
    disable(viewer) {},        // hide + abort in-flight work + clear overlays
    async update(viewer) { return true; }, // fetch + render; true when data changed
    destroy(viewer) {},        // permanent teardown
    getStats() { return { count, lastUpdate, lastError, status, countLabel }; },
    getAnalystRecords(max = 2000) { return []; }, // JSON-safe rows for voice/export
    // Optional row controls: chips, legend and an info line under the toggle.
    getParams() {}, setParams(params) {}, getRowControls() {},
    setRowControlsListener(listener) {},
  };
}
```

Rules that keep the app honest and fast:

- `source.js` inside a layer folder is **portable**: no Cesium, no DOM, no
  imports from `src/app`, `src/ui` or rendering modules. It only knows how to
  fetch and validate a snapshot (`getSnapshot({ signal })`).
- `records.js` is pure normalization with tests next to it.
- Rendering lives in `index.js`; publish cards through `overlayHost.setEntries`
  so labels share one collision solver with every other layer.
- Never hold the render loop while idle. Static geometry, no per-frame callbacks
  unless something is actually animating.
- Stats must say when a feed is stale, partial, keyless (`keyRequired: true` +
  `requiresKeyId`) or degraded. The panel chip is derived from them.

## 3. Server proxy (live feeds)

Browser code only talks to same-origin `/api/*` routes. A proxy is a Vite plugin
factory in `server/providers/**` registered in `server/providers/local.js`:

```js
export function myProxy() {
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 600 });
  return {
    name: 'my-proxy',
    configureServer(server) {
      server.middlewares.use('/api/my-feed', async (req, res) => { /* ... */ });
    },
  };
}
```

Every proxy caps upstream body size (`readResponseJsonCapped`), coalesces
concurrent requests (`coalesceProxyRequest`), serves stale data on upstream
failure, sends `Cache-Control: no-store`, and never relays raw upstream error
bodies. Keys stay server-side; declare them in `src/keySetupCore.mjs` so the
POWER UP panel can collect them.

## 4. Registration checklist

1. `src/data/layerStateTokenReservations.json` — reserve a share-link token
   with `npm run layer-token:next -- my-layer` and add the row.
2. `src/data/layerState.js` — add the registry entry (keep the array sorted by id).
3. `src/app/constructCatalog.js` — construct the layer; add its source to
   `SOURCE_METHODS` and to `src/sources/reference.js` /
   `src/standalone/layerSources.js`.
4. `src/ui/layerPanel.js` — place the id in a `PANEL_GROUPS` section.
5. `src/data/analystEngine.js` — declare the record fields voice may filter on.
6. Tests: registry counts in `src/data/layerState.test.mjs` and
   `src/data/layerStateTokenLedger.test.mjs`, plus your own `*.test.mjs`.
7. `DATA_SOURCES.md` — source, license, attribution.

## 5. Intel cards and alerts

Selecting an entity publishes it to the shared context store
(`selectEntityContext` for static features, `selectTrackedSubjectContext` for
tracked contacts). The INTEL panel listens to `gev:entity-selected` and
`gev:awareness-subject-selected` and builds a dossier with the builders in
`src/intel/`. To give your layer a dossier, add a builder that returns the
IntelModel contract from `src/intel/intelModel.js` and register it in the panel
services in `src/ui/applicationShell.js`.

The alerts engine (`src/alerts/`) reads `getAnalystRecords()` from enabled
layers. Rows with `lat`/`lon` (or `latitude`/`longitude`) and a `time` field are
enough for zone rules; add a dedicated rule in `src/alerts/rules.js` when a
layer has its own severity semantics.

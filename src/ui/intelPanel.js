import {
  INTEL_STATES,
  coerceSubject,
  createIntelCache,
  exportFileName,
  fallbackModelFromSubject,
  normalizeIntelModel,
  panelBadgeText,
  renderEmptyView,
  renderIntelView,
  requestDescriptorFor,
  subjectFromAwarenessEvent,
  subjectFromEntityRecord,
  subjectKey,
} from './intelPanelModel.js';

/**
 * @module intelPanel
 * @description Right-rail INTEL panel: a technical dossier for whatever the
 * operator selected — aircraft, satellite, vessel, launch or mapped site.
 *
 * The panel owns no data source. Providers arrive through `services` (each a
 * `{fetch?, build}` pair the coordinator injects from `src/intel/*`); a kind
 * without a provider still renders the selection record, so the panel never
 * blanks on a missing module. Selection arrives on the two publication lanes
 * the app already has: `gev:awareness-subject-selected` (tracking layers:
 * flights, military, satellites) and `gev:entity-selected` (the context store:
 * vessels, installations, static sites). Their clear counterparts hold the last
 * dossier as NOT TRACKING with a CLOSE control instead of blanking it.
 */

export const SUBJECT_SELECTED_EVENT = 'gev:awareness-subject-selected';
export const SUBJECT_CLEARED_EVENT = 'gev:awareness-subject-cleared';
export const ENTITY_SELECTED_EVENT = 'gev:entity-selected';
export const ENTITY_CLEARED_EVENT = 'gev:entity-selection-cleared';

/** Mount a render tree as DOM. `class` maps to className; other attrs are set verbatim. */
export function mountVNode(document, node) {
  if (node === null || node === undefined || node === false) return null;
  if (typeof node !== 'object') return document.createTextNode(String(node));
  const element = document.createElement(node.tag);
  for (const [key, value] of Object.entries(node.attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') element.className = String(value);
    else element.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of node.children || []) {
    const mounted = mountVNode(document, child);
    if (mounted) element.appendChild(mounted);
  }
  return element;
}

function safeCall(fn, ...args) {
  if (typeof fn !== 'function') return null;
  try {
    return fn(...args) ?? null;
  } catch {
    return null;
  }
}

function describeError(error) {
  const text = String(error?.message || error || '').trim();
  return text || 'Intel provider unavailable';
}

/**
 * Create the INTEL panel over its template root.
 * @param {object} options
 * @param {Document} options.document Owner document.
 * @param {HTMLElement} options.root The `#intel-panel` element.
 * @param {HTMLElement|null} [options.rail] `#right-context-rail`; the root is
 *   re-parented into it (above CONTEXT) when it is not already there.
 * @param {object} [options.services] Intel providers and selection readers.
 * @param {object} [options.actions] Shell callbacks: showToast, setPanelHidden,
 *   scheduleLayout, flyTo.
 * @param {Window} [options.windowRef] Event bus; defaults to the document's view.
 * @param {() => number} [options.now] Clock.
 * @returns {{showSubject: Function, refresh: Function, close: Function, destroy: Function}|null}
 */
export function createIntelPanel({
  document,
  root,
  rail = null,
  services = {},
  actions = {},
  windowRef,
  now = () => Date.now(),
} = {}) {
  if (!document?.createElement || !root) return null;
  const view = windowRef || document.defaultView || globalThis.window || null;
  const body = root.querySelector?.('#intel-panel-body');
  const badge = root.querySelector?.('#intel-panel-count') || null;
  if (!body) return null;
  if (rail && root.parentElement !== rail) {
    const anchor = rail.querySelector?.('#global-context-panel') || null;
    rail.insertBefore(root, anchor);
  }

  const cache = createIntelCache();
  const removers = [];
  let destroyed = false;
  /** @type {{subject: object, model: object|null, state: string, error: string}|null} */
  let current = null;
  let generation = 0;
  let controller = null;
  let sanctionsPromise = null;

  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    removers.push(() => target.removeEventListener(type, handler, options));
  };

  function clearBody() {
    if (typeof body.replaceChildren === 'function') body.replaceChildren();
    else while (body.firstChild) body.removeChild(body.firstChild);
  }

  function readLive(subject) {
    const record = safeCall(services.getSelectedEntityContext);
    if (record && String(record.id) === subject.id) return record;
    return subject.record || null;
  }

  function flyTarget() {
    if (!current) return null;
    const live = readLive(current.subject);
    for (const candidate of [live, current.subject, current.model?.raw]) {
      if (
        candidate &&
        Number.isFinite(candidate.latitude) &&
        Number.isFinite(candidate.longitude)
      )
        return { lat: candidate.latitude, lon: candidate.longitude };
    }
    return null;
  }

  function render() {
    if (destroyed) return;
    clearBody();
    const tree = current
      ? renderIntelView({
          subject: current.subject,
          model: current.model,
          state: current.state,
          error: current.error,
          nowMs: now(),
          canFly: Boolean(flyTarget()),
        })
      : renderEmptyView();
    const dom = mountVNode(document, tree);
    if (dom) body.appendChild(dom);
    if (badge) badge.textContent = panelBadgeText(current?.subject);
    safeCall(actions.scheduleLayout);
  }

  function setHidden(hidden) {
    if (root.hidden !== hidden) root.hidden = hidden;
    safeCall(actions.setPanelHidden, hidden);
    safeCall(actions.scheduleLayout);
  }

  async function cachedPayload(key, fetcher) {
    if (cache.has(key)) return cache.get(key);
    const payload = typeof fetcher === 'function' ? await fetcher() : null;
    cache.set(key, payload ?? null);
    return payload ?? null;
  }

  function loadSanctions(provider) {
    if (typeof provider?.loadSanctions !== 'function')
      return Promise.resolve(null);
    if (!sanctionsPromise) {
      sanctionsPromise = Promise.resolve()
        .then(() => provider.loadSanctions())
        .catch(() => {
          sanctionsPromise = null; // a failed index retries on the next vessel
          return null;
        });
    }
    return sanctionsPromise;
  }

  async function buildModel(subject, live, signal) {
    const descriptor = requestDescriptorFor(subject, live);
    const context = { subject, live, descriptor, signal, nowMs: now() };
    switch (subject.kind) {
      case 'aircraft': {
        const provider = services.aircraft;
        if (typeof provider?.build !== 'function')
          return fallbackModelFromSubject(subject, live);
        const payload = descriptor.hex
          ? await cachedPayload(descriptor.key, () =>
              provider.fetch?.({
                hex: descriptor.hex,
                callsign: descriptor.callsign,
                registration: descriptor.registration,
                signal,
              }),
            )
          : null;
        return provider.build({ ...context, payload });
      }
      case 'satellite': {
        const provider = services.satellite;
        if (typeof provider?.build !== 'function')
          return fallbackModelFromSubject(subject, live);
        const payload = descriptor.norad
          ? await cachedPayload(descriptor.key, () =>
              provider.fetch?.({ norad: descriptor.norad, signal }),
            )
          : null;
        const tracked = safeCall(services.getTrackedSatellite);
        return provider.build({
          ...context,
          payload,
          observer: safeCall(services.observer),
          satrec: tracked?.satrec || null,
          tracked,
        });
      }
      case 'vessel': {
        const provider = services.vessel;
        if (typeof provider?.build !== 'function')
          return fallbackModelFromSubject(subject, live);
        const sanctions = await loadSanctions(provider);
        return provider.build({
          ...context,
          sanctions,
          vessel: safeCall(services.getSelectedVessel),
        });
      }
      case 'launch': {
        const provider = services.launch;
        if (typeof provider?.build !== 'function')
          return fallbackModelFromSubject(subject, live);
        return provider.build({
          ...context,
          launch: safeCall(services.getSelectedLaunch) || live,
        });
      }
      case 'event': {
        const provider = services.event;
        if (typeof provider?.build !== 'function')
          return fallbackModelFromSubject(subject, live);
        return provider.build(context);
      }
      default: {
        const provider = services.site;
        if (typeof provider?.build !== 'function')
          return fallbackModelFromSubject(subject, live);
        // Wikidata facts, when the site carries an id; a failed lookup only
        // leaves them out.
        const payload =
          descriptor.wikidata && typeof provider.fetch === 'function'
            ? await cachedPayload(`wikidata:${descriptor.wikidata}`, () =>
                provider.fetch({ wikidata: descriptor.wikidata, signal }),
              ).catch(() => null)
            : null;
        return provider.build({ ...context, payload });
      }
    }
  }

  /** The dossier plus what the enabled layers hold around the subject. */
  function withNearby(model, subject, live) {
    const section = safeCall(services.nearby, { subject, live, model });
    if (!section || !model || typeof model !== 'object') return model;
    return {
      ...model,
      sections: [
        ...(Array.isArray(model.sections) ? model.sections : []),
        section,
      ],
    };
  }

  async function resolve(subject) {
    const gen = ++generation;
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    const sameSubject =
      current?.subject && subjectKey(current.subject) === subjectKey(subject);
    current = {
      subject,
      model: sameSubject ? current.model : null,
      state: INTEL_STATES.loading,
      error: '',
    };
    render();
    // The tracking lanes dispatch their event BEFORE writing the context slot;
    // one microtask later the live record (callsign, noradId, position) exists.
    await Promise.resolve();
    if (gen !== generation || destroyed) return;
    const live = readLive(subject);
    try {
      const built = await buildModel(subject, live, signal);
      if (gen !== generation || destroyed) return;
      current = {
        subject,
        model: normalizeIntelModel(withNearby(built, subject, live), subject),
        state: INTEL_STATES.ready,
        error: '',
      };
    } catch (error) {
      if (signal.aborted || gen !== generation || destroyed) return;
      current = {
        subject,
        model: fallbackModelFromSubject(subject, live, {
          reason: 'Provider failed; showing the selection record instead.',
        }),
        state: INTEL_STATES.error,
        error: describeError(error),
      };
    }
    render();
  }

  function showSubject(input) {
    if (destroyed) return false;
    const subject = coerceSubject(input);
    if (!subject) return false;
    setHidden(false);
    resolve(subject);
    return true;
  }

  /** A clear on the current subject's lane holds the dossier instead of blanking it. */
  function holdSubject(detail) {
    if (!current || !detail || current.subject.tracking === false) return;
    const layerId = String(detail.layerId || '');
    if (layerId && layerId !== current.subject.layerId) return;
    const id =
      detail.id === undefined || detail.id === null ? null : String(detail.id);
    if (id !== null && id !== current.subject.id) return;
    current = {
      ...current,
      subject: { ...current.subject, tracking: false },
      state:
        current.state === INTEL_STATES.loading
          ? INTEL_STATES.loading
          : current.state,
    };
    render();
  }

  function close() {
    generation++;
    controller?.abort();
    controller = null;
    current = null;
    render();
    setHidden(true);
  }

  async function copyJson() {
    if (!current) return;
    const json = JSON.stringify(current.model?.raw ?? current.model, null, 2);
    const clipboard = view?.navigator?.clipboard;
    if (typeof clipboard?.writeText !== 'function') {
      safeCall(actions.showToast, 'Clipboard unavailable');
      return;
    }
    try {
      await clipboard.writeText(json);
      safeCall(actions.showToast, 'Intel JSON copied');
    } catch {
      safeCall(actions.showToast, 'Copy failed');
    }
  }

  function exportJson() {
    if (!current) return;
    const BlobCtor = view?.Blob || globalThis.Blob;
    const urlApi = view?.URL || globalThis.URL;
    if (!BlobCtor || typeof urlApi?.createObjectURL !== 'function') {
      safeCall(actions.showToast, 'Export unavailable');
      return;
    }
    const json = JSON.stringify(
      {
        exportedAt: new Date(now()).toISOString(),
        subject: { ...current.subject, record: undefined },
        model: current.model,
      },
      null,
      2,
    );
    const url = urlApi.createObjectURL(
      new BlobCtor([json], { type: 'application/json' }),
    );
    const anchor = document.createElement('a');
    anchor.setAttribute('href', url);
    anchor.setAttribute('download', exportFileName(current.subject));
    anchor.hidden = true;
    (document.body || root).appendChild(anchor);
    anchor.click?.();
    anchor.remove?.();
    setTimeout(() => urlApi.revokeObjectURL?.(url), 1000);
    safeCall(actions.showToast, 'Intel exported');
  }

  function fly() {
    const target = flyTarget();
    if (!target) {
      safeCall(actions.showToast, 'No position for this subject');
      return;
    }
    if (typeof actions.flyTo === 'function') actions.flyTo(target);
    else safeCall(actions.showToast, 'Fly-to unavailable');
  }

  const ACTIONS = { fly, copy: copyJson, export: exportJson, close };
  listen(body, 'click', (event) => {
    // A NEARBY row: open its camera, or fly to it.
    const target = event.target?.closest?.('.intel-row-target');
    if (target) {
      event.preventDefault?.();
      const cameraId = target.getAttribute('data-intel-camera');
      if (cameraId && typeof actions.openCamera === 'function') {
        actions.openCamera(cameraId);
        return;
      }
      const lat = Number(target.getAttribute('data-intel-fly-lat'));
      const lon = Number(target.getAttribute('data-intel-fly-lon'));
      if (Number.isFinite(lat) && Number.isFinite(lon))
        safeCall(actions.flyTo, { lat, lon });
      return;
    }
    const button = event.target?.closest?.('[data-intel-action]');
    if (!button) return;
    event.preventDefault?.();
    const action = ACTIONS[button.getAttribute('data-intel-action')];
    if (action) action();
  });
  // A dead photo URL removes the figure rather than painting a broken image.
  listen(
    body,
    'error',
    (event) => {
      const image = event.target;
      if (image?.matches?.('img[data-intel-photo]'))
        image.closest?.('figure')?.remove?.();
    },
    true,
  );

  if (view?.addEventListener) {
    listen(view, SUBJECT_SELECTED_EVENT, (event) => {
      const subject = subjectFromAwarenessEvent(event?.detail);
      if (subject) showSubject(subject);
    });
    listen(view, ENTITY_SELECTED_EVENT, (event) => {
      const subject = subjectFromEntityRecord(event?.detail);
      if (subject) showSubject(subject);
    });
    listen(view, SUBJECT_CLEARED_EVENT, (event) => holdSubject(event?.detail));
    listen(view, ENTITY_CLEARED_EVENT, (event) => holdSubject(event?.detail));
  }

  render();

  return {
    showSubject,
    /** The dossier on screen (IntelModel), or null. */
    currentModel: () => current?.model || null,
    refresh() {
      if (current && !destroyed) resolve(current.subject);
    },
    close,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      generation++;
      controller?.abort();
      controller = null;
      for (const remove of removers.splice(0)) remove();
      cache.clear();
      current = null;
      clearBody();
    },
    get subject() {
      return current?.subject || null;
    },
    get model() {
      return current?.model || null;
    },
    get state() {
      return current?.state || INTEL_STATES.idle;
    },
  };
}

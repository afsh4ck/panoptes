/**
 * @module cctvCatalogBar
 * @description The CAMERAS drawer's catalog line: total and live-video
 * counts, an All / Live video filter (the layer's own `liveOnly` param, so
 * map markers, cycling and NEAREST follow it) and a city/street search that
 * narrows the camera picker.
 */

const isLive = (camera) =>
  Boolean(camera?.isVideo) ||
  ['hls', 'mp4', 'webm'].includes(String(camera?.feedType || '').toLowerCase());

/** Counts for the catalog line. */
export function catalogCounts(cameras = []) {
  let live = 0;
  for (const camera of cameras) if (isLive(camera)) live += 1;
  return { total: cameras.length, live };
}

/** Whether a picker entry stays visible for the current filter and query. */
export function cameraVisible(camera, { liveOnly = false, query = '' } = {}) {
  if (!camera) return false;
  if (liveOnly && !isLive(camera)) return false;
  const q = String(query || '')
    .trim()
    .toLowerCase();
  if (!q) return true;
  const text =
    `${camera.city || ''} ${camera.name || ''} ${camera.provider || ''}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  return q
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/\s+/)
    .every((word) => text.includes(word));
}

/**
 * @param {object} options
 * @param {Document} options.document
 * @param {() => object|null} options.getLayer CCTV layer module.
 * @param {(liveOnly: boolean) => void} options.setLiveOnly
 */
export function createCctvCatalogBar({ document, getLayer, setLiveOnly }) {
  const view = document.defaultView || globalThis.window;
  const root = document.querySelector('[data-cctv-catalog]');
  const select = document.getElementById('cctv-camera-select');
  if (!root || !select) return null;
  const countEl = root.querySelector('[data-cctv-count]');
  const liveEl = root.querySelector('[data-cctv-live-count]');
  const buttons = [...root.querySelectorAll('[data-cctv-filter]')];
  const search = root.querySelector('[data-cctv-search]');
  const fmt = new Intl.NumberFormat('es-ES');

  let cameras = [];
  let byId = new Map();
  let liveOnly = false;
  let query = '';
  let unsubscribe = null;
  let frame = 0;

  function applyPicker() {
    view.cancelAnimationFrame(frame);
    frame = view.requestAnimationFrame(() => {
      for (const option of select.options) {
        const visible = cameraVisible(byId.get(option.value), {
          liveOnly,
          query,
        });
        if (option.hidden === visible) option.hidden = !visible;
      }
    });
  }

  function renderFilter() {
    for (const button of buttons) {
      const on = (button.dataset.cctvFilter === 'live') === liveOnly;
      button.classList.toggle('active', on);
      button.setAttribute('aria-checked', String(on));
    }
  }

  function onState(state) {
    if (Array.isArray(state?.cameras) && state.cameras !== cameras) {
      cameras = state.cameras;
      byId = new Map(cameras.map((camera) => [camera.id, camera]));
      const { total, live } = catalogCounts(cameras);
      countEl.textContent = fmt.format(total);
      liveEl.textContent = fmt.format(live);
    }
    const layerLive = Boolean(getLayer()?.getParams?.()?.liveOnly);
    if (layerLive !== liveOnly) {
      liveOnly = layerLive;
      renderFilter();
    }
    applyPicker();
  }

  // The layer module appears once the data manager has initialised it.
  const attach = view.setInterval(() => {
    const layer = getLayer();
    if (!layer?.subscribe) return;
    view.clearInterval(attach);
    unsubscribe = layer.subscribe(onState);
  }, 500);

  const onFilter = (event) => {
    const next = event.currentTarget.dataset.cctvFilter === 'live';
    liveOnly = next;
    renderFilter();
    setLiveOnly(next);
    applyPicker();
  };
  for (const button of buttons) button.addEventListener('click', onFilter);

  const onSearch = () => {
    query = search.value;
    applyPicker();
  };
  // Enter jumps to the first camera that matches.
  const onSearchKey = (event) => {
    if (event.key !== 'Enter') return;
    const first = [...select.options].find((option) =>
      cameraVisible(byId.get(option.value), { liveOnly, query }),
    );
    if (!first) return;
    select.value = first.value;
    select.dispatchEvent(new view.Event('change', { bubbles: true }));
  };
  search?.addEventListener('input', onSearch);
  search?.addEventListener('keydown', onSearchKey);

  return {
    destroy() {
      view.clearInterval(attach);
      view.cancelAnimationFrame(frame);
      unsubscribe?.();
      for (const button of buttons)
        button.removeEventListener('click', onFilter);
      search?.removeEventListener('input', onSearch);
      search?.removeEventListener('keydown', onSearchKey);
    },
  };
}

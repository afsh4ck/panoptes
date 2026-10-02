/**
 * Pure state rules for the PANOPTES workstation layout: which existing panel
 * lives in which region, one-open-per-region exclusivity, the status-bar feed
 * summary and the UTC clock. No DOM.
 */

/** Left rail → drawer panels. Ids are existing panel elements. */
export const DRAWER_ITEMS = Object.freeze([
  Object.freeze({ id: 'data-panel', label: 'Layers', icon: 'layers' }),
  Object.freeze({ id: 'pp-toggles', label: 'Display', icon: 'display' }),
  Object.freeze({ id: 'scene-panel', label: 'Scenes', icon: 'scenes' }),
  Object.freeze({ id: 'cctv-panel', label: 'Cameras', icon: 'camera' }),
  Object.freeze({ id: 'draw-panel', label: 'Draw', icon: 'draw' }),
  Object.freeze({ id: 'route-panel', label: 'Route', icon: 'route' }),
]);

/** Right inspector tabs. `badge` mirrors an existing count element. */
export const INSPECTOR_ITEMS = Object.freeze([
  Object.freeze({ id: 'intel-panel', label: 'Intel', icon: 'intel' }),
  Object.freeze({
    id: 'alerts-panel',
    label: 'Alerts',
    icon: 'alerts',
    badge: 'alerts-panel-count',
  }),
  Object.freeze({
    id: 'case-panel',
    label: 'Case',
    icon: 'case',
    badge: 'case-panel-count',
  }),
  Object.freeze({
    id: 'global-context-panel',
    label: 'Context',
    icon: 'context',
  }),
  Object.freeze({ id: 'weather-panel', label: 'Weather', icon: 'weather' }),
  Object.freeze({
    id: 'recent-imagery-panel',
    label: 'Imagery',
    icon: 'imagery',
  }),
]);

/** Region name for a managed panel id, or null. */
export function regionOf(panelId) {
  if (DRAWER_ITEMS.some((item) => item.id === panelId)) return 'drawer';
  if (INSPECTOR_ITEMS.some((item) => item.id === panelId)) return 'inspector';
  return null;
}

/** Items of one region. */
export function regionItems(region) {
  return region === 'drawer'
    ? DRAWER_ITEMS
    : region === 'inspector'
      ? INSPECTOR_ITEMS
      : [];
}

/**
 * Panels to collapse so only `openedId` stays open in its region.
 * @param {string} openedId Panel that just opened.
 * @param {(id: string) => boolean} isOpen Current open state per panel.
 * @returns {string[]} Panel ids to collapse.
 */
export function exclusiveCollapseTargets(openedId, isOpen) {
  const region = regionOf(openedId);
  if (!region) return [];
  return regionItems(region)
    .map((item) => item.id)
    .filter((id) => id !== openedId && isOpen(id));
}

/**
 * Resolve an initial state where several panels of a region are open (a
 * restored session): keep the first open one in region order.
 * @param {(id: string) => boolean} isOpen
 * @returns {string[]} Panel ids to collapse.
 */
export function initialCollapseTargets(isOpen) {
  const targets = [];
  for (const region of ['drawer', 'inspector']) {
    const open = regionItems(region)
      .map((item) => item.id)
      .filter((id) => isOpen(id));
    targets.push(...open.slice(1));
  }
  return targets;
}

/** Action for a rail button or tab click: open it, or close it when active. */
export function toggleIntent(panelId, isOpen) {
  return { id: panelId, collapsed: Boolean(isOpen(panelId)) };
}

/**
 * Status-bar feed summary from layer manager rows.
 * @param {Array<{enabled?: boolean, stats?: object}>} rows
 */
export function feedSummary(rows = []) {
  let live = 0;
  let loading = 0;
  let degraded = 0;
  for (const row of rows) {
    if (!row?.enabled) continue;
    live++;
    const stats = row.stats || {};
    if (stats.loading) loading++;
    else if (stats.error || stats.lastError || stats.stale) degraded++;
  }
  const parts = [`${live} ${live === 1 ? 'LAYER' : 'LAYERS'} ON`];
  if (loading) parts.push(`${loading} LOADING`);
  if (degraded) parts.push(`${degraded} DEGRADED`);
  return {
    live,
    loading,
    degraded,
    text: parts.join(' · '),
    tone: degraded ? 'warn' : loading ? 'busy' : live ? 'ok' : 'idle',
  };
}

/** `HH:MM:SS UTC` for the top bar clock. */
export function formatUtcClock(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`;
}

/** `YYYY-MM-DD` UTC date for the clock tooltip. */
export function formatUtcDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/**
 * Collapsible chrome regions. Each one can be hidden to give the globe its
 * space back; a small handle stays on screen to restore it.
 */
export const CHROME_REGIONS = Object.freeze([
  'topbar',
  'rail',
  'tabs',
  'statusbar',
  'hud',
]);

/** Browser storage key for the chrome state. */
export const CHROME_STORAGE_KEY = 'panoptes:workspace-chrome:v1';

/** Default: everything visible, focus mode off. */
export function defaultChromeState() {
  return {
    hidden: Object.fromEntries(CHROME_REGIONS.map((id) => [id, false])),
    focus: false,
  };
}

/** Sanitize a stored or partial chrome state. */
export function normalizeChromeState(candidate) {
  const state = defaultChromeState();
  const hidden =
    candidate && typeof candidate === 'object' ? candidate.hidden : null;
  if (hidden && typeof hidden === 'object')
    for (const id of CHROME_REGIONS)
      if (typeof hidden[id] === 'boolean') state.hidden[id] = hidden[id];
  state.focus = candidate?.focus === true;
  return state;
}

/** Toggle one region; leaving focus mode first keeps the result predictable. */
export function toggleChromeRegion(state, region) {
  const next = normalizeChromeState(state);
  if (!CHROME_REGIONS.includes(region)) return next;
  if (next.focus) {
    next.focus = false;
    next.hidden[region] = false;
    return next;
  }
  next.hidden[region] = !next.hidden[region];
  return next;
}

/** Focus mode hides every region at once without losing the saved layout. */
export function toggleFocus(state) {
  const next = normalizeChromeState(state);
  next.focus = !next.focus;
  return next;
}

/** Whether a region is visible under the current state. */
export function chromeVisible(state, region) {
  const normalized = normalizeChromeState(state);
  return !normalized.focus && !normalized.hidden[region];
}

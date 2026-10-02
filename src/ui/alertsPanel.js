/**
 * ALERTS rail panel: watch zones, rule mutes and the alert log, driven by the
 * alert engine and stores. The panel owns only its own DOM; disclosure,
 * docking and rail layout stay with the panel chrome.
 */
import {
  ZONE_RADIUS_OPTIONS_KM,
  ZONE_DEFAULT_RADIUS_KM,
} from '../alerts/zones.js';

const MINUTE = 60_000;
const HOUR = 3600_000;
const DAY = 86_400_000;
const LIST_RENDER_CAP = 120;

/** Human relative time for the alert log. Pure; exported for tests. */
export function relativeTime(atMs, nowMs = Date.now()) {
  const at = Number(atMs);
  if (!Number.isFinite(at)) return '';
  const delta = Math.max(0, nowMs - at);
  if (delta < MINUTE) return 'just now';
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)} min ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)} h ago`;
  if (delta < 2 * DAY) return 'yesterday';
  if (delta < 30 * DAY) return `${Math.floor(delta / DAY)} d ago`;
  try {
    return new Date(at).toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

/** Badge text and state classes for the header count. Pure; exported for tests. */
export function badgeModel(alerts = []) {
  const unread = alerts.filter((alert) => !alert.read);
  const critical = unread.some((alert) => alert.severity === 'critical');
  return {
    text: unread.length > 99 ? '99+' : String(unread.length),
    unread: unread.length > 0,
    critical,
  };
}

/** Coordinates label for a zone row. Pure; exported for tests. */
export function zoneCaption(zone) {
  if (!zone) return '';
  return `${zone.radiusKm} km · ${zone.lat.toFixed(2)}, ${zone.lon.toFixed(2)}`;
}

/**
 * @param {object} options
 * @param {Document} options.document
 * @param {HTMLElement} options.root `#alerts-panel`.
 * @param {object} options.engine createAlertEngine result.
 * @param {object} options.zones Zone store.
 * @param {object} options.store Alert store.
 * @param {object} [options.actions]
 * @param {(text: string) => void} [options.actions.showToast]
 * @param {(target: {lat: number, lon: number, rangeM?: number}) => void} [options.actions.flyTo]
 * @param {() => ({lat: number, lon: number}|null)} [options.actions.getCameraCenter]
 * @param {(hidden: boolean) => void} [options.actions.setPanelHidden]
 * @param {() => void} [options.actions.scheduleLayout]
 * @param {() => number} [options.now]
 * @param {object|null} [options.notificationApi] `Notification` constructor override.
 */
export function createAlertsPanel({
  document,
  root,
  engine,
  zones,
  store,
  actions = {},
  now = Date.now,
  notificationApi = typeof Notification === 'undefined' ? null : Notification,
} = {}) {
  if (!document?.createElement || !root || !engine || !zones || !store)
    return null;
  const body = root.querySelector('#alerts-panel-body');
  const badge = root.querySelector('#alerts-panel-count');
  if (!body) return null;
  const removers = [];
  let destroyed = false;
  const bind = (node, type, handler) => {
    node.addEventListener(type, handler);
    removers.push(() => node.removeEventListener(type, handler));
  };
  const make = (tag, className, parent, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    parent?.appendChild(node);
    return node;
  };
  const toast = (text) => {
    try {
      actions.showToast?.(text);
    } catch {
      /* toast is best effort */
    }
  };
  const flyTo = (alert) => {
    if (alert?.lat == null || alert?.lon == null) {
      toast('No position for this alert');
      return;
    }
    try {
      actions.flyTo?.({ lat: alert.lat, lon: alert.lon, rangeM: alert.rangeM });
    } catch {
      /* camera failures are not the panel's to explain */
    }
  };

  /* ── Static skeleton ────────────────────────────────────────────────── */
  body.textContent = '';
  const toolbar = make('div', 'alerts-toolbar', body);
  const notifyBtn = make('button', 'scene-btn alerts-notify-btn', toolbar);
  notifyBtn.type = 'button';
  notifyBtn.setAttribute('aria-pressed', 'false');
  notifyBtn.title = 'Show browser notifications for new alerts';
  const clearBtn = make('button', 'scene-btn', toolbar, 'CLEAR ALL');
  clearBtn.type = 'button';
  clearBtn.title = 'Remove every alert from the log';
  const status = make('output', 'alerts-status', toolbar);
  status.setAttribute('role', 'status');

  const zoneBlock = make('section', 'alerts-block', body);
  zoneBlock.setAttribute('aria-label', 'Watch zones');
  make('h4', 'alerts-block-title', zoneBlock, 'WATCH ZONES');
  const zoneList = make('ul', 'alerts-zone-list', zoneBlock);
  const zoneForm = make('form', 'alerts-zone-form', zoneBlock);
  const zoneName = make('input', 'alerts-input', zoneForm);
  zoneName.type = 'text';
  zoneName.maxLength = 40;
  zoneName.placeholder = 'Zone name';
  zoneName.setAttribute('aria-label', 'Watch zone name');
  const zoneRadius = make('select', 'alerts-select', zoneForm);
  zoneRadius.setAttribute('aria-label', 'Watch zone radius');
  for (const km of ZONE_RADIUS_OPTIONS_KM) {
    const option = make('option', '', zoneRadius, `${km} km`);
    option.value = String(km);
    if (km === ZONE_DEFAULT_RADIUS_KM) option.selected = true;
  }
  const zoneAdd = make(
    'button',
    'scene-btn alerts-zone-add',
    zoneForm,
    'ADD ZONE HERE',
  );
  zoneAdd.type = 'submit';
  zoneAdd.title = 'Watch a circle around the current map centre';

  const ruleBlock = make('section', 'alerts-block', body);
  ruleBlock.setAttribute('aria-label', 'Alert rules');
  make('h4', 'alerts-block-title', ruleBlock, 'RULES');
  const ruleChips = make('div', 'alerts-rule-chips', ruleBlock);
  ruleChips.setAttribute('role', 'group');
  ruleChips.setAttribute('aria-label', 'Alert rules (press to mute)');

  const listBlock = make('section', 'alerts-block alerts-log-block', body);
  listBlock.setAttribute('aria-label', 'Alert log');
  const listTitle = make('h4', 'alerts-block-title', listBlock, 'ALERTS');
  const list = make('ol', 'alerts-list', listBlock);
  list.setAttribute('role', 'log');
  list.setAttribute('aria-live', 'polite');
  list.setAttribute('aria-relevant', 'additions');
  const empty = make(
    'p',
    'alerts-empty',
    listBlock,
    'No alerts yet. Rules run every 15 s over the layers you have on.',
  );

  /* ── Rendering ──────────────────────────────────────────────────────── */
  function renderBadge() {
    const model = badgeModel(store.list());
    if (badge) {
      badge.textContent = model.text;
      badge.classList.toggle('has-unread', model.unread);
      badge.classList.toggle('is-critical', model.critical);
    }
    root.classList.toggle('alerts-has-unread', model.unread);
    root.classList.toggle('alerts-has-critical', model.critical);
  }

  function renderZones() {
    zoneList.textContent = '';
    const rows = zones.list();
    if (!rows.length) {
      make(
        'li',
        'alerts-zone-empty',
        zoneList,
        'No zones. Fly somewhere and add one.',
      );
    }
    for (const zone of rows) {
      const item = make(
        'li',
        `alerts-zone${zone.enabled ? '' : ' is-off'}`,
        zoneList,
      );
      item.dataset.zoneId = zone.id;
      const toggle = make('button', 'alerts-zone-toggle', item);
      toggle.type = 'button';
      toggle.dataset.zoneAction = 'toggle';
      toggle.setAttribute('aria-pressed', String(zone.enabled));
      toggle.title = zone.enabled ? 'Disable zone' : 'Enable zone';
      make('span', 'alerts-zone-name', toggle, zone.name);
      make('span', 'alerts-zone-caption', toggle, zoneCaption(zone));
      const fly = make('button', 'alerts-mini-btn', item, 'FLY');
      fly.type = 'button';
      fly.dataset.zoneAction = 'fly';
      fly.title = 'Fly to zone';
      const remove = make(
        'button',
        'alerts-mini-btn alerts-mini-danger',
        item,
        '✕',
      );
      remove.type = 'button';
      remove.dataset.zoneAction = 'remove';
      remove.setAttribute('aria-label', `Delete zone ${zone.name}`);
    }
  }

  function renderRules() {
    ruleChips.textContent = '';
    for (const rule of engine.rules()) {
      const chip = make(
        'button',
        `data-toggle-chip alerts-rule-chip${rule.muted ? ' is-muted' : ' active'}`,
        ruleChips,
        rule.muted ? `${rule.label} · MUTED` : rule.label,
      );
      chip.type = 'button';
      chip.dataset.ruleId = rule.id;
      chip.dataset.severity = rule.severity;
      chip.setAttribute('aria-pressed', String(!rule.muted));
      chip.title = rule.description
        ? `${rule.description} (press to ${rule.muted ? 'unmute' : 'mute'})`
        : `Press to ${rule.muted ? 'unmute' : 'mute'}`;
    }
  }

  function renderList() {
    const alerts = store.list();
    list.textContent = '';
    empty.hidden = alerts.length > 0;
    listTitle.textContent = alerts.length
      ? `ALERTS · ${alerts.length}`
      : 'ALERTS';
    const at = now();
    for (const alert of alerts.slice(0, LIST_RENDER_CAP)) {
      const item = make(
        'li',
        `alerts-item${alert.read ? '' : ' is-unread'}`,
        list,
      );
      item.dataset.alertId = alert.id;
      item.dataset.severity = alert.severity;
      make('span', 'alerts-item-bar', item).setAttribute('aria-hidden', 'true');
      const main = make('div', 'alerts-item-main', item);
      make('div', 'alerts-item-title', main, alert.title);
      if (alert.detail) make('div', 'alerts-item-detail', main, alert.detail);
      make(
        'div',
        'alerts-item-meta',
        main,
        [
          alert.severity.toUpperCase(),
          relativeTime(alert.at, at),
          alert.layerId,
        ]
          .filter(Boolean)
          .join(' · '),
      );
      const buttons = make('div', 'alerts-item-actions', item);
      const fly = make('button', 'alerts-mini-btn', buttons, 'FLY TO');
      fly.type = 'button';
      fly.dataset.alertAction = 'fly';
      fly.disabled = alert.lat == null || alert.lon == null;
      const dismiss = make(
        'button',
        'alerts-mini-btn alerts-mini-danger',
        buttons,
        '✕',
      );
      dismiss.type = 'button';
      dismiss.dataset.alertAction = 'dismiss';
      dismiss.setAttribute('aria-label', `Dismiss ${alert.title}`);
    }
  }

  function renderNotify() {
    const on = store.notifyEnabled();
    const supported = Boolean(notificationApi);
    notifyBtn.textContent = supported
      ? on
        ? 'NOTIFY ON'
        : 'NOTIFY OFF'
      : 'NOTIFY N/A';
    notifyBtn.setAttribute('aria-pressed', String(on));
    notifyBtn.disabled = !supported;
    notifyBtn.classList.toggle('active', on);
  }

  function refresh() {
    if (destroyed) return;
    renderBadge();
    renderZones();
    renderRules();
    renderList();
    renderNotify();
    try {
      actions.scheduleLayout?.();
    } catch {
      /* layout is best effort */
    }
  }

  /* ── Interactions ───────────────────────────────────────────────────── */
  bind(zoneForm, 'submit', (event) => {
    event.preventDefault();
    let center = null;
    try {
      center = actions.getCameraCenter?.() || null;
    } catch {
      center = null;
    }
    if (
      !center ||
      !Number.isFinite(center.lat) ||
      !Number.isFinite(center.lon)
    ) {
      toast('Camera centre unavailable — move the globe first');
      return;
    }
    const zone = zones.add({
      name: zoneName.value.trim(),
      lat: center.lat,
      lon: center.lon,
      radiusKm: Number(zoneRadius.value) || ZONE_DEFAULT_RADIUS_KM,
    });
    if (!zone) {
      toast('Could not add zone');
      return;
    }
    zoneName.value = '';
    status.textContent = `Watching ${zone.name}`;
    engine.evaluateNow?.();
  });

  bind(zoneList, 'click', (event) => {
    const button = event.target?.closest?.('[data-zone-action]');
    const item = button?.closest?.('[data-zone-id]');
    if (!button || !item) return;
    const zone = zones.get(item.dataset.zoneId);
    if (!zone) return;
    if (button.dataset.zoneAction === 'toggle') zones.toggle(zone.id);
    else if (button.dataset.zoneAction === 'remove') zones.remove(zone.id);
    else if (button.dataset.zoneAction === 'fly')
      flyTo({ lat: zone.lat, lon: zone.lon, rangeM: zone.radiusKm * 3000 });
  });

  bind(ruleChips, 'click', (event) => {
    const chip = event.target?.closest?.('[data-rule-id]');
    if (!chip) return;
    engine.setMuted(chip.dataset.ruleId);
  });

  bind(list, 'click', (event) => {
    const button = event.target?.closest?.('[data-alert-action]');
    const item = button?.closest?.('[data-alert-id]');
    if (!button || !item) return;
    const alert = store.get(item.dataset.alertId);
    if (!alert) return;
    if (button.dataset.alertAction === 'dismiss') store.dismiss(alert.id);
    else if (button.dataset.alertAction === 'fly') {
      store.markRead(alert.id);
      flyTo(alert);
    }
  });

  bind(clearBtn, 'click', () => {
    store.clear();
    status.textContent = 'Log cleared';
  });

  bind(notifyBtn, 'click', async () => {
    if (!notificationApi) return;
    if (store.notifyEnabled()) {
      store.setNotifyEnabled(false);
      return;
    }
    let permission = notificationApi.permission;
    if (permission !== 'granted') {
      try {
        permission = await notificationApi.requestPermission();
      } catch {
        permission = 'denied';
      }
    }
    if (destroyed) return;
    if (permission === 'granted') store.setNotifyEnabled(true);
    else toast('Browser notifications were not allowed');
  });

  /* ── Subscriptions ──────────────────────────────────────────────────── */
  removers.push(store.subscribe(() => refresh()));
  removers.push(zones.subscribe(() => refresh()));
  removers.push(
    engine.on('alert', (alert) => {
      if (destroyed || !alert) return;
      if (alert.severity === 'critical') toast(`⚠ ${alert.title}`);
      if (
        store.notifyEnabled() &&
        notificationApi &&
        notificationApi.permission === 'granted'
      ) {
        try {
          const note = new notificationApi(alert.title, {
            body: alert.detail || '',
            tag: alert.key,
          });
          note.onclick = () => flyTo(alert);
        } catch {
          /* notifications are best effort */
        }
      }
      if (!root.classList.contains('collapsed')) store.markRead(alert.id);
    }),
  );
  removers.push(
    engine.on('evaluated', ({ at, errors } = {}) => {
      if (destroyed) return;
      status.textContent = errors?.length
        ? `${errors.length} rule error${errors.length === 1 ? '' : 's'}`
        : `Checked ${relativeTime(at, now())}`;
    }),
  );

  // Opening the panel reads the log; the chrome toggles `collapsed` on the
  // root, so watch that class rather than the disclosure button.
  let observer = null;
  if (typeof MutationObserver === 'function') {
    observer = new MutationObserver(() => {
      if (destroyed) return;
      if (!root.classList.contains('collapsed') && store.unreadCount())
        store.markAllRead();
    });
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    removers.push(() => observer.disconnect());
  }

  refresh();

  return {
    refresh,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const remove of removers.splice(0)) {
        try {
          remove();
        } catch {
          /* already released */
        }
      }
      body.textContent = '';
    },
  };
}

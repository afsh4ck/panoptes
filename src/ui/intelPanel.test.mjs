import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntelPanel, mountVNode } from './intelPanel.js';
import { h } from './intelPanelModel.js';

/** Minimal DOM: enough of Element for the panel's mount, delegation and queries. */
function fakeDocument() {
  const document = {
    body: null,
    defaultView: null,
    createTextNode(text) {
      return { nodeType: 3, textContent: String(text), parentNode: null };
    },
    createElement(tag) {
      return new FakeElement(tag, document);
    },
  };
  /** Accessors live on a class: Object.assign would freeze getters as values. */
  class FakeElement extends EventTarget {
    constructor(tag, ownerDocument) {
      super();
      this.nodeType = 1;
      this.tagName = tag.toUpperCase();
      this.ownerDocument = ownerDocument;
      this.childNodes = [];
      this.parentNode = null;
      this.className = '';
      this.hidden = false;
      this.clicked = 0;
      this.attributes = new Map();
    }
    get parentElement() {
      return this.parentNode;
    }
    get firstChild() {
      return this.childNodes[0] || null;
    }
    get children() {
      return this.childNodes.filter((child) => child.nodeType === 1);
    }
    get textContent() {
      return this.childNodes.map((child) => child.textContent).join('');
    }
    set textContent(value) {
      this.childNodes =
        value === '' ? [] : [this.ownerDocument.createTextNode(value)];
    }
    setAttribute(key, value) {
      this.attributes.set(key, String(value));
      if (key === 'id') this.id = String(value);
    }
    getAttribute(key) {
      return this.attributes.has(key) ? this.attributes.get(key) : null;
    }
    appendChild(child) {
      return this.insertBefore(child, null);
    }
    insertBefore(child, reference) {
      if (child.parentNode) child.remove();
      const index = reference
        ? this.childNodes.indexOf(reference)
        : this.childNodes.length;
      this.childNodes.splice(index, 0, child);
      child.parentNode = this;
      return child;
    }
    removeChild(child) {
      const index = this.childNodes.indexOf(child);
      if (index >= 0) this.childNodes.splice(index, 1);
      child.parentNode = null;
      return child;
    }
    replaceChildren() {
      for (const child of this.childNodes) child.parentNode = null;
      this.childNodes = [];
    }
    remove() {
      this.parentNode?.removeChild(this);
    }
    click() {
      this.clicked++;
      for (let target = this; target; target = target.parentNode) {
        const event = new Event('click');
        Object.defineProperty(event, 'target', { value: this });
        target.dispatchEvent(event);
      }
    }
    matches(selector) {
      if (selector.startsWith('#')) return this.id === selector.slice(1);
      if (selector.startsWith('.'))
        return this.className.split(' ').includes(selector.slice(1));
      const attr = selector.match(/^(\w+)?\[([\w-]+)\]$/);
      if (attr)
        return (
          (!attr[1] || this.tagName === attr[1].toUpperCase()) &&
          this.attributes.has(attr[2])
        );
      return false;
    }
    closest(selector) {
      for (let node = this; node && node.nodeType === 1; node = node.parentNode)
        if (node.matches(selector)) return node;
      return null;
    }
    querySelector(selector) {
      const walk = (root) => {
        for (const child of root.children) {
          if (child.matches(selector)) return child;
          const found = walk(child);
          if (found) return found;
        }
        return null;
      };
      return walk(this);
    }
    querySelectorAll(selector) {
      const out = [];
      const walk = (root) => {
        for (const child of root.children) {
          if (child.matches(selector)) out.push(child);
          walk(child);
        }
      };
      walk(this);
      return out;
    }
  }
  document.body = document.createElement('body');
  return document;
}

function emit(view, type, detail) {
  const event = new Event(type);
  Object.defineProperty(event, 'detail', { value: detail });
  view.dispatchEvent(event);
}

function panelFixture({ services = {}, actions = {} } = {}) {
  const document = fakeDocument();
  const view = new EventTarget();
  view.navigator = {
    clipboard: { writeText: async (text) => (view.copied = text) },
  };
  const rail = document.createElement('aside');
  rail.setAttribute('id', 'right-context-rail');
  const context = document.createElement('div');
  context.setAttribute('id', 'global-context-panel');
  rail.appendChild(context);
  const root = document.createElement('div');
  root.setAttribute('id', 'intel-panel');
  root.hidden = true;
  const badge = document.createElement('span');
  badge.setAttribute('id', 'intel-panel-count');
  const body = document.createElement('div');
  body.setAttribute('id', 'intel-panel-body');
  root.appendChild(badge);
  root.appendChild(body);
  document.body.appendChild(root);
  const toasts = [];
  const layouts = { count: 0 };
  const panel = createIntelPanel({
    document,
    root,
    rail,
    services,
    actions: {
      showToast: (text) => toasts.push(text),
      scheduleLayout: () => layouts.count++,
      ...actions,
    },
    windowRef: view,
    now: () => 1_000_000,
  });
  return { document, view, rail, root, badge, body, panel, toasts, layouts };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test('mountVNode builds elements, text and attributes', () => {
  const document = fakeDocument();
  const node = mountVNode(
    document,
    h(
      'div',
      { class: 'a b', 'data-x': 1, skip: null, on: true },
      'hi',
      h('img', { src: 'u' }),
    ),
  );
  assert.equal(node.tagName, 'DIV');
  assert.equal(node.className, 'a b');
  assert.equal(node.getAttribute('data-x'), '1');
  assert.equal(node.getAttribute('skip'), null);
  assert.equal(node.getAttribute('on'), '');
  assert.equal(node.childNodes[0].textContent, 'hi');
  assert.equal(node.children[0].tagName, 'IMG');
  assert.equal(mountVNode(document, null), null);
});

test('the panel re-parents into the rail, starts empty and hidden', () => {
  const { rail, root, body, panel } = panelFixture();
  assert.ok(panel);
  assert.equal(root.parentNode, rail);
  assert.equal(rail.children[0], root); // above CONTEXT
  assert.equal(root.hidden, true);
  assert.ok(body.querySelector('.intel-empty'));
  assert.equal(panel.state, 'idle');
  panel.destroy();
  assert.equal(body.childNodes.length, 0);
});

test('an aircraft selection fetches once, builds the dossier and reads the live slot', async () => {
  const calls = { fetch: [], build: [] };
  let live = null;
  const { view, root, badge, body, panel } = panelFixture({
    services: {
      getSelectedEntityContext: () => live,
      aircraft: {
        fetch: async (query) => {
          calls.fetch.push(query);
          return { registration: 'D-AIBD' };
        },
        build: ({ payload, live: record, descriptor }) => {
          calls.build.push({ payload, record, descriptor });
          return {
            title: payload.registration,
            sections: [
              {
                heading: 'AIRFRAME',
                rows: [{ label: 'Reg', value: payload.registration }],
              },
            ],
            raw: payload,
            fetchedAt: 999_000,
          };
        },
      },
    },
  });
  // The tracking lane dispatches first and writes the context slot right after.
  emit(view, 'gev:awareness-subject-selected', {
    layerId: 'flights',
    id: '3c6444',
    label: 'DLH400',
    origin: 'click',
  });
  live = {
    id: '3c6444',
    layerId: 'flights',
    latitude: 50.1,
    longitude: 8.6,
    properties: { icao24: '3c6444', callsign: 'DLH400' },
  };
  assert.equal(root.hidden, false);
  assert.equal(panel.state, 'loading');
  assert.ok(body.querySelector('.intel-status'));
  await flush();
  assert.equal(panel.state, 'ready');
  assert.deepEqual(calls.fetch, [
    {
      hex: '3c6444',
      callsign: 'DLH400',
      registration: null,
      signal: calls.fetch[0].signal,
    },
  ]);
  assert.equal(calls.build[0].record, live);
  assert.equal(calls.build[0].descriptor.callsign, 'DLH400');
  assert.equal(body.querySelector('.intel-title').textContent, 'D-AIBD');
  assert.equal(badge.textContent, 'AIRCRAFT');
  assert.ok(
    body
      .querySelector('[data-intel-action]')
      .getAttribute('data-intel-action') === 'fly',
  );

  // Re-selecting the same contact reuses the cached payload.
  panel.showSubject({ layerId: 'flights', id: '3c6444', label: 'DLH400' });
  await flush();
  assert.equal(calls.fetch.length, 1);
  assert.equal(calls.build.length, 2);
  panel.destroy();
});

test('a clear on the subject lane holds the dossier; CLOSE hides the panel', async () => {
  const hidden = [];
  const { view, root, badge, body, panel } = panelFixture({
    services: {
      satellite: {
        fetch: async () => ({ OBJECT_NAME: 'ISS' }),
        build: ({ payload }) => ({ title: payload.OBJECT_NAME, raw: payload }),
      },
    },
    actions: { setPanelHidden: (value) => hidden.push(value) },
  });
  emit(view, 'gev:awareness-subject-selected', {
    layerId: 'satellites',
    id: 25544,
    label: 'ISS',
  });
  await flush();
  assert.equal(panel.state, 'ready');
  emit(view, 'gev:awareness-subject-cleared', {
    layerId: 'flights',
    id: 'other',
  });
  assert.equal(panel.subject.tracking, true); // another lane's clear is ignored
  emit(view, 'gev:awareness-subject-cleared', {
    layerId: 'satellites',
    id: '25544',
    reason: 'deliberate',
  });
  assert.equal(panel.subject.tracking, false);
  assert.equal(badge.textContent, 'SATELLITE · HELD');
  assert.ok(body.querySelector('.tone-warn'));
  assert.equal(body.querySelector('.intel-title').textContent, 'ISS');
  const close = body
    .querySelectorAll('[data-intel-action]')
    .find((button) => button.getAttribute('data-intel-action') === 'close');
  close.click();
  assert.equal(root.hidden, true);
  assert.equal(panel.subject, null);
  assert.ok(body.querySelector('.intel-empty'));
  assert.deepEqual(hidden, [false, true]);
  panel.destroy();
});

test('entity selections fall back to the selection record without a provider', async () => {
  const { view, body, panel, toasts } = panelFixture();
  emit(view, 'gev:entity-selected', {
    id: 'n1',
    layerId: 'strategic-ports',
    label: 'Port of Rotterdam',
    latitude: 51.9,
    longitude: 4.1,
    properties: { name: 'Port of Rotterdam', class: 'port', country: 'NL' },
  });
  await flush();
  assert.equal(panel.state, 'ready');
  assert.equal(
    body.querySelector('.intel-title').textContent,
    'Port of Rotterdam',
  );
  assert.ok(body.textContent.includes('No intel provider'));
  assert.ok(body.querySelector('.intel-section'));
  const actions = body
    .querySelectorAll('[data-intel-action]')
    .map((button) => button.getAttribute('data-intel-action'));
  assert.deepEqual(actions, ['fly', 'copy', 'export', 'close']);
  const flown = [];
  panel.destroy();
  const second = panelFixture({
    actions: { flyTo: (target) => flown.push(target) },
  });
  second.panel.showSubject({
    id: 'n1',
    layerId: 'strategic-ports',
    latitude: 51.9,
    longitude: 4.1,
    properties: { name: 'Rotterdam' },
  });
  await flush();
  second.body
    .querySelectorAll('[data-intel-action]')
    .find((button) => button.getAttribute('data-intel-action') === 'fly')
    .click();
  assert.deepEqual(flown, [{ lat: 51.9, lon: 4.1 }]);
  second.body
    .querySelectorAll('[data-intel-action]')
    .find((button) => button.getAttribute('data-intel-action') === 'copy')
    .click();
  await flush();
  assert.ok(second.view.copied.includes('"Rotterdam"'));
  assert.deepEqual(second.toasts, ['Intel JSON copied']);
  assert.deepEqual(toasts, []);
  second.panel.destroy();
});

test('a failing provider reports the error and keeps the selection record', async () => {
  const { view, body, panel } = panelFixture({
    services: {
      vessel: {
        loadSanctions: async () => {
          throw new Error('index offline');
        },
        build: () => {
          throw new Error('HTTP 503');
        },
      },
    },
  });
  emit(view, 'gev:entity-selected', {
    id: '244660000',
    layerId: 'ais-live-vessels',
    label: 'MAERSK X',
    properties: { mmsi: '244660000', type: 'Cargo' },
  });
  await flush();
  assert.equal(panel.state, 'error');
  assert.equal(body.querySelector('.is-error').textContent, 'HTTP 503');
  assert.ok(body.textContent.includes('Provider failed'));
  assert.equal(body.querySelector('.intel-title').textContent, 'MAERSK X');
  panel.destroy();
});

test('a newer selection supersedes an in-flight fetch', async () => {
  let release;
  const { panel, body } = panelFixture({
    services: {
      aircraft: {
        fetch: ({ hex }) =>
          hex === 'aaaaaa'
            ? new Promise(
                (resolve) => (release = () => resolve({ reg: 'SLOW' })),
              )
            : Promise.resolve({ reg: 'FAST' }),
        build: ({ payload }) => ({ title: payload.reg }),
      },
    },
  });
  panel.showSubject({ layerId: 'flights', id: 'aaaaaa' });
  await flush();
  panel.showSubject({ layerId: 'flights', id: 'bbbbbb' });
  await flush();
  assert.equal(body.querySelector('.intel-title').textContent, 'FAST');
  release();
  await flush();
  assert.equal(body.querySelector('.intel-title').textContent, 'FAST');
  assert.equal(panel.subject.id, 'bbbbbb');
  panel.destroy();
});

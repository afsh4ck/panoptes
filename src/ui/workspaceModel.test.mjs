import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DRAWER_ITEMS,
  INSPECTOR_ITEMS,
  exclusiveCollapseTargets,
  feedSummary,
  formatUtcClock,
  initialCollapseTargets,
  regionOf,
  toggleIntent,
} from './workspaceModel.js';
import {
  isWorkstationLayout,
  releaseRailToWorkstation,
} from './workspaceMode.js';

const openSet =
  (...ids) =>
  (id) =>
    ids.includes(id);

test('every managed panel belongs to exactly one region', () => {
  const ids = [...DRAWER_ITEMS, ...INSPECTOR_ITEMS].map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(regionOf('data-panel'), 'drawer');
  assert.equal(regionOf('intel-panel'), 'inspector');
  assert.equal(regionOf('radio-panel'), null);
});

test('opening a panel collapses the others in its region only', () => {
  const isOpen = openSet('data-panel', 'pp-toggles', 'alerts-panel');
  assert.deepEqual(exclusiveCollapseTargets('data-panel', isOpen), [
    'pp-toggles',
  ]);
  assert.deepEqual(
    exclusiveCollapseTargets(
      'intel-panel',
      openSet('intel-panel', 'case-panel', 'data-panel'),
    ),
    ['case-panel'],
  );
  assert.deepEqual(exclusiveCollapseTargets('radio-panel', isOpen), []);
});

test('a restored session keeps the first open panel per region', () => {
  assert.deepEqual(
    initialCollapseTargets(
      openSet(
        'scene-panel',
        'data-panel',
        'case-panel',
        'global-context-panel',
      ),
    ),
    ['scene-panel', 'global-context-panel'],
  );
});

test('rail buttons and tabs toggle their panel', () => {
  assert.deepEqual(toggleIntent('case-panel', openSet()), {
    id: 'case-panel',
    collapsed: false,
  });
  assert.deepEqual(toggleIntent('case-panel', openSet('case-panel')), {
    id: 'case-panel',
    collapsed: true,
  });
});

test('feed summary counts enabled, loading and degraded layers', () => {
  assert.deepEqual(feedSummary([]).text, '0 LAYERS ON');
  const summary = feedSummary([
    { enabled: true, stats: {} },
    { enabled: true, stats: { loading: true } },
    { enabled: true, stats: { error: 'x' } },
    { enabled: false, stats: { error: 'ignored' } },
  ]);
  assert.equal(summary.text, '3 LAYERS ON · 1 LOADING · 1 DEGRADED');
  assert.equal(summary.tone, 'warn');
  assert.equal(feedSummary([{ enabled: true, stats: {} }]).tone, 'ok');
});

test('UTC clock is zero padded', () => {
  assert.equal(
    formatUtcClock(new Date(Date.UTC(2026, 9, 1, 4, 5, 6))),
    '04:05:06 UTC',
  );
});

test('workstation mode releases legacy rail auto-collapse', () => {
  const classes = (names) => {
    const set = new Set(names);
    return {
      contains: (name) => set.has(name),
      remove: (...items) => items.forEach((item) => set.delete(item)),
      has: (name) => set.has(name),
    };
  };
  const panel = {
    classList: classes(['collapsed', 'layout-auto-collapsed']),
    removeAttribute(name) {
      this.removed = name;
    },
  };
  const stack = {
    classList: classes(['layout-focus']),
    querySelectorAll: () => [panel],
    ownerDocument: {
      documentElement: { dataset: { workspace: 'workstation' } },
    },
  };
  const synced = [];
  assert.equal(isWorkstationLayout(stack), true);
  releaseRailToWorkstation(stack, (node) => synced.push(node));
  assert.equal(stack.classList.has('layout-focus'), false);
  assert.equal(panel.classList.has('layout-auto-collapsed'), false);
  assert.equal(panel.classList.has('collapsed'), true);
  assert.equal(panel.removed, 'aria-hidden');
  assert.deepEqual(synced, [panel]);
  assert.equal(
    isWorkstationLayout({
      ownerDocument: { documentElement: { dataset: {} } },
    }),
    false,
  );
});

test('chrome regions toggle, persist through normalization and focus hides all', async () => {
  const {
    CHROME_REGIONS,
    chromeVisible,
    defaultChromeState,
    normalizeChromeState,
    toggleChromeRegion,
    toggleFocus,
  } = await import('./workspaceModel.js');
  let state = defaultChromeState();
  for (const region of CHROME_REGIONS)
    assert.equal(chromeVisible(state, region), true);
  state = toggleChromeRegion(state, 'rail');
  assert.equal(chromeVisible(state, 'rail'), false);
  assert.equal(chromeVisible(state, 'topbar'), true);
  state = toggleFocus(state);
  for (const region of CHROME_REGIONS)
    assert.equal(chromeVisible(state, region), false);
  // Restoring one region from focus mode leaves focus and shows that region,
  // while the regions hidden before focus stay hidden.
  state = toggleChromeRegion(state, 'topbar');
  assert.equal(state.focus, false);
  assert.equal(chromeVisible(state, 'topbar'), true);
  assert.equal(chromeVisible(state, 'rail'), false);
  assert.deepEqual(
    normalizeChromeState({ hidden: { rail: 'yes', tabs: true }, focus: 1 }),
    {
      hidden: {
        topbar: false,
        rail: false,
        tabs: true,
        statusbar: false,
        hud: false,
      },
      focus: false,
    },
  );
  assert.equal(toggleChromeRegion(state, 'unknown').hidden.rail, true);
});

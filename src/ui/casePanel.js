import { caseFilename, createCaseStore } from '../tools/caseStore.js';
import { downloadText, fileTimestamp } from '../tools/download.js';
import { reportFilename } from '../tools/report.js';

const set = (node, key, value) => {
  if (node[key] !== value) node[key] = value;
};

const formatTime = (ms) =>
  Number.isFinite(ms)
    ? `${new Date(ms).toISOString().slice(5, 16).replace('T', ' ')} UTC`
    : '';

const formatPin = (pin) =>
  pin
    ? `${Math.abs(pin.lat).toFixed(3)}°${pin.lat >= 0 ? 'N' : 'S'} ${Math.abs(pin.lon).toFixed(3)}°${pin.lon >= 0 ? 'E' : 'W'}`
    : '';

/**
 * Right-rail CASE panel: a named investigation with notes, pins and tags,
 * persisted per browser. The caller supplies camera, selection, report and
 * toast operations; the panel owns its DOM and the case store.
 *
 * @param {object} options
 * @param {Document} options.document
 * @param {HTMLElement} options.root The `#case-panel` element.
 * @param {object} [options.store] Case store (from createCaseStore); defaults to localStorage.
 * @param {Storage|null} [options.storage] Storage for the default store.
 * @param {object} options.actions
 * @param {() => ({lat: number, lon: number, altM?: number, heading?: number, pitch?: number}|null)} options.actions.getCameraCenter
 * @param {(target: {lat: number, lon: number, altM?: number, heading?: number, pitch?: number, label?: string}) => void} options.actions.flyTo
 * @param {() => ({id: string, label: string, lat: number, lon: number}|null)} [options.actions.getSelectedSubject]
 * @param {(message: string) => void} [options.actions.showToast]
 * @param {() => string} [options.actions.exportReport] Markdown report text.
 * @param {(filename: string, text: string, mime: string) => void} [options.actions.download]
 * @param {() => void} [options.actions.onCountChanged] Notify the shell that the badge changed.
 * @returns {{destroy: Function, refresh: Function, store: object}|null}
 */
export function createCasePanel({
  document,
  root,
  store = null,
  storage,
  actions = {},
} = {}) {
  if (!document?.createElement || !root) return null;
  const body = root.querySelector('#case-panel-body');
  const count = root.querySelector('#case-panel-count');
  if (!body) return null;
  const resolvedStorage =
    storage !== undefined
      ? storage
      : (() => {
          try {
            return document.defaultView?.localStorage || null;
          } catch {
            return null;
          }
        })();
  const caseStore = store || createCaseStore({ storage: resolvedStorage });
  const showToast = (message) => actions.showToast?.(message);
  const download =
    actions.download ||
    ((filename, text, mime) => downloadText(filename, text, mime));
  const removers = [];
  let destroyed = false;
  const bind = (target, type, listener) => {
    target.addEventListener(type, listener);
    removers.push(() => target.removeEventListener(type, listener));
  };
  const make = (tag, className, parent, textContent) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (textContent !== undefined) node.textContent = textContent;
    parent.appendChild(node);
    return node;
  };
  const button = (parent, label, title, handler, extraClass = '') => {
    const node = make(
      'button',
      `scene-btn${extraClass ? ` ${extraClass}` : ''}`,
      parent,
      label,
    );
    node.type = 'button';
    node.title = title;
    bind(node, 'click', handler);
    return node;
  };

  // ── static chrome ──────────────────────────────────────────────
  const nameRow = make('div', 'case-name-row', body);
  const nameInput = make('input', 'case-name-input', nameRow);
  nameInput.type = 'text';
  nameInput.maxLength = 120;
  nameInput.setAttribute('aria-label', 'Case name');
  nameInput.placeholder = 'Case name';
  bind(nameInput, 'change', () => caseStore.rename(nameInput.value));

  make('p', 'case-section-label', body, 'Tags');
  const tagRow = make('div', 'case-tag-row', body);
  const tagChips = make('span', 'case-tag-row', tagRow);
  const tagInput = make('input', 'case-tag-input', tagRow);
  tagInput.type = 'text';
  tagInput.maxLength = 32;
  tagInput.placeholder = 'add tag ⏎';
  tagInput.setAttribute('aria-label', 'Add a case tag');
  bind(tagInput, 'keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    caseStore.addTag(tagInput.value);
    tagInput.value = '';
  });
  bind(tagChips, 'click', (event) => {
    const remove = event.target?.closest?.('[data-remove-tag]');
    if (remove) caseStore.removeTag(remove.dataset.removeTag);
  });

  make('p', 'case-section-label', body, 'New note');
  const noteInput = make('textarea', 'case-note-input', body);
  noteInput.rows = 3;
  noteInput.maxLength = 4000;
  noteInput.placeholder = 'Observation, hypothesis, source…';
  noteInput.setAttribute('aria-label', 'New case note');
  const noteActions = make('div', 'case-actions', body);
  const addNote = (pin) => {
    const text = noteInput.value.trim();
    if (!text && !pin) {
      showToast('Write a note or pin a position first');
      return;
    }
    const note = caseStore.addNote({ text, pin });
    if (!note) {
      showToast('Case is full: export and clear it to continue');
      return;
    }
    noteInput.value = '';
    showToast(pin ? 'Pinned to case' : 'Note added to case');
  };
  button(noteActions, 'ADD NOTE', 'Save the note without a position', () =>
    addNote(null),
  );
  button(
    noteActions,
    'PIN VIEW',
    'Save the note pinned to the current camera center',
    () => {
      const center = actions.getCameraCenter?.();
      if (!center) {
        showToast('Camera position unavailable');
        return;
      }
      addNote({ ...center, label: 'View' });
    },
  );
  button(
    noteActions,
    'PIN SELECTED',
    'Save the note pinned to the selected contact or site',
    () => {
      const subject = actions.getSelectedSubject?.();
      if (!subject) {
        showToast('Select a contact or site first');
        return;
      }
      addNote({
        lat: subject.lat,
        lon: subject.lon,
        altM: subject.altM,
        label: subject.label,
        subjectId: subject.id,
      });
    },
  );

  make('p', 'case-section-label', body, 'Notes');
  const list = make('ol', 'case-notes', body);
  const empty = make(
    'p',
    'case-empty',
    body,
    'No notes yet. Pin a view or a selected contact to start the case.',
  );
  bind(list, 'click', (event) => {
    const target = event.target?.closest?.('[data-note-action]');
    if (!target) return;
    const { noteAction, noteId } = target.dataset;
    const note = caseStore
      .getState()
      .notes.find((entry) => entry.id === noteId);
    if (!note) return;
    if (noteAction === 'fly' && note.pin) {
      actions.flyTo?.({
        lat: note.pin.lat,
        lon: note.pin.lon,
        altM: note.pin.altM ?? undefined,
        heading: note.pin.heading ?? undefined,
        pitch: note.pin.pitch ?? undefined,
        label: note.pin.label || note.text.slice(0, 40),
      });
    } else if (noteAction === 'delete') {
      caseStore.removeNote(noteId);
    }
  });

  make('p', 'case-section-label', body, 'Case file');
  const fileActions = make('div', 'case-actions', body);
  button(fileActions, 'EXPORT CASE', 'Download this case as JSON', () => {
    const state = caseStore.getState();
    download(caseFilename(state), caseStore.exportJson(), 'application/json');
    showToast('Case exported');
  });
  const importInput = make('input', '', body);
  importInput.type = 'file';
  importInput.accept = 'application/json,.json';
  importInput.hidden = true;
  importInput.setAttribute('aria-label', 'Import a case file');
  button(fileActions, 'IMPORT', 'Replace this case from a JSON file', () =>
    importInput.click(),
  );
  bind(importInput, 'change', async () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      if (destroyed) return;
      if (caseStore.importJson(text)) showToast('Case imported');
      else showToast('That file is not a case export');
    } catch {
      showToast('Could not read the case file');
    }
  });
  button(fileActions, 'REPORT', 'Download a Markdown situation report', () => {
    let markdown = '';
    try {
      markdown = String(actions.exportReport?.() || '');
    } catch {
      markdown = '';
    }
    if (!markdown) {
      showToast('Report unavailable');
      return;
    }
    download(reportFilename(), markdown, 'text/markdown');
    showToast('Report downloaded');
  });
  button(
    fileActions,
    'CLEAR',
    'Start a new empty case (export first to keep this one)',
    () => {
      caseStore.clear();
      showToast('Case cleared');
    },
    'scene-btn-danger',
  );

  // ── rendering ──────────────────────────────────────────────────
  function renderTags(state) {
    tagChips.textContent = '';
    for (const tag of state.tags) {
      const chip = make('span', 'case-tag-chip', tagChips, tag);
      const remove = make('button', '', chip, '×');
      remove.type = 'button';
      remove.title = `Remove tag ${tag}`;
      remove.setAttribute('aria-label', `Remove tag ${tag}`);
      remove.dataset.removeTag = tag;
    }
  }

  function renderNotes(state) {
    list.textContent = '';
    empty.hidden = state.notes.length > 0;
    for (const note of state.notes) {
      const item = make('li', 'case-note', list);
      item.dataset.noteId = note.id;
      if (note.text) make('p', 'case-note-text', item, note.text);
      const meta = make('div', 'case-note-meta', item);
      make('span', '', meta, formatTime(note.createdAt));
      if (note.pin)
        make(
          'span',
          'case-note-pin',
          meta,
          `⌖ ${note.pin.label ? `${note.pin.label} · ` : ''}${formatPin(note.pin)}`,
        );
      if (note.tags.length)
        make('span', '', meta, note.tags.map((tag) => `#${tag}`).join(' '));
      const rowActions = make('div', 'case-note-actions', item);
      if (note.pin) {
        const fly = make('button', 'scene-btn', rowActions, 'FLY TO');
        fly.type = 'button';
        fly.dataset.noteAction = 'fly';
        fly.dataset.noteId = note.id;
      }
      const del = make(
        'button',
        'scene-btn scene-btn-danger',
        rowActions,
        'DELETE',
      );
      del.type = 'button';
      del.dataset.noteAction = 'delete';
      del.dataset.noteId = note.id;
    }
  }

  function render(state = caseStore.getState()) {
    if (destroyed) return;
    if (document.activeElement !== nameInput)
      set(nameInput, 'value', state.name);
    renderTags(state);
    renderNotes(state);
    if (count) set(count, 'textContent', String(state.notes.length));
    actions.onCountChanged?.(state.notes.length);
  }

  const unsubscribe = caseStore.subscribe(render);
  render();

  return {
    store: caseStore,
    refresh: () => render(),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      for (const remove of removers.splice(0)) remove();
      body.textContent = '';
    },
  };
}

/** Timestamped file name helper re-exported for callers saving reports. */
export { fileTimestamp };

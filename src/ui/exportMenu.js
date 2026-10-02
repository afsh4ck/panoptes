import {
  collectLayerRecords,
  countPositioned,
  exportFilename,
  renderExport,
} from '../tools/exportLayers.js';
import { downloadText, fileTimestamp } from '../tools/download.js';

const FORMATS = Object.freeze([
  {
    id: 'geojson',
    label: 'GEOJSON',
    title: 'Download enabled layers as GeoJSON',
  },
  { id: 'csv', label: 'CSV', title: 'Download enabled layers as CSV' },
  { id: 'kml', label: 'KML', title: 'Download enabled layers as KML' },
]);

/**
 * Small EXPORT button set for the Data Layers panel header: every enabled
 * layer that exposes analyst records goes into one file.
 *
 * @param {object} options
 * @param {Document} options.document
 * @param {HTMLElement} options.anchor Element the buttons are appended to.
 * @param {() => object[]} options.getLayers Layer rows (`id, name, enabled, source, getAnalystRecords`).
 * @param {(message: string) => void} [options.showToast]
 * @param {(filename: string, text: string, mime: string) => void} [options.download]
 * @returns {{destroy: Function}|null}
 */
export function createExportMenu({
  document,
  anchor,
  getLayers,
  showToast = () => {},
  download = (filename, text, mime) => downloadText(filename, text, mime),
} = {}) {
  if (!document?.createElement || !anchor) return null;
  const host = document.createElement('div');
  host.className = 'layer-export-menu';
  host.setAttribute('role', 'group');
  host.setAttribute('aria-label', 'Export enabled layers');
  const label = document.createElement('span');
  label.className = 'layer-export-label';
  label.textContent = 'EXPORT';
  host.appendChild(label);
  const buttons = [];
  for (const format of FORMATS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'scene-btn layer-export-btn';
    button.dataset.exportFormat = format.id;
    button.textContent = format.label;
    button.title = format.title;
    host.appendChild(button);
    buttons.push(button);
  }
  const onClick = (event) => {
    const button = event.target?.closest?.('[data-export-format]');
    if (!button || !host.contains(button)) return;
    const format = button.dataset.exportFormat;
    let layers;
    try {
      layers = getLayers?.() || [];
    } catch {
      layers = [];
    }
    const collections = collectLayerRecords({ layers });
    const positioned = countPositioned(collections);
    if (!positioned) {
      showToast('Nothing to export: enable a layer with records first');
      return;
    }
    const { text, mime } = renderExport(format, collections, {
      name: 'PANOPTES layer export',
    });
    download(exportFilename(format, fileTimestamp()), text, mime);
    showToast(
      `Exported ${positioned.toLocaleString('en-US')} records from ${collections.length} layer${collections.length === 1 ? '' : 's'}`,
    );
  };
  host.addEventListener('click', onClick);
  anchor.appendChild(host);
  return {
    destroy() {
      host.removeEventListener('click', onClick);
      host.remove();
    },
  };
}

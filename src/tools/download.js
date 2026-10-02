/**
 * Save text to the viewer's machine through a transient Blob URL.
 *
 * @param {string} filename Suggested file name.
 * @param {string} text File contents.
 * @param {string} [mime='text/plain'] MIME type, charset appended when absent.
 * @param {{document?: Document, urlFactory?: {createObjectURL: Function, revokeObjectURL: Function}}} [options]
 *   Test seams; default to the page document and the global URL.
 * @returns {boolean} False when no document is available (headless).
 */
export function downloadText(
  filename,
  text,
  mime = 'text/plain',
  { document = globalThis.document, urlFactory = globalThis.URL } = {},
) {
  if (!document?.createElement || !urlFactory?.createObjectURL) return false;
  const type = /charset=/i.test(mime) ? mime : `${mime};charset=utf-8`;
  const blob = new Blob([String(text ?? '')], { type });
  const url = urlFactory.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = String(filename || 'download.txt');
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  (document.body || document.documentElement).appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // Let the click start the save before the URL is released.
    setTimeout(() => urlFactory.revokeObjectURL?.(url), 1000);
  }
  return true;
}

/** UTC timestamp suitable for a file name: `20260930T181500Z`. */
export function fileTimestamp(date = new Date()) {
  const iso = new Date(date).toISOString();
  return `${iso.slice(0, 19).replace(/[-:]/g, '')}Z`;
}

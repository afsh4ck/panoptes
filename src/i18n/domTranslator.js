import { translateText } from './i18nCore.js';

/**
 * @module domTranslator
 * @description Applies the active language to the live DOM. English is the
 * authored text; in Spanish every text node and user-facing attribute
 * (title, placeholder, aria-label) is looked up in the dictionary, including
 * text that modules write later (a MutationObserver re-translates it). The
 * English original is remembered per node, so switching back restores it
 * exactly.
 */

const ATTRIBUTES = Object.freeze([
  'title',
  'placeholder',
  'aria-label',
  'data-tooltip',
  'data-pnp-title',
]);
const SKIP_SELECTOR = [
  'script',
  'style',
  'noscript',
  'textarea',
  'code',
  'pre',
  'svg',
  '[contenteditable="true"]',
  '[data-i18n-skip]',
  '.cesium-widget-credits',
  '.cesium-credit-lightbox',
  '.material-symbols-outlined',
  '.material-icons',
].join(',');

/**
 * @param {object} options
 * @param {Document} options.document
 * @param {{exact: Map, folded: Map}} options.lookup English → Spanish lookup.
 * @param {'es'|'en'} options.language Initial language.
 */
export function createDomTranslator({ document, lookup, language = 'es' }) {
  const view = document.defaultView || globalThis.window;
  const NodeRef = view?.Node || globalThis.Node;
  let active = language;
  /** Text node → { en, out } where `out` is what we wrote. */
  const texts = new WeakMap();
  /** Element → Map(attribute → { en, out }). */
  const attrs = new WeakMap();
  let observer = null;

  const skipped = (element) =>
    !element || Boolean(element.closest?.(SKIP_SELECTOR));

  function handleText(node) {
    const parent = node.parentElement;
    if (skipped(parent)) return;
    const current = node.data;
    const record = texts.get(node);
    if (record && current === record.out) {
      if (active === 'en') {
        node.data = record.en;
        texts.delete(node);
      }
      return;
    }
    // New text written by the application (English source).
    texts.delete(node);
    if (active === 'en') return;
    const translated = translateText(lookup, current);
    if (translated === null) return;
    texts.set(node, { en: current, out: translated });
    node.data = translated;
  }

  function handleAttribute(element, name) {
    if (skipped(element)) return;
    const current = element.getAttribute(name);
    if (current === null) return;
    let records = attrs.get(element);
    const record = records?.get(name);
    if (record && current === record.out) {
      if (active === 'en') {
        element.setAttribute(name, record.en);
        records.delete(name);
      }
      return;
    }
    records?.delete(name);
    if (active === 'en') return;
    const translated = translateText(lookup, current);
    if (translated === null) return;
    if (!records) attrs.set(element, (records = new Map()));
    records.set(name, { en: current, out: translated });
    element.setAttribute(name, translated);
  }

  function handleElement(element) {
    for (const name of ATTRIBUTES)
      if (element.hasAttribute?.(name)) handleAttribute(element, name);
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === NodeRef.TEXT_NODE) {
      handleText(root);
      return;
    }
    if (root.nodeType !== NodeRef.ELEMENT_NODE) return;
    if (skipped(root)) return;
    handleElement(root);
    const walker = document.createTreeWalker(
      root,
      view.NodeFilter.SHOW_ELEMENT | view.NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (
            node.nodeType === NodeRef.ELEMENT_NODE &&
            node.matches?.(SKIP_SELECTOR)
          )
            return view.NodeFilter.FILTER_REJECT;
          return view.NodeFilter.FILTER_ACCEPT;
        },
      },
    );
    let node = walker.nextNode();
    while (node) {
      if (node.nodeType === NodeRef.TEXT_NODE) handleText(node);
      else handleElement(node);
      node = walker.nextNode();
    }
  }

  function onMutations(records) {
    for (const record of records) {
      if (record.type === 'characterData') handleText(record.target);
      else if (record.type === 'attributes')
        handleAttribute(record.target, record.attributeName);
      else for (const node of record.addedNodes) walk(node);
    }
  }

  function start() {
    walk(document.body);
    observer = new view.MutationObserver(onMutations);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...ATTRIBUTES],
    });
  }

  return {
    start,
    getLanguage: () => active,
    /** Switch language and re-render every surface in place. */
    setLanguage(next) {
      if (next === active) return;
      active = next;
      observer?.takeRecords();
      walk(document.body);
      observer?.takeRecords();
    },
    /** Translate a string programmatically (canvas text, toasts, etc.). */
    t(text) {
      if (active === 'en') return text;
      return translateText(lookup, text) ?? text;
    },
    destroy() {
      observer?.disconnect();
      observer = null;
    },
  };
}

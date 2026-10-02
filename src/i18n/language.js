import {
  LANGUAGE_STORAGE_KEY,
  createLookup,
  normalizeLanguage,
} from './i18nCore.js';
import { createDomTranslator } from './domTranslator.js';
import { DICTIONARY_ES } from './dictionaryEs.js';

/**
 * @module language
 * @description The interface language (Spanish by default, English
 * optional). Installed once at startup; the choice persists per browser.
 *
 * Other modules stay decoupled from this one:
 *  - request a change:   window event `panoptes:set-language` {detail: 'es'|'en'}
 *  - observe a change:   window event `panoptes:language-changed` {detail: lang}
 *  - read the language:  `window.__panoptesLanguage.get()`
 *  - translate a string: `window.__panoptesLanguage.t(text)`
 */

export const LANGUAGE_CHANGED_EVENT = 'panoptes:language-changed';
export const SET_LANGUAGE_EVENT = 'panoptes:set-language';

function readStored(view) {
  try {
    return view.localStorage?.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** @param {Document} document */
export function installLanguage(document) {
  const view = document.defaultView || globalThis.window;
  if (view.__panoptesLanguage) return view.__panoptesLanguage;
  let language = normalizeLanguage(readStored(view));
  const translator = createDomTranslator({
    document,
    lookup: createLookup(DICTIONARY_ES),
    language,
  });
  document.documentElement.lang = language;
  translator.start();

  const controller = {
    get: () => language,
    set(next) {
      language = normalizeLanguage(next);
      try {
        view.localStorage?.setItem(LANGUAGE_STORAGE_KEY, language);
      } catch {
        /* best effort */
      }
      document.documentElement.lang = language;
      translator.setLanguage(language);
      view.dispatchEvent(
        new view.CustomEvent(LANGUAGE_CHANGED_EVENT, { detail: language }),
      );
      return language;
    },
    toggle() {
      return controller.set(language === 'es' ? 'en' : 'es');
    },
    t: (text) => translator.t(text),
  };
  view.addEventListener(SET_LANGUAGE_EVENT, (event) =>
    controller.set(event?.detail),
  );
  view.__panoptesLanguage = controller;
  return controller;
}

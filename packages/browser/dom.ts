import type { Lang, TranslationOptions } from "i18n-keyless-core";
import { watchTranslation } from "./store.ts";

/**
 * The source text of every element `translateDom` has seen. Once an element shows a
 * translation, its text content is no longer the source: the map is what lets a second
 * `translateDom()` pass, or a language switch, translate from the original again.
 */
const sources = new WeakMap<Element, string>();

/** The active watcher of every bound element, so a second pass replaces it, never doubles it. */
const bindings = new WeakMap<Element, () => void>();

/** The options read from an element's `data-i18n-*` attributes. */
function optionsOf(element: HTMLElement): TranslationOptions {
  const { i18nContext, i18nNamespace, i18nOriginLanguage, i18nUnpersistedNamespace, i18nDebug } = element.dataset;
  return {
    context: i18nContext || undefined,
    namespace: i18nNamespace || undefined,
    originLanguage: (i18nOriginLanguage as Lang | undefined) || undefined,
    unpersistedNamespace: i18nUnpersistedNamespace !== undefined && i18nUnpersistedNamespace !== "false",
    debug: i18nDebug !== undefined && i18nDebug !== "false",
  };
}

/**
 * Translates every element carrying `data-i18n` under `root` and keeps them in sync with
 * the store (translation landed, language switched).
 *
 * - the source is the value of `data-i18n` when it is not empty, else the element's text
 * - `data-i18n-context`, `data-i18n-namespace`, `data-i18n-origin-language`,
 *   `data-i18n-unpersisted-namespace` and `data-i18n-debug` map to the translation options
 * - the element's whole text content is replaced by the translation
 *
 * Elements added later are not picked up: call `translateDom(newNode)` for them. Calling it
 * twice on the same element is safe. Returns the function that stops every binding made
 * by this call.
 */
export function translateDom(root: ParentNode = document.body): () => void {
  const elements: HTMLElement[] = [];
  if (root instanceof Element && root.matches("[data-i18n]")) {
    elements.push(root as HTMLElement);
  }
  elements.push(...Array.from(root.querySelectorAll<HTMLElement>("[data-i18n]")));

  const stops: Array<() => void> = [];
  for (const element of elements) {
    bindings.get(element)?.();

    // The element matched `[data-i18n]`, so the attribute is there; an element's
    // `textContent` is always a string (only a document or a doctype answers null).
    const attribute = element.getAttribute("data-i18n")!.trim();
    const source = sources.get(element) ?? attribute;
    const sourceText = source || element.textContent!;
    sources.set(element, sourceText);

    const stopWatching = watchTranslation(sourceText, optionsOf(element), (text) => {
      if (element.textContent !== text) {
        element.textContent = text;
      }
    });
    const stop = () => {
      stopWatching();
      if (bindings.get(element) === stop) {
        bindings.delete(element);
      }
    };
    bindings.set(element, stop);
    stops.push(stop);
  }

  return () => {
    for (const stop of stops) {
      stop();
    }
  };
}

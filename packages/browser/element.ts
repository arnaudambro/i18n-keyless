import type { Lang, TranslationOptions } from "i18n-keyless-core";
import { watchTranslation } from "./store.ts";

/**
 * `<i18n-t context="..." namespace="...">Bonjour</i18n-t>`
 *
 * A thin view on the store: the element's initial text is the source (trimmed, like
 * `<I18nKeylessText>`), the element subscribes on connect and unsubscribes on disconnect.
 * Light DOM, no shadow root: the page's CSS applies as if the text were a `<span>`.
 *
 * Attributes: `context`, `namespace`, `origin-language`, `unpersisted-namespace`, `debug`,
 * `count` (a number: `<i18n-t count="3">{count} articles</i18n-t>`), `ordinal`.
 * Properties: `replace` (object, from JS), `select` (object, from JS: `{ gender: "female" }`),
 * `text` (the source, to set it before the element is connected without text).
 *
 * The element reflects the translation status (docs/PROTOCOL.md 5.5) as
 * `data-i18n-status="pending|ready|unavailable"`, so CSS can style it, e.g.
 * `i18n-t[data-i18n-status="pending"] { opacity: 0.5 }`.
 */
export class I18nTElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ["context", "namespace", "origin-language", "unpersisted-namespace", "debug", "count", "ordinal"];
  }

  private source: string | null = null;
  private replaceMap: TranslationOptions["replace"] | undefined = undefined;
  private selectMap: TranslationOptions["select"] | undefined = undefined;
  private stopWatching: (() => void) | null = null;

  /** The placeholders to replace in the translation: `{ "{name}": "John" }`. */
  get replace(): TranslationOptions["replace"] | undefined {
    return this.replaceMap;
  }

  set replace(value: TranslationOptions["replace"] | undefined) {
    this.replaceMap = value;
    this.rebind();
  }

  /** The `select` values: `{ gender: "female" }`. */
  get select(): TranslationOptions["select"] | undefined {
    return this.selectMap;
  }

  set select(value: TranslationOptions["select"] | undefined) {
    this.selectMap = value;
    this.rebind();
  }

  /** The source text, in the primary language. */
  get text(): string {
    // An element's `textContent` is always a string (only a document or a doctype answers null).
    return this.source ?? this.textContent!;
  }

  set text(value: string) {
    this.source = value;
    this.rebind();
  }

  /** The options this element resolves with, read from its attributes and `replace`. */
  get options(): TranslationOptions {
    const originLanguage = this.getAttribute("origin-language");
    const count = this.getAttribute("count");
    return {
      context: this.getAttribute("context") || undefined,
      namespace: this.getAttribute("namespace") || undefined,
      originLanguage: (originLanguage as Lang | null) || undefined,
      unpersistedNamespace: this.hasAttribute("unpersisted-namespace") && this.getAttribute("unpersisted-namespace") !== "false",
      debug: this.hasAttribute("debug") && this.getAttribute("debug") !== "false",
      replace: this.replaceMap,
      count: count !== null && count.trim() !== "" && !Number.isNaN(Number(count)) ? Number(count) : undefined,
      ordinal: this.hasAttribute("ordinal") && this.getAttribute("ordinal") !== "false" ? true : undefined,
      select: this.selectMap,
    };
  }

  connectedCallback(): void {
    if (this.source) {
      this.bind();
      return;
    }
    const text = this.textContent!;
    if (text.trim()) {
      this.source = text;
      this.bind();
      return;
    }
    // The HTML parser connects an element defined by an early sync script before its
    // children are parsed (happy-dom's innerHTML does the same). Read them one microtask
    // later, once the parser has appended them.
    queueMicrotask(() => {
      if (!this.isConnected || this.stopWatching) {
        return;
      }
      this.source = this.textContent!;
      this.bind();
    });
  }

  disconnectedCallback(): void {
    this.unbind();
  }

  attributeChangedCallback(): void {
    this.rebind();
  }

  private rebind(): void {
    if (this.isConnected && this.stopWatching) {
      this.bind();
    }
  }

  private bind(): void {
    this.unbind();
    // Every caller sets `source` first: `connectedCallback` and the `text` setter, and
    // `rebind` only runs once a `bind` has happened.
    this.stopWatching = watchTranslation(this.source!, this.options, (text, _lang, status) => {
      if (this.textContent !== text) {
        this.textContent = text;
      }
      if (this.getAttribute("data-i18n-status") !== status) {
        this.setAttribute("data-i18n-status", status);
      }
    });
  }

  private unbind(): void {
    this.stopWatching?.();
    this.stopWatching = null;
  }
}

/**
 * Registers `<i18n-t>` (or `name`). Safe to call twice. Returns the element class.
 */
export function defineI18nT(name = "i18n-t"): typeof I18nTElement {
  if (!customElements.get(name)) {
    customElements.define(name, I18nTElement);
  }
  return I18nTElement;
}

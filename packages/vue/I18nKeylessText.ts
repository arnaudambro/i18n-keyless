import { defineComponent, createTextVNode, Comment, type PropType, type VNode } from "vue";
import { type Lang, type TranslationOptions } from "i18n-keyless-core";
import { useI18nKeylessContext } from "./context.ts";
import { resolveTranslation, createTranslationRequester } from "./useTranslation.ts";

export interface I18nKeylessTextProps {
  /**
   * The keys to replace in the text.
   * It's an object where the key is the placeholder and the value is the replacement.
   * Example: { "{{name}}": "John" } will replace all the {{name}} in the text with "John".
   * RegEx is `key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))` so you can use use your own syntax.
   */
  replace?: TranslationOptions["replace"];
  /**
   * The context of the translation.
   * It's useful for ambiguous translations, like "8 heures" in French could be "8 AM" or "8 hours".
   */
  context?: TranslationOptions["context"];
  /**
   * The namespace this translation belongs to. Translations are fetched and persisted per
   * namespace, so splitting a large app into namespaces keeps each storage item small
   * (avoids the localStorage quota error). Defaults to `defaultNamespace` from config.
   */
  namespace?: TranslationOptions["namespace"];
  /**
   * When true, this namespace's translations live in memory only (never persisted, never
   * reloaded at boot). Use for high-cardinality, transient namespaces (e.g. one per discussion).
   */
  unpersistedNamespace?: TranslationOptions["unpersistedNamespace"];
  /**
   * If true, some helpful logs will be displayed in the console.
   */
  debug?: TranslationOptions["debug"];
  /**
   * If the proposed translation from AI is not satisfactory,
   * you can use this field to setup your own translation.
   * You can leave it there forever, or remove it once your translation is saved.
   */
  forceTemporary?: TranslationOptions["forceTemporary"];
  /**
   * The language the text is written in when it differs from the primary language,
   * i.e. user generated content (UGC). The backend translates it into the primary language,
   * keeps the raw text for viewers in that language, and AI-translates all the others.
   * When the current language IS the origin language, the text is rendered as-is (no API call).
   */
  originLanguage?: TranslationOptions["originLanguage"];
}

function isDevelopment(): boolean {
  return typeof process !== "undefined" && process.env?.NODE_ENV === "development";
}

/**
 * The source text of the default slot: the text nodes, joined. Elements inside the slot
 * are flattened to their own text, comments are ignored. The slot must hold the text to
 * translate, written in the primary language.
 */
function slotText(vnodes: VNode[] | undefined): string {
  if (!vnodes) {
    return "";
  }
  let text = "";
  for (const vnode of vnodes) {
    if (vnode.type === Comment) {
      continue;
    }
    if (typeof vnode.children === "string") {
      text += vnode.children;
    } else if (Array.isArray(vnode.children)) {
      text += slotText(vnode.children as VNode[]);
    }
  }
  return text;
}

const warnAboutWhitespace = (text: string) => {
  if (isDevelopment() && text !== text.trim()) {
    console.warn(
      `i18n-keyless received text with leading/trailing whitespace: "${text}". ` +
        "This may cause inconsistencies in translations. Consider trimming the text."
    );
  }
};

/**
 * `<I18nKeylessText>Bonjour</I18nKeylessText>` (aliased `<T>`): renders the default slot's
 * text translated into the current language, as a text node (no wrapper element).
 *
 * The storage key, the provider / request-scope / store resolution, translate-on-miss, the
 * SSR snapshot and `replace` all live in `resolveTranslation`, shared with `t()` and
 * `useTranslation()`, so the three never drift. Reach for those where an element will not
 * do (a `placeholder`, a `title`, a string handed to another library).
 *
 * Reactive on its own: the render reads the reactive store (or the provider scope), so the
 * text updates when the translation lands or the language switches. The miss itself is
 * requested once per instance per language, not on every render.
 */
export const I18nKeylessText = defineComponent({
  name: "I18nKeylessText",
  props: {
    replace: { type: Object as PropType<Record<string, string>>, required: false },
    context: { type: String, required: false },
    namespace: { type: String, required: false },
    unpersistedNamespace: { type: Boolean, required: false, default: undefined },
    debug: { type: Boolean, required: false, default: false },
    forceTemporary: { type: Object as PropType<Partial<Record<Lang, string>>>, required: false },
    originLanguage: { type: String as PropType<Lang>, required: false },
  },
  setup(props, { slots }) {
    const scope = useI18nKeylessContext();
    // Per instance: the miss (and the usage record) for a key goes out once per language,
    // however many times the component re-renders. See `createTranslationRequester`.
    const request = createTranslationRequester();
    let lastText: string | undefined;
    return () => {
      // The slot is read inside the render function so Vue tracks the parent's reactive
      // state used in it (`<T>Langue : {{ lang }}</T>`).
      const rawText = slotText(slots.default?.());
      if (rawText !== lastText) {
        lastText = rawText;
        warnAboutWhitespace(rawText);
      }
      const { text } = resolveTranslation(rawText, props, scope, request);
      return createTextVNode(text);
    };
  },
});

export const T = I18nKeylessText;

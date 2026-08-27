import { createApp } from "vue";
import { I18nKeyless } from "i18n-keyless-vue";
import { initI18n } from "./i18n";
import App from "./App.vue";
import "./styles.css";

// Start i18n-keyless. It's async (it fetches translations for the current language in the
// background); the app renders immediately in the primary language and re-renders into the
// target language as translations arrive, and instantly on later visits from storage.
initI18n();

// The plugin registers <T> / <I18nKeylessText> globally. In SPA mode it takes no options.
createApp(App).use(I18nKeyless).mount("#app");

<script setup lang="ts">
import { ref } from "vue";
import { useI18nKeyless, type Lang } from "i18n-keyless-vue";
import { SUPPORTED_LANGUAGES } from "./i18n";

// Three ways to translate, pick per site:
//  1. <T>texte</T>                       the component, for markup
//  2. t("texte", { context })            from useI18nKeyless(), for template expressions
//  3. getTranslation("texte")            the plain function, outside components
const { t, currentLanguage, setCurrentLanguage } = useI18nKeyless();

// A tiny two-view "router" (no router dependency) so the demo stays focused on
// i18n-keyless. Switching views is client-side navigation: translations persist across it.
const page = ref<"home" | "about">("home");

// Cycles through the supported languages. `setCurrentLanguage` updates the store and
// fetches the new language's translations; everything reading the store re-renders.
function switchLanguage() {
  const index = SUPPORTED_LANGUAGES.indexOf(currentLanguage.value as (typeof SUPPORTED_LANGUAGES)[number]);
  const next = SUPPORTED_LANGUAGES[(index + 1) % SUPPORTED_LANGUAGES.length];
  setCurrentLanguage(next as Lang);
}
</script>

<template>
  <main class="app">
    <header>
      <h1>i18n-keyless · Vite + Vue</h1>
      <nav>
        <button :class="{ active: page === 'home' }" @click="page = 'home'"><T>Accueil</T></button>
        <button :class="{ active: page === 'about' }" @click="page = 'about'"><T>À propos</T></button>
        <button class="switch" @click="switchLanguage">
          <T>Changer de langue</T> ({{ currentLanguage }})
        </button>
      </nav>
    </header>

    <!-- Page A: text written in the primary language (French), rendered through <T>.
         Note `replace` to inject a runtime value. -->
    <section v-if="page === 'home'" class="card">
      <p class="lang-line">
        <T :replace="{ '{lang}': currentLanguage ?? '' }">Langue : {lang}</T>
      </p>
      <p>
        <T>
          Voici une phrase disponible dans toutes vos langues, vous pouvez la modifier si vous le
          souhaitez.
        </T>
      </p>
      <p class="muted">
        <T>
          Attention aussi : les traductions n'ont lieu qu'une seule fois, comme une recherche Google :
          elles sont ensuite gardées en cache pour un chargement instantané.
        </T>
      </p>
      <input :placeholder="t('Votre email')" />
    </section>

    <!-- Page B: different strings than Home, through `t()` (for attributes and dynamic text)
         plus the `context` option: "8 heures" is "8 AM" (a time) or "8 hours" (a duration). -->
    <section v-else class="card">
      <h2><T>À propos de cette démo</T></h2>
      <p>{{ t("Ce texte est rendu avec la fonction t() au lieu du composant T.") }}</p>
      <p class="context-line">
        <code>8 heures</code> (heure) → <strong>{{ t("8 heures", { context: "heure" }) }}</strong>
        &nbsp;·&nbsp;
        <code>8 heures</code> (durée) → <strong>{{ t("8 heures", { context: "durée" }) }}</strong>
      </p>
    </section>
  </main>
</template>

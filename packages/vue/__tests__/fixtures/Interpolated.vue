<script setup lang="ts">
import { ref } from "vue";
import { T, useI18nKeyless, useTranslation } from "../../index.ts";

const name = ref("Anna");
const { t, currentLanguage } = useI18nKeyless();
const placeholder = useTranslation(() => `Bonjour ${name.value}`);
defineExpose({ name });
</script>

<template>
  <p id="slot"><T>Bonjour {{ name }}</T></p>
  <p id="t">{{ t("Au revoir", { context: "formel" }) }}</p>
  <p id="lang">{{ currentLanguage }}</p>
  <input id="placeholder" :placeholder="placeholder" />
</template>

/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, unknown>;
  export default component;
}

interface ImportMetaEnv {
  readonly VITE_I18N_KEYLESS_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

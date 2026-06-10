/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_I18N_KEYLESS_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

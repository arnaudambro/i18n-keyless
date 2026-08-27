import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  // The library is linked via file:../../packages/* and pulls Vue through its own
  // dependency tree; dedupe ensures a single Vue instance (one reactivity system).
  resolve: { dedupe: ["vue"] },
});

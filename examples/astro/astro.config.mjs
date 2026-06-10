import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import node from "@astrojs/node";

export default defineConfig({
  output: "server", // SSR (server-render per request) so /:lang renders that language
  adapter: node({ mode: "standalone" }),
  integrations: [react()],
});

import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["__tests__/**/*.test.ts"],
    // the node service keeps a module-level store; each file gets a fresh module registry
    isolate: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      all: true,
      include: ["service.ts"],
    },
  },
  resolve: {
    alias: {
      "i18n-keyless-core": resolve(__dirname, "../core"),
      "i18n-keyless-core/types": resolve(__dirname, "../core/types.ts"),
    },
  },
});

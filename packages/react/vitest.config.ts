import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "happy-dom",
    setupFiles: ["./__tests__/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      // Measure real source only: barrel re-exports, type-only files, configs and the
      // test doubles themselves are not behaviour.
      all: true,
      include: ["*.ts", "*.tsx"],
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/test/**",
        "**/__tests__/**",
        "**/*.config.*",
        "index.ts",
        "types.ts",
      ],
    },
    include: ["**/*.test.ts", "**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "i18n-keyless-core": resolve(__dirname, "../core"),
    },
  },
});

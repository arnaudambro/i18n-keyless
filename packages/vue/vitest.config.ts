import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";

export default defineConfig({
  plugins: [vue()],
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
      include: ["*.ts"],
      exclude: ["**/node_modules/**", "**/dist/**", "**/__tests__/**", "**/*.config.*", "index.ts", "types.ts"],
      // The floor, not the target: every source file sits at or near 100%. A drop below
      // fails `vitest run --coverage` (and so `prepublishOnly` through `npm run test`
      // does not, only the explicit coverage run does).
      thresholds: { lines: 95, functions: 95, branches: 90, statements: 95 },
    },
    include: ["**/*.test.ts"],
  },
  resolve: {
    alias: {
      "i18n-keyless-core": resolve(__dirname, "../core"),
    },
  },
});

import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "happy-dom",
    environmentOptions: {
      happyDOM: {
        // `findAutoScript` tests insert <script src>: happy-dom must not try to load them.
        settings: { disableJavaScriptFileLoading: true, handleDisabledFileLoadingAsSuccess: true },
      },
    },
    include: ["__tests__/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      all: true,
      include: ["*.ts"],
      exclude: ["**/node_modules/**", "**/dist/**", "**/__tests__/**", "**/*.config.*", "index.ts", "types.ts"],
      thresholds: { lines: 95, functions: 95, branches: 90, statements: 95 },
    },
  },
  resolve: {
    alias: {
      "i18n-keyless-core": resolve(__dirname, "../core"),
    },
  },
});

import { defineConfig } from "vitest/config";
import { resolve } from "path";

// Angular under vitest: JIT compilation (the `@angular/compiler` import in the setup file)
// plus TypeScript's legacy decorators, which is what Angular's JIT decorators are. Vite
// reads `experimentalDecorators` / `useDefineForClassFields` from tsconfig.json, but the
// values are pinned here too so a tsconfig edit cannot silently break the suite.
export default defineConfig({
  esbuild: {
    target: "es2022",
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: false,
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./__tests__/setup.ts"],
    include: ["__tests__/**/*.test.ts"],
    // Every test file boots TestBed and mutates the module-scoped store: keep files isolated
    // (the default) but run them in one worker so zone.js is patched once per file, not
    // shared between files.
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      all: true,
      include: ["*.ts"],
      exclude: ["**/node_modules/**", "**/dist/**", "**/__tests__/**", "**/*.config.*", "index.ts", "types.ts"],
      // The run fails when the package drops below these.
      thresholds: { lines: 95, functions: 95, branches: 90, statements: 95 },
    },
  },
  resolve: {
    // Test against the core *source* (same as the react package), not its dist.
    alias: {
      "i18n-keyless-core": resolve(__dirname, "../core"),
    },
  },
});

/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";

// The TanStack Start plugin is loaded only for dev/build (not under the test runner).
export default defineConfig(async ({ mode }) => {
  const plugins =
    mode === "test"
      ? [viteReact()]
      : [(await import("@tanstack/react-start/plugin/vite")).tanstackStart(), viteReact()];

  return {
    plugins,
    resolve: { dedupe: ["react", "react-dom"] },
    test: {
      environment: "happy-dom",
      globals: true,
      setupFiles: ["./src/test-setup.ts"],
      include: ["src/**/*.test.tsx"],
      // file:-linked lib → inline it + zustand so they share the test's single React.
      server: { deps: { inline: ["i18n-keyless-react", "i18n-keyless-core", "zustand"] } },
    },
  };
});

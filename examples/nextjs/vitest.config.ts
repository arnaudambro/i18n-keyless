import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Vitest config for the component tests (separate from Next's own build).
export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ["react", "react-dom"] },
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.tsx"],
    server: { deps: { inline: ["i18n-keyless-react", "i18n-keyless-core", "zustand"] } },
  },
});

import { defineConfig } from "vitest/config";

// Vite serves the whole project root in dev (visit /demo/); the production
// build bundles the demo page. Vitest reads the TypeScript sources directly,
// so no separate compile step is needed for tests.
export default defineConfig({
  server: {
    port: 3030,
    open: "/demo/",
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: "demo/index.html",
    },
  },
  test: {
    // Only the live test suite; the frozen poc/ keeps its own node:test files.
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      // E2E test fixtures have their own pure-helper unit tests (e.g.
      // `tests/e2e/_fixtures/transient-retry.test.ts`). They are isolated
      // from `@playwright/test` so they run cleanly in vitest's jsdom env.
      // Keep the include narrow to `_fixtures/` so the actual Playwright
      // specs (which DO import `@playwright/test`) are not pulled in.
      "tests/e2e/_fixtures/**/*.{test,spec}.{ts,tsx}",
    ],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});

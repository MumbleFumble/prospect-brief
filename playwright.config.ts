import { defineConfig } from '@playwright/test';

/**
 * Playwright e2e for the built extension (inc-013). Kept separate
 * from the vitest unit suite (src/**) — run via `npm run test:e2e`,
 * which builds the extension first.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  workers: 1,
  reporter: 'list',
  use: {
    trace: 'retain-on-failure',
  },
});

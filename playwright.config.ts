import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  testMatch: 'e2e/**/*.spec.ts',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true
  },
  webServer: {
    command: 'pnpm.cmd dev --host 127.0.0.1 --strictPort --port 4173',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 120000
  }
});

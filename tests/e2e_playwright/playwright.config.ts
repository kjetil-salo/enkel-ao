import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    headless: process.env.CI ? true : false,
    viewport: { width: 480, height: 800 },
    // Screenshot ved feil
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  // Start mock-server automatisk hvis MOCK_PORT er satt
  webServer: process.env.MOCK_PORT ? {
    command: 'npx ts-node mock-server.ts',
    port: parseInt(process.env.MOCK_PORT),
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  } : undefined,
});

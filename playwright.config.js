import { defineConfig } from '@playwright/test';
import { loadEnvironment } from './src/config/env.js';

loadEnvironment();

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:3100', headless: true, trace: 'retain-on-failure' },
  webServer: { command: 'node tests/preview-server.js', url: 'http://127.0.0.1:3100', env: { PORT: '3100' }, reuseExistingServer: !process.env.CI && !process.env.TEST_DATABASE_URL, gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 } },
  projects: [{ name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } }, { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }],
});

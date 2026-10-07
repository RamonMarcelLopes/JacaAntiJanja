import { defineConfig } from '@playwright/test';

// The tests launch real Electron windows (host + guest), so they run one at a time.
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
});

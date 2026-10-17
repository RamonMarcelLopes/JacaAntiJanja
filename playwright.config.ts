import { defineConfig } from '@playwright/test';

// The tests launch real Electron windows (host + guest), so they run one at a time.
// Two projects: the original interface (e2e) and the new one (e2e-next). When only one interface is touched, run only its project:
//   pnpm test:e2e:legacy   or   pnpm test:e2e:next      (code shared by both - the Session, the main process, the Worker - needs both: pnpm test:e2e)
export default defineConfig({
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'legacy', testDir: 'e2e' },
    { name: 'next', testDir: 'e2e-next' },
  ],
});

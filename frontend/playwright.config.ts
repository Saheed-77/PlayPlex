import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end against the real stack (docs/06 §8). These run over HTTP against a running
 * API and MySQL — mocking here would defeat the point, since what the test exists to prove
 * is that a live update actually crosses the wire between two people's screens.
 *
 *   docker compose up -d && npx playwright test
 *
 * Or against the dev servers: E2E_BASE_URL=http://localhost:5173 with
 * `VITE_API_MODE=http npm run dev` and `./mvnw spring-boot:run` already up.
 */
export default defineConfig({
  testDir: './e2e',
  // The board is a clock. Running these files at the same time would have two specs
  // fighting over the same stations.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 60_000,
  expect: {
    // Live updates arrive over SSE, not from a click this test made. Give them a moment.
    timeout: 15_000,
  },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chrome',
      // The installed Chrome rather than a downloaded build: it is the browser the staff
      // tablets actually run, and it saves every CI machine a 150MB download.
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
})

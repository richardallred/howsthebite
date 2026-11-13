// Browser (end-to-end) tests. Run with `npm run test:e2e`.
//
// The tests never touch the real weather or USGS services: every external
// request is answered from fixtures in e2e/support/api-mocks.js, and the clock
// is pinned, so results are identical on every run and no rate limit is spent.
//
// By default Playwright's bundled Chromium is used (`npx playwright install chromium`).
// To use a browser that is already installed instead: PLAYWRIGHT_CHANNEL=chrome npm run test:e2e

import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const channel = process.env.PLAYWRIGHT_CHANNEL || undefined;
// Point the tests at an already-running site instead of starting the static server, e.g. a
// Pages preview (`npm run preview`, then E2E_BASE_URL=http://localhost:8788 npm run test:e2e),
// which also exercises the Content-Security-Policy in _headers.
const externalBaseUrl = process.env.E2E_BASE_URL || undefined;

export default defineConfig({
    testDir: 'e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
    timeout: 20_000,
    expect: { timeout: 5_000 },

    use: {
        baseURL: externalBaseUrl ?? `http://localhost:${PORT}`,
        channel,
        serviceWorkers: 'block', // offline.spec.js opts back in
        trace: 'retain-on-failure',
    },

    projects: [
        {
            name: 'desktop',
            testIgnore: /mobile\.spec\.js/,
            use: { ...devices['Desktop Chrome'], channel },
        },
        {
            name: 'mobile',
            testMatch: /mobile\.spec\.js/,
            use: { ...devices['Pixel 7'], channel },
        },
    ],

    webServer: externalBaseUrl ? undefined : {
        command: `npx http-server . -p ${PORT} -c-1 -s`,
        url: `http://localhost:${PORT}/index.html`,
        reuseExistingServer: !process.env.CI,
    },
});

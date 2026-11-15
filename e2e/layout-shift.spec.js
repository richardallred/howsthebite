// Cumulative Layout Shift: the page should not jump about while it loads.
//
// The page is painted before the app's scripts run, and the conditions arrive later still,
// so index.html carries the same placeholders the app shows while loading (factors, lures,
// best times, the first-visit notice), each about as tall as what replaces it. These tests
// slow every external answer down, as a real network does, and add up the layout shifts the
// browser reports, the way Core Web Vitals does (largest burst of shifts less than a second
// apart). Google counts 0.1 or less as good.

import { expect, test } from './support/fixtures.js';

const NETWORK_DELAY_MS = 500;
const MAX_CLS = 0.05; // half the "good" threshold, so a regression is caught before it matters

const VIEWPORTS = {
    desktop: { width: 1280, height: 900 },
    phone: { width: 412, height: 915 },
};

const SCENARIOS = {
    'a first visit': { path: '/' },
    'a link to a place': { path: '/fishing/44.32,-73.32/lake-champlain-vermont' },
    'a return visit with a saved place': { before: '/fishing/41.51,-82.94/lake-erie-at-port-clinton-ohio', path: '/' },
};

/** Collects layout shifts not caused by input, from the very start of the page. */
function recordShifts() {
    window.layoutShifts = [];
    new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) window.layoutShifts.push({ t: entry.startTime, value: entry.value });
        }
    }).observe({ type: 'layout-shift', buffered: true });
}

/** The largest session window: shifts less than 1 s apart, within 5 s in all. */
function cumulativeLayoutShift(shifts) {
    let largest = 0;
    let current = 0;
    let start = 0;
    let last = -Infinity;
    for (const { t, value } of shifts) {
        if (t - last > 1000 || t - start > 5000) {
            current = 0;
            start = t;
        }
        current += value;
        last = t;
        largest = Math.max(largest, current);
    }
    return largest;
}

for (const [device, viewport] of Object.entries(VIEWPORTS)) {
    for (const [name, scenario] of Object.entries(SCENARIOS)) {
        test(`${device}: ${name} loads without the page jumping`, async ({ page, context, app }) => {
            await page.setViewportSize(viewport);
            if (scenario.before) await app.open(scenario.before);

            await context.route((url) => url.hostname !== 'localhost' || url.pathname.startsWith('/api/'), async (route) => {
                await new Promise((resolve) => { setTimeout(resolve, NETWORK_DELAY_MS); });
                return route.fallback();
            });
            await page.addInitScript(recordShifts);
            await app.open(scenario.path);
            await page.waitForTimeout(1500); // the water trend and anything else that follows the first paint

            const cls = cumulativeLayoutShift(await page.evaluate(() => window.layoutShifts));
            expect(cls, 'cumulative layout shift').toBeLessThan(MAX_CLS);
        });
    }
}

import { expect, test } from './support/fixtures.js';

test.describe('water temperature stations', () => {
    test('lists open-water sensors nearest first and uses the nearest one', async ({ page, app }) => {
        await app.open();

        // The groundwater well and the level-only gauge must not be offered as temperature sources.
        await expect(page.locator('.station-name')).toHaveText([
            'Fox River near Testville, IL',
            'Clear Lake at Test Dam, IL',
            'Rock Creek at Sample Rd near Example, IL',
        ]);
        await expect(app.station('Fox River')).toHaveAttribute('aria-pressed', 'true');
        await expect(app.station('Fox River')).toContainText('River · 2.0 mi · 15 min ago');
        await expect(app.station('Fox River')).toContainText('68.0°F');
        await expect(page.locator('#waterSummary')).toContainText('USGS reading from Fox River near Testville, IL, 2.0 mi away');
    });

    test('choosing another station updates the score inputs and is remembered', async ({ page, app }) => {
        await app.open();
        await app.station('Clear Lake').click();

        await expect(app.station('Clear Lake')).toHaveAttribute('aria-pressed', 'true');
        await expect(app.station('Fox River')).toHaveAttribute('aria-pressed', 'false');
        await expect(app.factor('Water temperature').locator('.factor-value')).toHaveText('71.6°F');
        await expect(page.locator('#waterChart .chart-end-label')).toHaveText('72°');

        await page.reload();
        await app.loaded();
        await expect(app.station('Clear Lake')).toHaveAttribute('aria-pressed', 'true');
    });

    test('filters by lakes or rivers and falls back to a labelled estimate', async ({ page, api, app }) => {
        await app.open();

        await page.getByRole('button', { name: 'Lakes' }).click();
        await expect(page.locator('.station-name')).toHaveText(['Clear Lake at Test Dam, IL']);
        await expect(app.station('Clear Lake')).toHaveAttribute('aria-pressed', 'true');

        await page.getByRole('button', { name: 'Rivers' }).click();
        await expect(page.locator('.station-name')).toHaveText([
            'Fox River near Testville, IL', 'Rock Creek at Sample Rd near Example, IL',
        ]);

        // The filter is remembered, and a place with no matching sensor gets an honest estimate.
        api.stations = api.stations.filter((station) => station.type !== 'LK');
        await page.getByRole('button', { name: 'Lakes' }).click();
        await page.reload();
        await page.getByRole('button', { name: 'Refresh conditions' }).click();
        await expect(page.locator('#waterSummary')).toContainText('No USGS lake sensors are reporting within 60 miles');
        await expect(app.factor('Water temperature').locator('.factor-value')).toHaveText('≈ 72.0°F');
        await expect(app.factor('Water temperature')).toContainText('(estimated)');
        await expect(page.locator('#waterChart .chart-empty')).toContainText('no measured history');
    });

    test('the map shows one marker per listed station', async ({ page, app }) => {
        await app.open();
        await page.locator('#water').scrollIntoViewIfNeeded();
        await expect(page.locator('.leaflet-container .map-station')).toHaveCount(3);
        await expect(page.locator('.map-station.is-selected')).toHaveCount(1);
        await expect(page.locator('.leaflet-control-attribution')).toContainText('OpenStreetMap');
    });
});

test.describe('water level and flow', () => {
    test('shows river level, flow and the 24-hour change for the selected station', async ({ page, app }) => {
        await app.open();
        const stats = page.locator('#levelStats');

        await expect(stats).toContainText('River level');
        await expect(stats).toContainText('3.42 ft');
        await expect(stats).toContainText('gage height');
        await expect(stats).toContainText('1,250 cfs');
        // The fixture rises 0.30 ft over 48 hours.
        await expect(stats).toContainText('+0.15 ft');
        await expect(stats).toContainText('Rising');
        await expect(page.locator('#levelSource')).toContainText('USGS gauge: Fox River near Testville, IL');
        await expect(page.locator('#levelSource')).toContainText('not from the bottom');

        await expect(page.locator('#levelChartTitle')).toHaveText('River level');
        await expect(page.locator('#levelChart .chart-end-label')).toHaveText('3.42');
    });

    test('shows lake elevation, without flow, when a lake station is selected', async ({ page, app }) => {
        await app.open();
        await app.station('Clear Lake').click();
        const stats = page.locator('#levelStats');

        await expect(stats).toContainText('Lake level');
        await expect(stats).toContainText('759.32 ft');
        await expect(stats).toContainText('elevation, NAVD 88');
        await expect(stats.locator('.level-stat')).toHaveText([
            'Lake level759.32 ftelevation, NAVD 88',
            '24-hour change0.00 ftSteady', // no flow for a lake, and no "−0.00"
        ]);
        await expect(page.locator('#levelChartTitle')).toHaveText('Lake level');
    });

    test('borrows the nearest gauge when the temperature station has none', async ({ page, app }) => {
        await app.open();
        await app.station('Rock Creek').click();

        // Rock Creek (12 mi north) has no gauge; Fox River (2 mi north) is the closest one to it.
        await expect(page.locator('#levelSource')).toContainText('USGS gauge: Fox River near Testville, IL');
        await expect(app.factor('Water temperature').locator('.factor-value')).toHaveText('65.3°F');
    });

    test('says so when no gauge is nearby', async ({ page, api, app }) => {
        api.stations = api.stations.filter((station) => station.id === 'USGS-05500003');
        await app.open();
        await expect(page.locator('#levelSource')).toHaveText('No USGS level or flow gauges are reporting within 60 miles.');
        await expect(page.locator('#levelChart .chart-empty')).toHaveText('No level gauge nearby.');
    });
});

test.describe('USGS caching proxy', () => {
    test('on plain static hosting the app notices there is no proxy and talks to USGS directly', async ({ page, api, app }) => {
        await app.open();
        await expect(app.factor('Water temperature').locator('.factor-value')).toHaveText('68.0°F');

        expect(api.count('proxy')).toBe(1); // one probe, answered 404
        expect(api.count('usgs')).toBeGreaterThanOrEqual(4);
        await page.getByRole('button', { name: 'Refresh conditions' }).click();
        await app.loaded();
        expect(api.count('proxy')).toBe(1); // and it is not asked again
    });

    test('when the proxy is deployed, every USGS request goes through it and no key is sent from the browser', async ({ page, api, app }) => {
        api.proxy = true;
        await app.open();

        await expect(app.station('Fox River')).toHaveAttribute('aria-pressed', 'true');
        await expect(app.factor('Water temperature').locator('.factor-value')).toHaveText('68.0°F');
        await expect(page.locator('#levelStats')).toContainText('3.42 ft');
        await expect(page.locator('#waterChart .chart-line')).toHaveCount(1);
        await expect(page.locator('.lure-trend-head')).toHaveText('Water, last 30 days'); // the month behind the lure picks

        expect(api.count('usgs')).toBe(0);
        const proxied = api.calls.filter((call) => call.service === 'proxy').map((call) => new URL(call.url));
        expect(proxied.map((url) => url.pathname).sort()).toEqual([
            '/api/usgs/continuous/items', '/api/usgs/continuous/items', '/api/usgs/daily/items',
            '/api/usgs/latest-continuous/items', '/api/usgs/monitoring-locations/items',
            '/api/usgs/statistics/observationNormals', '/api/usgs/statistics/observationNormals', // flow, then water temperature
        ]);
        await expect(app.factor('River flow')).toContainText('Normal for the date');
        for (const url of proxied) expect(url.searchParams.has('api_key')).toBe(false);
    });

    test('a proxy that reports a rate limit is not bypassed', async ({ page, api, app }) => {
        api.proxy = true;
        api.fail('proxy', 429);
        await app.open();
        await expect(page.locator('#waterSummary')).toContainText('USGS is rate-limiting requests right now.');
        expect(api.count('usgs')).toBe(0);
    });
});

test('a searched lake takes its level from the lake gauge even when the thermometer is on a river', async ({ page, api, app }) => {
    // The lake's gauge reports elevation only, so the nearest thermometer is the river's.
    api.stations = api.stations.map((station) => (station.id === 'USGS-05500002'
        ? { ...station, readings: { 62615: 759.32 } }
        : station));
    await app.open();
    await app.search('Lake Norman', 'Lake Norman, North Carolina');

    await expect(app.station('Fox River')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.station-name')).not.toContainText(['Clear Lake at Test Dam, IL']);
    await expect(page.locator('#levelStats')).toContainText('Lake level');
    await expect(page.locator('#levelStats')).toContainText('759.32 ft');
    await expect(page.locator('#levelSource')).toContainText('USGS gauge: Clear Lake at Test Dam, IL');
    // River flow says nothing about a lake, so it is not scored there.
    await expect(page.locator('.factor-label')).toHaveText(['Water temperature', 'Light', 'Wind', 'Moon', 'Barometric pressure']);
});

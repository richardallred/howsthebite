import { expect, test } from './support/fixtures.js';

test.describe('when the weather service fails', () => {
    test('a first visit shows an error with a retry, and never invents numbers', async ({ page, api }) => {
        api.fail('nws', 500);
        await page.goto('/');

        await expect(page.locator('#noticeText')).toHaveText("Couldn't load the weather.");
        await expect(page.locator('#scoreValue')).toHaveText('–');
        await expect(page.locator('#scorePhrase')).toHaveText('Conditions unavailable');
        await expect(page.locator('.factor:not(.is-placeholder)')).toHaveCount(0);

        api.restore('nws');
        await page.getByRole('button', { name: 'Try again' }).click();
        await expect(page.locator('#scoreValue')).toHaveText('100');
        await expect(page.locator('#notice')).toBeHidden();
    });

    test('a failed refresh keeps the last good conditions on screen and says how old they are', async ({ page, api, app }) => {
        await app.open();
        await app.search('Asheville', 'Asheville, North Carolina');

        api.fail('nws', 'network');
        await page.getByRole('button', { name: 'Refresh conditions' }).click();

        await expect(page.locator('#noticeText')).toHaveText("Couldn't load the weather. Showing conditions from just now.");
        await expect(page.locator('#scoreValue')).toHaveText('100');
        await expect(page.locator('.factor')).toHaveCount(6);
    });
});

test.describe('weather coverage', () => {
    test('a spot outside the United States is explained rather than shown as a generic failure', async ({ page, api }) => {
        api.weather = { outsideCoverage: true };
        await page.goto('/');
        await expect(page.locator('#noticeText')).toContainText('US National Weather Service, which has no data for this spot');
        await expect(page.locator('#scoreValue')).toHaveText('–');
    });

    test('a rural station without a barometer borrows pressure from the nearest airport', async ({ page, api, app }) => {
        api.weather = {
            stations: [
                { id: 'RKYM8', name: 'ROCKY RIDGE', pressure: false, sky: false },
                { id: 'TS123', name: 'Highway 12 MP 40', pressure: false, sky: false },
                { id: 'KFAR', name: 'Farfield, Farfield Municipal Airport', pressure: true, sky: true },
            ],
        };
        await app.open();

        await expect(page.locator('#updatedAt')).toContainText('weather observed at Rocky Ridge just now, pressure at Farfield, Farfield Municipal Airport');
        await expect(app.factor('Barometric pressure').locator('.factor-value')).toHaveText('30.03 inHg');
        await expect(app.factor('Sky').locator('.factor-value')).toHaveText('Clear'); // from the airport's sky sensor
        await expect(page.locator('#scoreValue')).toHaveText('100');
        // Only the stations that were needed were read: the nearest one, then the airport.
        expect(api.count('nws', '/stations/RKYM8/observations')).toBe(1);
        expect(api.count('nws', '/stations/TS123/observations')).toBe(0);
        expect(api.count('nws', '/stations/KFAR/observations')).toBe(1);
    });

    test('with no barometer in reach, pressure scores as neutral and sky comes from the forecast', async ({ page, api, app }) => {
        api.weather = { stations: [{ id: 'RKYM8', name: 'ROCKY RIDGE', pressure: false, sky: false }] };
        await app.open();

        const pressure = app.factor('Barometric pressure');
        await expect(pressure.locator('.factor-value')).toHaveText('—');
        await expect(pressure).toContainText('No barometer reporting nearby');
        await expect(pressure.locator('.factor-points')).toHaveText(/^9\/18/);
        await expect(page.locator('#pressureChart .chart-empty')).toHaveText('No barometer is reporting near here.');
        await expect(app.factor('Sky').locator('.factor-value')).toHaveText('Sunny'); // today's forecast period
        await expect(page.locator('#scoreValue')).toHaveText('91');
    });

    test('a brief NWS error is retried once and the visitor never sees it', async ({ page, context, api, app }) => {
        let failuresLeft = 1;
        await context.route('**/api.weather.gov/gridpoints/**/forecast**', (route) => {
            if (failuresLeft-- > 0) return route.fulfill({ status: 503, body: '{}', headers: { 'access-control-allow-origin': '*' } });
            return route.fallback();
        });
        await app.open();
        await expect(page.locator('#scoreValue')).toHaveText('100');
        await expect(page.locator('#notice')).toContainText('Showing Chicago'); // only the first-visit hint, no error
        expect(api.count('nws', '/forecast')).toBe(1); // the retry reached the normal mock
    });
});

test.describe('when USGS fails', () => {
    test('rate limiting is named, and the water temperature becomes a labelled estimate', async ({ page, api, app }) => {
        api.fail('usgs', 429);
        await app.open();

        await expect(page.locator('#waterSummary')).toContainText('USGS is rate-limiting requests right now.');
        await expect(page.locator('#waterSummary')).toContainText('estimated from the last three days of air temperature');
        await expect(app.factor('Water temperature').locator('.factor-value')).toHaveText('≈ 72.0°F');
        await expect(page.locator('#levelSource')).toHaveText('Water level and flow are unavailable right now.');
        await expect(page.locator('#stationList')).toContainText('No stations to show.');

        // Everything that does not depend on USGS still works.
        await expect(page.locator('#scoreValue')).toHaveText(/^\d+$/);
        await expect(page.locator('.forecast-day')).toHaveCount(5);
        await expect(page.locator('#pressureChart .chart-line')).toBeVisible();
    });

    test('an outage is reported as unavailable and recovers on refresh', async ({ page, api, app }) => {
        api.fail('usgs', 503);
        await app.open();
        await expect(page.locator('#waterSummary')).toContainText('USGS water data is unavailable right now.');

        api.restore('usgs');
        await page.getByRole('button', { name: 'Refresh conditions' }).click();
        await expect(app.station('Fox River')).toHaveAttribute('aria-pressed', 'true');
        await expect(app.factor('Water temperature').locator('.factor-value')).toHaveText('68.0°F');
    });

    test('a station whose history fails to load still supplies the current reading', async ({ page, context, app }) => {
        await context.route('**/collections/continuous/items**', (route) => route.fulfill({ status: 500, body: '{}' }));
        await app.open();

        await expect(app.factor('Water temperature').locator('.factor-value')).toHaveText('68.0°F');
        await expect(page.locator('#waterChart .chart-empty')).toBeVisible();
        await expect(page.locator('#levelStats')).toContainText('3.42 ft');
        await expect(page.locator('#levelStats')).toContainText('Not enough history');
    });
});

test.describe('place name lookup', () => {
    test.use({ geolocation: { latitude: 43.07312, longitude: -89.40123 }, permissions: ['geolocation'] });

    test('falls back to "My location" when NWS has no place name for the spot', async ({ page, api }) => {
        api.weather = { place: null };
        await page.goto('/');
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('My location');
        await expect(page.locator('#scoreValue')).toHaveText('100');
    });
});

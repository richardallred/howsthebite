import { DEFAULT_POINTS, DEFAULT_SCORE, NOW, expect, test } from './support/fixtures.js';

test.describe('first visit', () => {
    test('shows the default city with a score, six factors and a five-day forecast', async ({ page, app }) => {
        await app.open();

        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Chicago, Illinois');
        await expect(page).toHaveTitle(/Chicago, Illinois/);

        // Ideal water, wind and flow, but mid-morning under a bright sun: excellent, not exceptional.
        await expect(page.locator('#scoreValue')).toHaveText(DEFAULT_SCORE);
        await expect(page.locator('#scoreBand')).toHaveText('Excellent');
        await expect(page.locator('#scorePhrase')).toHaveText(/^The bite is \w+/);
        await expect(page.locator('#scoreCard')).toHaveAttribute('data-band', 'excellent');
        await expect(page.locator('#scoreNow')).toHaveText('Clear · 72°F');
        await expect(page.locator('#scoreCap')).toBeHidden(); // nothing is holding the score down
        // Sunset in Chicago on 15 June is 8:28 PM; dawn the next day is the runner-up.
        await expect(page.locator('#scoreBest')).toHaveText(/^Best times: 7:\d\d–9:\d\d PM · Tue 4:\d\d–\d:\d\d AM$/);
        await expect(page.locator('#alerts')).toBeHidden();
        await expect(page.locator('#updatedAt')).toContainText('weather observed at Testville, Test Regional Airport just now');

        await expect(page.locator('.factor')).toHaveCount(6);
        await expect(page.locator('.factor-label')).toHaveText([
            'Water temperature', 'Light', 'Wind', 'River flow', 'Moon', 'Barometric pressure',
        ]);
        await expect(page.locator('.factor-points')).toHaveText(DEFAULT_POINTS);

        await expect(page.locator('.forecast-day')).toHaveCount(5);
        await expect(page.locator('.forecast-name').first()).toContainText('Today');
        await expect(page.locator('.forecast-name').first()).toContainText('Jun 15');
        await expect(page.locator('.forecast-temps').first()).toHaveText('81° / 61°');
        await expect(page.locator('.forecast-label')).toHaveText([
            'Sunny', 'Partly sunny', 'Mostly cloudy then slight chance light rain', 'Cloudy', 'Sunny',
        ]);
        await expect(page.locator('.forecast-meta').first()).toHaveText('30% precipWind to 11 mph');
    });

    test('explains that Chicago is a default and never prompts for location by itself', async ({ page, app }) => {
        await app.open();
        const notice = page.locator('#notice');
        await expect(notice).toBeVisible();
        await expect(notice).toContainText('Showing Chicago, Illinois');
        await expect(notice.getByRole('button', { name: 'Use my location' })).toBeVisible();
        await expect(page.locator('#recentLocations')).toBeHidden();
    });
});

test.describe('factor details', () => {
    test('each tile shows the live value, a plain-language note and the trend', async ({ page, app }) => {
        await app.open();

        const water = app.factor('Water temperature');
        await expect(water.locator('.factor-value')).toHaveText('68.0°F');
        await expect(water).toContainText('Prime range');
        await expect(water).toContainText('Steady over 24 hr');

        const pressure = app.factor('Barometric pressure');
        await expect(pressure.locator('.factor-value')).toHaveText('30.03 inHg');
        await expect(pressure).toContainText('Falling · −0.04 inHg in 3 hr');

        await expect(app.factor('Wind').locator('.factor-value')).toHaveText('10 mph SW');
        await expect(app.factor('Wind')).toContainText('Gusts to 14 mph');
        await expect(app.factor('Moon').locator('.factor-value')).toContainText('New Moon');

        const light = app.factor('Light');
        await expect(light.locator('.factor-value')).toHaveText('Clear');
        await expect(light).toContainText('Bright sun');
        await expect(light).toContainText('Sunset 8:28 PM');

        const flow = app.factor('River flow');
        await expect(flow.locator('.factor-value')).toHaveText('1,250 cfs');
        await expect(flow).toContainText('Normal for the date');
        await expect(flow).toContainText('100% of the median for today');
    });

    test('the same conditions score higher in the evening and lower in the dead of night', async ({ page, api, app }) => {
        const at = async (hoursLater) => {
            api.weather = { now: NOW + hoursLater * 3600_000 };
            await page.clock.setFixedTime(NOW + hoursLater * 3600_000);
        };
        await at(10); // 8 PM in Chicago, half an hour before sunset
        await app.open();
        const evening = Number(await page.locator('#scoreValue').textContent());
        await expect(app.factor('Light').locator('.factor-value')).toHaveText('Evening light');
        await expect(app.factor('Light').locator('.factor-points')).toHaveText(/^30\/30/);
        await expect(app.factor('Light')).toContainText('Sunset 8:28 PM');
        await expect(page.locator('#scoreBest')).toHaveText(/^Best times: now–9:\d\d PM/);

        await at(15); // 1 AM
        await page.getByRole('button', { name: 'Refresh conditions' }).click();
        await expect(app.factor('Light').locator('.factor-value')).toHaveText('After dark');
        await expect(app.factor('Light')).toContainText('Sunrise 5:16 AM');
        const night = Number(await page.locator('#scoreValue').textContent());

        expect(evening).toBeGreaterThan(Number(DEFAULT_SCORE));
        expect(night).toBeLessThan(evening);
    });

    test('the species selector retunes the water temperature and is remembered', async ({ page, api, app }) => {
        api.stations = api.stations.map((station) => (station.id === 'USGS-05500001'
            ? { ...station, readings: { ...station.readings, '00010': 22.5 } } // 72.5°F: fine for bass, too warm for trout
            : station));
        await app.open();
        const water = app.factor('Water temperature');
        await expect(water).toContainText('Prime range for most species');

        await page.getByRole('button', { name: 'Trout' }).click();
        await expect(water).toContainText('Warm for trout');
        await expect(page.locator('#scoreCap')).toHaveText('Held down by the water temperature');
        expect(Number(await page.locator('#scoreValue').textContent())).toBeLessThan(40);

        await page.getByRole('button', { name: 'Bass & panfish' }).click();
        await expect(water).toContainText('Prime range for bass');
        await expect(page.locator('#scoreCap')).toBeHidden();

        await page.reload();
        await app.loaded();
        await expect(page.getByRole('button', { name: 'Bass & panfish' })).toHaveAttribute('aria-pressed', 'true');
    });

    test('a river running far above normal holds the score down', async ({ page, api, app }) => {
        api.stations = api.stations.map((station) => (station.id === 'USGS-05500001' ? { ...station, medianCfs: 250 } : station));
        await app.open();
        const flow = app.factor('River flow');
        await expect(flow).toContainText('Very high for the date');
        await expect(flow).toContainText('500% of the median for today');
        await expect(page.locator('#scoreCap')).toHaveText('Held down by the river flow');
        await expect(page.locator('#levelStats')).toContainText('median for today 250 cfs');
        expect(Number(await page.locator('#scoreValue').textContent())).toBeLessThan(40);
        await expect(page.locator('#scoreBand')).toHaveText('Poor');
    });

    test('flow is left out, not guessed, when the gauge has no long-term record', async ({ page, api, app }) => {
        api.stations = api.stations.map((station) => ({ ...station, normals: false }));
        await app.open();
        await expect(page.locator('.factor-label')).toHaveText(['Water temperature', 'Light', 'Wind', 'Moon', 'Barometric pressure']);
        await expect(page.locator('#levelStats')).toContainText('1,250 cfs'); // still shown, just not scored
    });

    test('low dissolved oxygen is shown and drags the water score down', async ({ page, api, app }) => {
        api.stations = api.stations.map((station) => (station.id === 'USGS-05500001'
            ? { ...station, readings: { ...station.readings, '00300': 3.2, 63680: 64 } }
            : station));
        await app.open();
        await expect(app.factor('Water temperature')).toContainText('Low oxygen (3.2 mg/L)');
        await expect(page.locator('#levelStats')).toContainText('Dissolved oxygen3.2 mg/Llow');
        await expect(page.locator('#levelStats')).toContainText('Turbidity64 FNUmuddy');
    });
});

test.describe('weather alerts', () => {
    test('a thunderstorm warning in effect caps the score and says why', async ({ page, api, app }) => {
        api.alerts = [{ event: 'Severe Thunderstorm Warning', onsetHours: -0.5, endsHours: 1 }, { event: 'Freeze Warning' }];
        await app.open();

        await expect(page.locator('#alerts .alert')).toHaveText(['Severe Thunderstorm Warning until Mon 11:00 AM — stay off the water']);
        await expect(page.locator('#alerts .alert')).toHaveAttribute('data-level', 'danger');
        await expect(page.locator('#scoreValue')).toHaveText('15');
        await expect(page.locator('#scoreCap')).toHaveText('Severe Thunderstorm Warning in effect');
        // The factors still show what the conditions would otherwise be worth.
        await expect(page.locator('.factor-points')).toHaveText(DEFAULT_POINTS);
    });

    test('an advisory is shown without changing the score, and an upcoming one says when it starts', async ({ page, api, app }) => {
        api.alerts = [
            { event: 'Lake Wind Advisory', onsetHours: 3, endsHours: 9 },
            { event: 'Flood Advisory', onsetHours: -2, endsHours: 6 },
        ];
        await app.open();
        await expect(page.locator('#alerts .alert')).toHaveText([
            'Flood Advisory until Mon 4:00 PM', 'Lake Wind Advisory from Mon 1:00 PM',
        ]);
        await expect(page.locator('#scoreValue')).toHaveText(DEFAULT_SCORE);
    });

    test('an alerts outage never blocks the conditions', async ({ page, context, app }) => {
        await context.route('**/api.weather.gov/alerts/**', (route) => route.fulfill({ status: 503, body: '{}', headers: { 'access-control-allow-origin': '*' } }));
        await app.open();
        await expect(page.locator('#scoreValue')).toHaveText(DEFAULT_SCORE);
        await expect(page.locator('#alerts')).toBeHidden();
    });

    test('a stormy, windy, cold front day scores at the bottom of the scale', async ({ page, api, app }) => {
        api.weather = {
            tempF: 28, pressureInHg: 29.2, pressureChangePer3h: 0.12,
            windMph: 32, gustMph: 48, skyText: 'Thunderstorm', skyIcon: 'tsra',
        };
        api.stations = [];
        await app.open();

        const score = Number(await page.locator('#scoreValue').textContent());
        expect(score).toBeLessThan(25);
        await expect(page.locator('#scoreBand')).toHaveText(/Very poor|Terrible/);
        await expect(app.factor('Light')).toContainText('stay off the water');
        await expect(app.factor('Wind')).toContainText('Too windy');
        await expect(app.factor('Barometric pressure')).toContainText('Rising fast');
    });
});

test.describe('history charts', () => {
    test('draws all four series with an accessible summary and a data table', async ({ page, app }) => {
        await app.open();

        for (const id of ['pressureChart', 'airChart', 'waterChart', 'levelChart']) {
            await expect(page.locator(`#${id} .chart-line`)).toHaveCount(1); // a flat line has no height, so not toBeVisible()
        }
        await expect(page.locator('#pressureChart .chart-plot')).toHaveAttribute(
            'aria-label', /Barometric pressure over the last 48 hours\. Now 30\.03 inHg, low 30\.03 inHg, high 30\.67 inHg/,
        );
        await expect(page.locator('#pressureChart .chart-end-label')).toHaveText('30.03');

        await page.locator('#airChart summary').click();
        await expect(page.locator('#airChart tbody tr').first()).toContainText('72.0°F');
        expect(await page.locator('#airChart tbody tr').count()).toBeGreaterThan(10);
    });

    test('shows a tooltip on hover and from the keyboard', async ({ page, app }) => {
        await app.open();
        const plot = page.locator('#pressureChart .chart-plot');
        const tooltip = page.locator('#pressureChart .chart-tooltip');
        await expect(tooltip).toBeHidden();

        await plot.hover();
        await expect(tooltip).toBeVisible();
        await expect(tooltip).toContainText('inHg');

        await page.mouse.move(0, 0);
        await expect(tooltip).toBeHidden();

        await plot.focus();
        await page.keyboard.press('End');
        await expect(tooltip).toContainText('30.03 inHg');
        await page.keyboard.press('ArrowLeft');
        await expect(tooltip).not.toContainText('30.03 inHg');
        await page.keyboard.press('Escape');
        await expect(tooltip).toBeHidden();
    });
});

test.describe('theme', () => {
    test('toggle switches theme and the choice survives a reload', async ({ page, app }) => {
        await page.emulateMedia({ colorScheme: 'light' });
        await app.open();
        const html = page.locator('html');
        await expect(html).toHaveAttribute('data-theme', 'light');

        await page.getByRole('button', { name: 'Switch to dark theme' }).click();
        await expect(html).toHaveAttribute('data-theme', 'dark');
        await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible();

        await page.reload();
        await expect(html).toHaveAttribute('data-theme', 'dark');
    });

    test('follows the system setting until a choice is made', async ({ page, app }) => {
        await page.emulateMedia({ colorScheme: 'dark' });
        await app.open();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    });
});

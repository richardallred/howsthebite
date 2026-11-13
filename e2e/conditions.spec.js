import { expect, test } from './support/fixtures.js';

test.describe('first visit', () => {
    test('shows the default city with a score, six factors and a five-day forecast', async ({ page, app }) => {
        await app.open();

        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Chicago, Illinois');
        await expect(page).toHaveTitle(/Chicago, Illinois/);

        // The fixture is a perfect day on a new moon: every factor is maxed.
        await expect(page.locator('#scoreValue')).toHaveText('100');
        await expect(page.locator('#scoreBand')).toHaveText('Exceptional');
        await expect(page.locator('#scorePhrase')).toHaveText(/^The bite is \w+/);
        await expect(page.locator('#scoreCard')).toHaveAttribute('data-band', 'exceptional');
        await expect(page.locator('#scoreNow')).toHaveText('☀️ Clear · 72°F');
        await expect(page.locator('#updatedAt')).toContainText('weather observed at Testville, Test Regional Airport just now');

        await expect(page.locator('.factor')).toHaveCount(6);
        await expect(page.locator('.factor-points')).toHaveText([
            /^20\/20/, /^18\/18/, /^17\/17/, /^15\/15/, /^15\/15/, /^15\/15/,
        ]);

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
        await expect(app.factor('Air temperature').locator('.factor-value')).toHaveText('72.0°F');
        await expect(app.factor('Sky').locator('.factor-value')).toHaveText('Clear');
        await expect(app.factor('Sky')).toContainText('50% humidity');
        await expect(app.factor('Moon').locator('.factor-value')).toContainText('New Moon');
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
        await expect(app.factor('Sky')).toContainText('stay off the water');
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

import { DEFAULT_SCORE, expect, test } from './support/fixtures.js';

const days = (page) => page.locator('#outlookDays .outlook-day');

test.describe('score outlook', () => {
    test('charts the score from now to the end of the day after tomorrow, with each day\'s best time', async ({ page, app }) => {
        await app.open();
        // The clock is Monday 15 June, 10:00 in Chicago.
        await expect(page.locator('#outlookRange')).toHaveText('now to Wed night');
        await expect(page.locator('#outlookChart .chart-line')).toHaveCount(1);
        await expect(page.locator('#outlookChart .outlook-day-label')).toHaveText(['Today', 'Tue', 'Wed']);
        await expect(page.locator('#outlookChart .outlook-night')).toHaveCount(3); // tonight, Tuesday night, Wednesday night
        await expect(page.locator('#outlookChart .chart-dot:not([visibility="hidden"])')).toHaveCount(3); // one best moment per day

        await expect(days(page).locator('.outlook-day-name')).toHaveText(['Today', 'Tue', 'Wed']);
        // Sunset is 8:28 PM: the evening is the best of each day here, and well above the mid-morning score.
        await expect(days(page).nth(0)).toHaveText(/^TodayBest 9\d Exceptional7:\d0 PM–9:\d0 PM$/);
        await expect(days(page).nth(1)).toContainText(/Best \d\d /);
        const best = Number((await days(page).nth(0).locator('.outlook-day-best').textContent()).match(/\d+/)[0]);
        expect(best).toBeGreaterThan(Number(DEFAULT_SCORE) + 10);

        await expect(page.locator('#outlookNote')).toContainText('Water temperature and river flow are assumed to stay as they are now');
        await expect(page.locator('#outlookChart .chart-plot')).toHaveAttribute(
            'aria-label', new RegExp(`^Fishing score from now to the end of Wed\\. Now ${DEFAULT_SCORE}, Excellent\\. Best of each day: Today 9\\d at [78]:\\d\\d PM; Tue `),
        );
    });

    test('the first point is the score shown at the top of the page', async ({ page, app }) => {
        await app.open();
        const plot = page.locator('#outlookChart .chart-plot');
        const tooltip = page.locator('#outlookChart .chart-tooltip');
        await plot.focus();
        await page.keyboard.press('Home');
        await expect(tooltip).toContainText(`${DEFAULT_SCORE} · Excellent`);
        await expect(tooltip).toContainText('Now, 10:00 AM');

        await page.keyboard.press('ArrowRight'); // one hour on
        await expect(tooltip).toContainText('Mon 11:00 AM');
        await page.keyboard.press('End');
        await expect(tooltip).toContainText('Thu 12:00 AM');
        await page.keyboard.press('Escape');
        await expect(tooltip).toBeHidden();
    });

    test('shows a read-out on hover and has a data table', async ({ page, app }) => {
        await app.open();
        const plot = page.locator('#outlookChart .chart-plot');
        const tooltip = page.locator('#outlookChart .chart-tooltip');
        await plot.scrollIntoViewIfNeeded();
        await plot.hover();
        await expect(tooltip).toBeVisible();
        await expect(tooltip).toContainText(/^\d+ · (Exceptional|Excellent|Good|Fair|Poor|Very poor|Terrible)/);

        await page.locator('#outlookChart summary').click();
        const rows = page.locator('#outlookChart tbody tr');
        await expect(rows.first()).toHaveText(`Mon 10:00 AMExcellent${DEFAULT_SCORE}`);
        expect(await rows.count()).toBeGreaterThan(25); // every two hours over two and a half days
    });

    test('says so when nothing changes all day, instead of naming a best time', async ({ page, api, app }) => {
        // Near-freezing water holds the score down at every hour.
        api.stations = api.stations.map((station) => (station.id === 'USGS-05500001'
            ? { ...station, readings: { ...station.readings, '00010': 0.5 } }
            : station));
        await app.open();
        await expect(days(page).nth(1)).toContainText(/^TueAbout \d+ /);
        await expect(days(page).nth(1)).toContainText('Held down by the water temperature');
    });

    test('in salt water the outlook follows the tide', async ({ page, app }) => {
        await app.open();
        await app.search('Galveston', 'Galveston, Texas');
        await page.getByRole('button', { name: 'Inshore', exact: true }).click();

        await expect(page.locator('#outlookNote')).toContainText('light and tide are calculated');
        // The fixture's tide turns every six hours, so the score dips at each slack: more ups and downs than light alone gives.
        const points = (await page.locator('#outlookChart .chart-line').getAttribute('d')).split('L').map((pair) => Number(pair.split(',')[1]));
        let turns = 0;
        for (let i = 2; i < points.length; i++) {
            if ((points[i] - points[i - 1]) * (points[i - 1] - points[i - 2]) < 0) turns++;
        }
        expect(turns).toBeGreaterThan(12);
    });

    test('with no conditions there is no chart, only an explanation', async ({ page, api }) => {
        api.fail('nws', 500);
        await page.goto('/');
        await expect(page.locator('#noticeText')).toHaveText("Couldn't load the weather.");
        await expect(page.locator('#outlookChart .chart-empty')).toHaveText('The outlook needs the current conditions.');
        await expect(days(page)).toHaveCount(0);
    });

    test('still works from the 12-hour forecast when the hourly one fails', async ({ page, context, app }) => {
        await context.route((url) => url.pathname.endsWith('/forecast/hourly'), (route) => route.fulfill({
            status: 503, body: '{}', headers: { 'access-control-allow-origin': '*' },
        }));
        await app.open();
        await expect(page.locator('#scoreValue')).toHaveText(DEFAULT_SCORE);
        await expect(days(page)).toHaveCount(3);
        await expect(days(page).nth(0)).toHaveText(/^TodayBest 9\d Exceptional7:\d0 PM–9:\d0 PM$/);
    });
});

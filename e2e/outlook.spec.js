import { DEFAULT_SCORE, expect, test } from './support/fixtures.js';

const days = (page) => page.locator('#scoreDays .score-day');

test.describe('score outlook', () => {
    test('charts the score from now to the end of the day after tomorrow, with each day\'s best time', async ({ page, app }) => {
        await app.open();
        // The clock is Monday 15 June, 10:00 in Chicago.
        await expect(page.locator('#outlookRange')).toHaveText('now to Wed night');
        await expect(page.locator('#outlookChart .chart-line')).toHaveCount(1);
        await expect(page.locator('#outlookChart .outlook-day-label')).toHaveText(['Today', 'Tue', 'Wed']);
        await expect(page.locator('#outlookChart .outlook-night')).toHaveCount(3); // tonight, Tuesday night, Wednesday night
        await expect(page.locator('#outlookChart .chart-dot:not([visibility="hidden"])')).toHaveCount(3); // one best moment per day

        // The days are tabs on the score card, each with its day score (its best two hours).
        await expect(days(page).locator('.score-day-name')).toHaveText(['Today', 'Tue', 'Wed']);
        await expect(days(page).nth(0)).toHaveText(/^Today, day score \d\d$/);
        await expect(days(page).nth(1)).toHaveText(/^Tue, day score \d\d$/);

        await expect(page.locator('#outlookNote')).toContainText('Water temperature and river flow are assumed to stay as they are now');
        await expect(page.locator('#outlookChart .chart-plot')).toHaveAttribute(
            'aria-label', new RegExp(`^Fishing score from now to the end of Wed\\. Now ${DEFAULT_SCORE}, Excellent\\. Best of each day: Today 9\\d at [78]:\\d\\d PM; Tue `),
        );
    });

    test('a day tab turns the whole score card to that day\'s best two hours, and Today turns it back', async ({ page, app }) => {
        await app.open();
        const today = await page.locator('#scoreValue').textContent();
        const tuesday = days(page).nth(1);
        const best = (await tuesday.locator('.score-day-score').textContent()).match(/\d+/)[0];
        // Sunset is 8:28 PM: Tuesday evening beats the mid-morning score now.
        expect(Number(best)).toBeGreaterThan(Number(DEFAULT_SCORE) + 10);

        await tuesday.click();
        await expect(tuesday).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('#scoreValue')).toHaveText(best);
        await expect(page.locator('#scoreBest')).toHaveText(/^Best two hours on Tue[78]–(9|10) PM$/);
        await expect(page.locator('#scoreNow')).toHaveText(/^Forecast/);
        await expect(page.locator('#headerScore')).toHaveText(today); // the header keeps today's score
        await expect(app.factor('Light')).toContainText('Forecast for Tue');
        await expect(app.factor('Water temperature')).toContainText('Assumed to hold until then');
        await expect(app.factor('Barometric pressure')).toContainText('Trend not known that far ahead');
        await expect(page.locator('.dial[data-factor="light"]')).toHaveAttribute('aria-label', /^Light: Evening light/);

        await page.keyboard.press('ArrowLeft'); // arrow keys move along the tabs
        await expect(days(page).nth(0)).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('#scoreValue')).toHaveText(today);
        await expect(page.locator('#scoreBest')).toHaveText(/^Best two hours/);
    });

    test('dragging along the strip shows the score hour by hour; a part of the day shows its own', async ({ page, app }) => {
        await app.open();
        const today = await page.locator('#scoreValue').textContent();
        const track = page.locator('#stripTrack');
        // The hours before 10 AM are gone: they are drawn flat, and the strip starts at the hour under way.
        await expect(track.locator('.strip-bar[data-past]')).toHaveCount(10);
        await expect(track).toHaveAttribute('aria-valuetext', /, score \d+, /);

        await track.scrollIntoViewIfNeeded();
        const box = await track.boundingBox();
        const at = (hour) => box.x + ((hour + 0.5) / 24) * box.width;
        const y = box.y + box.height - 8;
        await page.mouse.move(at(10), y);
        await page.mouse.down();
        await expect(page.locator('#scoreValue')).toHaveText(DEFAULT_SCORE); // the hour under way is the score now
        await expect(page.locator('#scoreBest')).toHaveText('Right nowuntil 11 AMWhole day');
        await page.mouse.move(at(20), y, { steps: 5 }); // 8 PM, just before sunset
        await page.mouse.up();
        await expect(track).toHaveAttribute('aria-valuetext', /^8 PM, score \d+, /);
        await expect(page.locator('#scoreBest')).toHaveText('Forecast for8 PMWhole day');
        await expect(page.locator('.strip-thumb-label')).toHaveText('8p');
        await expect(app.factor('Light')).toContainText('Forecast for Mon 8:30 PM');
        await expect(page.locator('#headerScore')).toHaveText(today);

        await page.keyboard.press('ArrowLeft'); // the strip is a slider: arrow keys step an hour
        await expect(track).toHaveAttribute('aria-valuetext', /^7 PM, /);
        await page.keyboard.press('Escape');
        await expect(page.locator('#scoreValue')).toHaveText(today);

        // Morning and afternoon are still to come; dawn has passed.
        await expect(page.locator('.strip-part', { hasText: 'Dawn' })).toBeDisabled();
        const morning = page.locator('.strip-part', { hasText: 'Morning' });
        await morning.click();
        await expect(morning).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#scoreValue')).toHaveText(await morning.locator('.strip-part-score').textContent());
        await expect(page.locator('#scoreBest')).toHaveText('Morning10 AM–1 PMWhole day');
        await page.getByRole('button', { name: 'Whole day' }).click();
        await expect(page.locator('#scoreValue')).toHaveText(today);
    });

    test('the first point is the score shown at the top of the page', async ({ page, app }) => {
        await app.open();
        const plot = page.locator('#outlookChart .chart-plot');
        const tooltip = page.locator('#outlookChart .chart-tooltip');
        await plot.focus();
        await page.keyboard.press('Home');
        await expect(tooltip).toContainText(`${DEFAULT_SCORE} · Excellent`);
        await expect(tooltip).toContainText('Now, 10:00 AM');
        await expect(tooltip).not.toContainText('null'); // no cap, so no third line

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

    test('marks the moon\'s major periods under the chart, in the read-out and in the table', async ({ page, app }) => {
        await app.open();
        // Overhead Monday, Tuesday and Wednesday afternoon, underfoot in the small hours between.
        await expect(page.locator('#outlookChart .outlook-moon')).toHaveCount(5);
        await expect(page.locator('#outlookNote')).toContainText('Bars under the chart are the two hours around the moon crossing overhead or underfoot.');

        const plot = page.locator('#outlookChart .chart-plot');
        const tooltip = page.locator('#outlookChart .chart-tooltip');
        await plot.focus();
        await page.keyboard.press('Home');
        await expect(tooltip).not.toContainText('Moon'); // 10:00 AM, well before the 1:32 PM crossing
        for (let hour = 0; hour < 3; hour++) await page.keyboard.press('ArrowRight');
        await expect(tooltip).toContainText('Mon 1:00 PM');
        await expect(tooltip).toContainText('Moon overhead');

        await page.locator('#outlookChart summary').click();
        await expect(page.locator('#outlookChart thead th')).toHaveText(['Time', 'Rating', 'Score', 'Moon']);
        await expect(page.locator('#outlookChart tbody tr', { hasText: 'Mon 12:00 PM' })).toContainText(/Overhead 1:3[123] PM$/);
        await expect(page.locator('#outlookChart tbody td:last-child', { hasText: /Overhead|Underfoot/ })).toHaveCount(5);
    });

    test('says so when nothing changes all day, instead of naming a best time', async ({ page, api, app }) => {
        // Near-freezing water holds the score down at every hour.
        api.stations = api.stations.map((station) => (station.id === 'USGS-05500001'
            ? { ...station, readings: { ...station.readings, '00010': 0.5 } }
            : station));
        await app.open();
        await days(page).nth(1).click();
        await expect(page.locator('#scoreBest')).toHaveText('Best two hours on Tuemuch the same all day');
        await expect(page.locator('#scoreCap')).toHaveText('Held down by the water temperature');
    });

    test('in salt water the outlook follows the tide', async ({ page, app }) => {
        await app.open();
        await app.search('Galveston', 'Galveston, Texas');
        await page.getByRole('button', { name: 'Inshore', exact: true }).click();

        await expect(page.locator('#outlookNote')).toContainText('light and tide are calculated');
        // No moon factor in salt water, so no major periods are marked.
        await expect(page.locator('#outlookChart .outlook-moon')).toHaveCount(0);
        await expect(page.locator('#outlookChart thead th')).toHaveText(['Time', 'Rating', 'Score']);
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
        await expect(page.locator('#scoreDays .score-day[disabled]')).toHaveCount(2); // no days ahead to choose
    });

    test('still works from the 12-hour forecast when the hourly one fails', async ({ page, context, app }) => {
        await context.route((url) => url.pathname.endsWith('/forecast/hourly'), (route) => route.fulfill({
            status: 503, body: '{}', headers: { 'access-control-allow-origin': '*' },
        }));
        await app.open();
        await expect(page.locator('#nowScore')).toHaveText(DEFAULT_SCORE);
        await expect(days(page)).toHaveCount(3);
        await expect(days(page).nth(1)).toHaveText(/^Tue, day score \d\d$/);
    });
});

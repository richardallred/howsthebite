import { expect, test } from './support/fixtures.js';

// Inshore, the page charts the water around the place from NOAA's depth lines. The mock
// chart has three lines across the box: the low-water line (0), 6 ft and 12 ft
// (chartResponse in support/api-mocks.js); api.chart = false is water NOAA has no lines for.

/** Open the app at Galveston, Texas, where there is a tide and a beach. */
async function openGalveston(app, mode = null) {
    await app.open();
    await app.search('Galveston', 'Galveston, Texas');
    if (mode) await app.page.getByRole('button', { name: mode, exact: true }).click();
    await app.now();
}

/**
 * How many times NOAA was asked for the chart of the water around the place. Fresh water at
 * the same place asks NOAA about the lake too, a much smaller box, which is not counted.
 */
function chartCalls(api, layer = 'enc_harbour') {
    return api.calls.filter(({ service, url }) => {
        if (service !== 'depth-noaa' || !url.includes(layer)) return false;
        const [, south, , north] = new URL(url).searchParams.get('geometry').split(',').map(Number);
        return north - south > 0.06;
    }).length;
}

test.describe('depth chart', () => {
    test('inshore, charts the water around the place and reads it with the tide', async ({ page, api, app }) => {
        await openGalveston(app, 'Inshore');
        const section = page.locator('#chart');
        await expect(section).toBeVisible();
        await expect(page.locator('#chartStatus')).toHaveText('Depth lines from NOAA charts: 0 to 12 ft, measured at the average lowest tide.');

        // How to read it, and what the tide adds right now: midway down a falling tide.
        const notes = page.locator('#chartNotes .chart-item');
        await expect(notes).toHaveCount(2);
        await expect(notes.nth(0)).toContainText('The 0 line is the edge of the flats');
        await expect(notes.nth(1)).toContainText(/The tide is \d\.\d ft above the chart's level and falling, by NOAA's prediction for .+\. So there is about \d+ ft of water over a 6 ft line\./);

        await section.scrollIntoViewIfNeeded(); // loads the map library
        await expect(page.locator('#chartMap .depth-line')).toHaveCount(3);
        await expect(page.locator('#chartMap .depth-label')).toHaveText(['0', '6', '12']);
        await expect(page.locator('#chartMap .depth-legend')).toHaveText(/Depth, ft\s*≤5\s*≤10\s*≤20/);
        const credit = page.locator('#chartMap .leaflet-control-attribution');
        await expect(credit).toContainText('not for navigation');
        await expect(credit.getByRole('link', { name: 'NOAA charts' })).toHaveAttribute('href', /^https:\/\/nauticalcharts\.noaa\.gov\//);
        await expect(page.locator('#chartMap .map-pin')).toHaveCount(1);

        // The freshwater card is not for a bay.
        await expect(page.locator('#where')).toBeHidden();
        // No proxy on a static host: the browser asked NOAA itself, and its harbour charts were enough.
        expect(chartCalls(api)).toBe(1);
        expect(chartCalls(api, 'enc_approach')).toBe(0);
    });

    test('is for inshore only: not fresh water, and not the surf', async ({ page, app }) => {
        await openGalveston(app);
        await expect(page.locator('#chart')).toBeHidden();
        await page.getByRole('button', { name: 'Surf', exact: true }).click();
        await expect(page.locator('#modeGroup button[aria-pressed="true"]')).toHaveText('Surf');
        await expect(page.locator('#chart')).toBeHidden();
        await page.getByRole('button', { name: 'Inshore', exact: true }).click();
        await expect(page.locator('#chart')).toBeVisible();
    });

    test('is left out where NOAA has no depth lines', async ({ page, api, app }) => {
        api.chart = false;
        await openGalveston(app, 'Inshore');
        await expect.poll(() => chartCalls(api, 'enc_approach')).toBe(1); // harbour charts, then approach charts
        await expect(page.locator('#chart')).toBeHidden();
        expect(chartCalls(api)).toBe(1);
    });

    test('without tide predictions, says how to allow for the tide', async ({ page, api, app }) => {
        api.coast = { tides: false };
        await openGalveston(app, 'Inshore');
        await expect(page.locator('#chartStatus')).toContainText('Depth lines from NOAA charts');
        await expect(page.locator('#chartNotes .chart-item').nth(1)).toContainText('Add the height of the tide');
    });

    test('says so when the chart cannot be loaded, and tries again when asked', async ({ page, api, app }) => {
        api.fail('depth-noaa', 503);
        await openGalveston(app, 'Inshore');
        await expect(page.locator('#chartStatus')).toContainText('The chart couldn\'t be loaded.');
        await expect(page.locator('#chartMapFrame')).toBeHidden();
        await expect(page.locator('#chartNotes .chart-item')).toHaveCount(2); // how to read a chart still stands

        api.restore('depth-noaa');
        await page.getByRole('button', { name: 'Try again' }).click();
        await expect(page.locator('#chartStatus')).toContainText('Depth lines from NOAA charts: 0 to 12 ft');
        await expect(page.locator('#chartMapFrame')).toBeVisible();
    });

    test('remembers the chart for the next visit', async ({ page, api, app }) => {
        await openGalveston(app, 'Inshore');
        await expect(page.locator('#chartStatus')).toContainText('Depth lines from NOAA charts');
        await page.reload();
        await app.loaded();
        await expect(page.locator('#chartStatus')).toContainText('Depth lines from NOAA charts');
        expect(chartCalls(api)).toBe(1);
    });

    test('goes through the site\'s proxy where it is deployed', async ({ page, api, app }) => {
        api.proxy = true;
        await openGalveston(app, 'Inshore');
        await expect(page.locator('#chartStatus')).toContainText('Depth lines from NOAA charts: 0 to 12 ft');
        expect(api.count('depth', 'charts=1')).toBe(1);
        expect(chartCalls(api)).toBe(0);
    });
});

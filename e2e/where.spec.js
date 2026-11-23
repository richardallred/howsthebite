import { expect, test } from './support/fixtures.js';

// The mocks put every place in a 2 km square "Test Lake" with one long cove off its south
// shore (nhdResponse and overpassResponse in support/api-mocks.js).

test.describe('where to look', () => {
    test('lists what to look for and marks it, numbered, on the lake', async ({ page, api, app }) => {
        await app.open();
        const section = page.locator('#where');
        await expect(section).toBeVisible();
        await expect(page.locator('#whereLake')).toContainText('Test Lake');
        await expect(page.locator('#whereList .where-item').first()).toBeVisible();

        await section.scrollIntoViewIfNeeded(); // loads the map library
        await expect(page.locator('#whereMap .lake-outline')).toHaveCount(1);
        const tags = page.locator('#whereMap .zone-tag');
        await expect(tags.first()).toHaveText('1');
        // Leaflet's own stylesheet must not undo the grid that centres the number in its tag.
        await expect(tags.first()).toHaveCSS('display', 'grid');
        expect(await page.locator('#whereMap .lake-zone').count()).toBe(await tags.count());
        await expect(page.locator('#whereList')).toContainText('on the map: 1');

        // No proxy on a static host: the browser asked NHD itself, and had no need of Overpass.
        expect(api.count('lake')).toBe(1);
        expect(api.count('nhd')).toBe(1);
        expect(api.count('overpass')).toBe(0);
    });

    test('turns to OpenStreetMap when NHD fails', async ({ page, api, app }) => {
        api.fail('nhd', 504);
        await app.open();
        await expect(page.locator('#whereLake')).toContainText('Test Lake');
        expect(api.count('overpass')).toBe(2);
    });

    test('remembers a lake\'s outline for the next visit', async ({ page, api, app }) => {
        await app.open();
        await expect(page.locator('#whereLake')).toContainText('Test Lake');
        await page.reload();
        await app.loaded();
        await expect(page.locator('#whereLake')).toContainText('Test Lake');
        expect(api.count('nhd')).toBe(1);
    });

    test('goes through the site\'s proxy where it is deployed', async ({ page, api, app }) => {
        api.proxy = true;
        await app.open();
        await expect(page.locator('#whereLake')).toContainText('Test Lake');
        expect(api.count('nhd')).toBe(0);
    });

    test('says what to look for even when the lake outline cannot be loaded', async ({ page, api, app }) => {
        api.fail('nhd', 504);
        api.fail('overpass', 504);
        await app.open();
        await expect(page.locator('#whereLake')).toContainText('couldn\'t be loaded');
        await expect(page.locator('#whereList .where-item').first()).toBeVisible();
        await expect(page.locator('#whereMapFrame')).toBeHidden();

        api.restore('nhd');
        await page.getByRole('button', { name: 'Try again' }).click();
        await expect(page.locator('#whereLake')).toContainText('Test Lake');
        await expect(page.locator('#whereMapFrame')).toBeVisible();
    });
});

// The mocks give Test Lake two depth contours, 10 and 20 ft, from the Michigan DNR layer
// (depthResponse in support/api-mocks.js); api.depth says who has surveyed it.

test.describe('depth contours', () => {
    test('draws a surveyed lake\'s contours, labelled in feet, and says whose they are', async ({ page, api, app }) => {
        await app.open();
        await expect(page.locator('#whereLake')).toContainText('Depth lines from Michigan DNR: 10 to 20 ft.');

        await page.locator('#where').scrollIntoViewIfNeeded(); // loads the map library
        await expect(page.locator('#whereMap .depth-line')).toHaveCount(2);
        await expect(page.locator('#whereMap .depth-label')).toHaveText(['10', '20']);
        await expect(page.locator('#whereMap .depth-legend')).toHaveText(/Depth, ft\s*≤10\s*≤20/);
        const credit = page.locator('#whereMap .leaflet-control-attribution');
        await expect(credit).toContainText('not for navigation');
        await expect(credit.getByRole('link', { name: 'Michigan DNR' })).toHaveAttribute('href', /^https:\/\/www\.arcgis\.com\//);
        // The spots are still marked, on top.
        await expect(page.locator('#whereMap .zone-tag').first()).toHaveText('1');

        // No proxy on a static host: the browser asked the state's service itself, and had no need of NOAA.
        expect(api.count('depth')).toBe(1);
        expect(api.count('depth-state')).toBe(1);
        expect(api.count('depth-noaa')).toBe(0);
    });

    test('turns to NOAA\'s charts where the state has no survey', async ({ page, api, app }) => {
        api.depth = 'noaa';
        await app.open();
        await expect(page.locator('#whereLake')).toContainText('Depth lines from NOAA charts: 10 to 20 ft.');
        expect(api.count('depth-state')).toBe(1);
        expect(api.count('depth-noaa')).toBe(1);
    });

    test('draws the lake without depth where nobody has surveyed it', async ({ page, api, app }) => {
        api.depth = 'none';
        await app.open();
        await expect(page.locator('#whereLake')).toContainText('Test Lake');
        await page.locator('#where').scrollIntoViewIfNeeded();
        await expect(page.locator('#whereMap .lake-outline')).toHaveCount(1);
        await expect.poll(() => api.count('depth-noaa')).toBe(2); // harbour charts, then approach charts
        await expect(page.locator('#whereMap .depth-line')).toHaveCount(0);
        await expect(page.locator('#whereMap .depth-legend')).toHaveCount(0);
        await expect(page.locator('#whereLake')).not.toContainText('Depth');
    });

    test('says nothing when the depth services are down: the card works without them', async ({ page, api, app }) => {
        api.fail('depth-state', 503);
        api.fail('depth-noaa', 503);
        await app.open();
        await expect(page.locator('#whereLake')).toContainText('Test Lake');
        await page.locator('#where').scrollIntoViewIfNeeded();
        await expect(page.locator('#whereMap .lake-outline')).toHaveCount(1);
        await expect.poll(() => api.count('depth-noaa')).toBeGreaterThan(0);
        await expect(page.locator('#whereMap .depth-line')).toHaveCount(0);
        await expect(page.locator('#whereLake')).not.toContainText('Depth');
    });

    test('remembers a lake\'s contours for the next visit', async ({ page, api, app }) => {
        await app.open();
        await expect(page.locator('#whereLake')).toContainText('Depth lines from Michigan DNR');
        await page.reload();
        await app.loaded();
        await expect(page.locator('#whereLake')).toContainText('Depth lines from Michigan DNR');
        expect(api.count('depth-state')).toBe(1);
    });

    test('goes through the site\'s proxy where it is deployed', async ({ page, api, app }) => {
        api.proxy = true;
        await app.open();
        await expect(page.locator('#whereLake')).toContainText('Depth lines from Michigan DNR');
        expect(api.count('depth')).toBe(1);
        expect(api.count('depth-state')).toBe(0);
    });
});

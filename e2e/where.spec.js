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
        expect(await page.locator('#whereMap .lake-zone').count()).toBe(await tags.count());
        await expect(page.locator('#whereList')).toContainText('on the map: 1');

        // No proxy on a static host: the browser asked NHD itself, and had no need of Overpass.
        expect(api.count('lake')).toBe(1);
        expect(api.count('nhd', 'outFields=objectid')).toBe(1); // the outline (not the lakes around a town)
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
        expect(api.count('nhd', 'outFields=objectid')).toBe(1);
    });

    test('goes through the site\'s proxy where it is deployed', async ({ page, api, app }) => {
        api.proxy = true;
        await app.open();
        await expect(page.locator('#whereLake')).toContainText('Test Lake');
        expect(api.count('nhd')).toBe(0); // the lakes around the town come through the proxy too
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

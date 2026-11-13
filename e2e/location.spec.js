import { DEFAULT_SCORE, expect, test } from './support/fixtures.js';

test.describe('place search', () => {
    test('finds a town, narrows by state, and selects with the keyboard', async ({ page, app }) => {
        await app.open();
        const input = page.getByRole('combobox', { name: 'Search for a place' });

        await input.fill('Asheville, NC');
        const options = page.getByRole('option');
        await expect(options).toHaveText([/Asheville, North CarolinaBuncombe County/]); // Ohio, and the mall, are filtered out
        await expect(input).toHaveAttribute('aria-expanded', 'true');

        await input.press('ArrowDown');
        await expect(input).toHaveAttribute('aria-activedescendant', 'search-option-0');
        await input.press('Enter');
        await app.loaded();

        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Asheville, North Carolina');
        await expect(input).toHaveValue('');
        await expect(page.locator('#searchResults')).toBeHidden();
        await expect(page.locator('#notice')).toBeHidden(); // the first-visit hint goes away
    });

    test('pressing Enter straight away picks the best match', async ({ page, app }) => {
        await app.open();
        const input = page.getByRole('combobox', { name: 'Search for a place' });
        await input.fill('Madison');
        await input.press('Enter');
        await app.loaded();
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Madison, Wisconsin');
    });

    test('finds lakes by name and prefers a lake sensor for them', async ({ page, app }) => {
        await app.open();
        await page.getByRole('combobox', { name: 'Search for a place' }).fill('Lake Norman');

        const options = page.getByRole('option');
        // The Canadian lake, the wastewater basin and the loosely matched "Lake Thunderbird"
        // are dropped; the town of the same name still follows.
        await expect(options).toHaveText([
            /Lake Norman, North Carolina.*Reservoir · Iredell County/,
            /Lake Norman of Catawba, North Carolina/,
        ]);

        await options.first().click();
        await app.loaded();
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lake Norman, North Carolina');
        // A river sensor is nearer (2 mi vs 8 mi) but the place is a lake.
        await expect(app.station('Clear Lake')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#levelStats')).toContainText('Lake level');
    });

    test('says so when nothing matches, and when the search service is down', async ({ page, api, app }) => {
        await app.open();
        const input = page.getByRole('combobox', { name: 'Search for a place' });

        await input.fill('zzzzqq');
        await expect(page.locator('.search-message')).toContainText('No US places match “zzzzqq”');
        await input.press('Escape');
        await expect(page.locator('#searchResults')).toBeHidden();

        api.fail('photon', 'network');
        await input.fill('Asheville');
        await expect(page.locator('.search-message')).toContainText('Search is unavailable right now');
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Chicago, Illinois'); // nothing else is disturbed
    });

    test('place names from the network are rendered as text, never as markup', async ({ page, context, app }) => {
        await context.route('**/photon.komoot.io/**', (route) => route.fulfill({
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify({
                features: [{
                    geometry: { type: 'Point', coordinates: [-87.6298, 41.8781] },
                    properties: {
                        name: '<img src=x onerror="window.__xss = true">', state: 'Ohio', county: 'X',
                        countrycode: 'US', osm_key: 'place', osm_value: 'town',
                    },
                }],
            }),
        }));
        await app.open();
        await page.getByRole('combobox', { name: 'Search for a place' }).fill('img');
        await page.getByRole('option').first().click();
        await app.loaded();

        await expect(page.getByRole('heading', { level: 1 })).toContainText('<img src=x');
        expect(await page.evaluate(() => window.__xss)).toBeUndefined();
        await expect(page.locator('h1 img')).toHaveCount(0);
    });
});

test.describe('recent places and persistence', () => {
    test('previous places become one-tap chips', async ({ page, app }) => {
        await app.open();
        await app.search('Asheville', 'Asheville, North Carolina');
        await app.search('Madison', 'Madison, Wisconsin');

        const chips = page.locator('#recentLocations .chip');
        await expect(chips).toHaveText(['Asheville, North Carolina']); // the current place is not repeated
        await chips.first().click();
        await app.loaded();
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Asheville, North Carolina');
        await expect(chips).toHaveText(['Madison, Wisconsin']);
    });

    test('a reload restores the place instantly without calling any API', async ({ page, api, app }) => {
        await app.open();
        await app.search('Asheville', 'Asheville, North Carolina');
        const callsBefore = api.calls.length;

        await page.reload();
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Asheville, North Carolina');
        await expect(page.locator('#scoreValue')).toHaveText(DEFAULT_SCORE);
        await expect(page.locator('#notice')).toBeHidden();
        expect(api.calls.length).toBe(callsBefore);
    });

    test('data older than 15 minutes is refreshed on the next visit', async ({ page, api, app }) => {
        await app.open();
        const observationCalls = api.count('nws', '/observations');

        await page.clock.setFixedTime(Date.parse('2026-06-15T15:20:00Z'));
        await page.reload();
        await expect.poll(() => api.count('nws', '/observations')).toBe(observationCalls + 1);
    });

    test('switching places quickly ends on the last one', async ({ page, app }) => {
        await app.open();
        await app.search('Asheville', 'Asheville, North Carolina');
        await app.search('Madison', 'Madison, Wisconsin');

        // Click the Asheville chip and immediately search again: the chip's load must be discarded.
        await page.locator('#recentLocations .chip').first().click();
        const input = page.getByRole('combobox', { name: 'Search for a place' });
        await input.fill('Madison');
        await input.press('Enter');
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Madison, Wisconsin');
        await app.loaded();
        // The saved snapshot is written when Madison's load finishes; Asheville's must never land after it.
        await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('htb:snapshot'))?.location.name))
            .toBe('Madison, Wisconsin');
        await expect(page.locator('#recentLocations .chip')).toHaveText(['Asheville, North Carolina']);
    });
});

test.describe('use my location, permission already granted', () => {
    test.use({ geolocation: { latitude: 43.07312, longitude: -89.40123 }, permissions: ['geolocation'] });

    test('a first visit goes straight to the device location', async ({ page, api }) => {
        await page.goto('/');
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Madison, Wisconsin');
        await expect(page.locator('#scoreValue')).toHaveText(DEFAULT_SCORE);
        await expect(page.locator('#notice')).toBeHidden();

        // Coordinates are rounded to three decimals (about 100 m) before they leave the device…
        expect(api.count('nws', '/points/43.0730,-89.4010')).toBe(1);
        // …and USGS is only ever asked about a wide box snapped to a 0.1° grid.
        const usgsCall = api.calls.find((call) => call.url.includes('latest-continuous')).url;
        expect(new URL(usgsCall).searchParams.get('bbox')).toMatch(/^-?\d+\.\d{2},-?\d+\.\d{2},-?\d+\.\d{2},-?\d+\.\d{2}$/);
        expect(usgsCall).not.toContain('43.073');
    });
});

test.describe('use my location, no permission', () => {
    test('a denied request explains what to do instead', async ({ page, app }) => {
        await app.open();
        await page.getByRole('button', { name: 'Use my location' }).first().click();
        await expect(page.locator('#noticeText')).toContainText(/Location access was denied|couldn't be determined/);
        await expect(page.locator('#locateBtn')).toBeEnabled();
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Chicago, Illinois');
    });
});

test.describe('species on offer follow the region', () => {
    const choices = (page) => page.locator('#speciesGroup button');

    test('a northern place offers every group, named for the fish recorded there', async ({ page, api, app }) => {
        await app.open();
        await expect(choices(page)).toHaveText(['All species', 'Bass & panfish', 'Walleye & pike', 'Trout']);
        await expect(page.locator('#speciesNote')).toBeHidden();

        // One question per region, remembered afterwards: a reload asks nothing.
        expect(api.count('gbif')).toBe(1);
        const asked = new URL(api.calls.find((call) => call.service === 'gbif').url).searchParams;
        expect(asked.get('decimalLatitude')).toBe('41.0,43.0'); // a 0.5° grid cell, not the exact spot
        expect(asked.get('decimalLongitude')).toBe('-88.8,-86.2');
        expect(asked.getAll('license')).toEqual(['CC0_1_0', 'CC_BY_4_0']);
        await page.reload();
        await app.loaded();
        await expect(choices(page)).toHaveCount(4);
        expect(api.count('gbif')).toBe(1);
    });

    test('where only bass and panfish are recorded there is nothing to choose, and the score says what it used', async ({ page, api, app }) => {
        api.species = { largemouth: 900, bluegill: 700, channelCatfish: 60, sauger: 4, rainbow: 3 }; // a few strays
        await app.open();
        await expect(choices(page)).toHaveCount(0);
        await expect(page.locator('#speciesGroup')).toBeHidden();
        await expect(page.locator('#speciesNote')).toHaveText('Scored for bass & panfish, the sport fish found around here.');
        // 68°F sits just under the top of the bass curve, where "all species" would have given full marks.
        await expect(app.factor('Water temperature')).toContainText('Prime range for bass & panfish');
        await expect(app.factor('Water temperature').locator('.factor-points')).toHaveText(/^34\/35/);
    });

    test('a preference for fish that do not live here is set aside, not forgotten', async ({ page, api, app }) => {
        await app.open();
        await page.getByRole('button', { name: 'Walleye & pike' }).click();
        await expect(page.getByRole('button', { name: 'Walleye & pike' })).toHaveAttribute('aria-pressed', 'true');

        // Asheville's region in this test: bass, smallmouth, perch and trout, but no walleye or pike.
        api.species = { largemouth: 500, bluegill: 300, smallmouth: 80, perch: 40, walleye: 2, brown: 200 };
        await app.search('Asheville', 'Asheville, North Carolina');
        await expect(choices(page)).toHaveText(['All species', 'Bass & panfish', 'Smallmouth & perch', 'Trout']);
        await expect(page.getByRole('button', { name: 'Smallmouth & perch' })).toHaveAttribute('aria-pressed', 'true'); // same group, local name
        await expect(app.factor('Water temperature')).toContainText('Prime range for smallmouth & perch');

        // Lake Norman's region: no cool-water fish at all.
        api.species = { largemouth: 500, bluegill: 300, brown: 60 };
        await app.search('Lake Norman', 'Lake Norman, North Carolina');
        await expect(choices(page)).toHaveText(['All species', 'Bass & panfish', 'Trout']);
        await expect(page.getByRole('button', { name: 'All species' })).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#speciesNote')).toHaveText("Walleye & pike aren't recorded around here.");

        // Somewhere they do live, the preference applies again.
        api.species = { largemouth: 400, bluegill: 300, walleye: 120, pike: 100, rainbow: 150 };
        await app.search('Madison', 'Madison, Wisconsin');
        await expect(page.getByRole('button', { name: 'Walleye & pike' })).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#speciesNote')).toBeHidden();
    });

    test('if the species lookup fails, conditions still load and the usual choices are offered', async ({ page, api, app }) => {
        api.fail('gbif', 503);
        await app.open();
        await expect(page.locator('#scoreValue')).toHaveText(DEFAULT_SCORE);
        await expect(choices(page)).toHaveText(['All species', 'Bass & panfish', 'Walleye & pike', 'Trout']);
    });
});

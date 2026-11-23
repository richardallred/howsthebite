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
        await expect(page).toHaveTitle("Asheville, North Carolina Fishing Forecast Today — How's the Bite?");
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
        // A lake's depth contours are asked for once its outline is in, after the page counts
        // as loaded. Wait until both places' answers are kept, so the count is of a visit that
        // has settled.
        await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('htb-depth:')).length)).toBe(2);
        const callsBefore = api.calls.length;

        await page.reload();
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Asheville, North Carolina');
        await expect(page.locator('#nowScore')).toHaveText(DEFAULT_SCORE);
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
        await expect(page).toHaveTitle("Madison, Wisconsin Fishing Forecast Today — How's the Bite?");
        await expect(page.locator('#nowScore')).toHaveText(DEFAULT_SCORE);
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
        await expect(choices(page)).toHaveText(['All species', 'Bass & panfish', 'Catfish', 'Walleye & pike', 'Trout']);
        await expect(page.locator('#speciesNote')).toBeHidden();

        // One question per region, remembered afterwards: a reload asks nothing.
        expect(api.count('gbif')).toBe(1);
        const asked = new URL(api.calls.find((call) => call.service === 'gbif').url).searchParams;
        expect(asked.get('decimalLatitude')).toBe('41.0,43.0'); // a 0.5° grid cell, not the exact spot
        expect(asked.get('decimalLongitude')).toBe('-88.8,-86.2');
        expect(asked.getAll('license')).toEqual(['CC0_1_0', 'CC_BY_4_0']);
        await page.reload();
        await app.loaded();
        await expect(choices(page)).toHaveCount(5);
        expect(api.count('gbif')).toBe(1);
    });

    test('where only warm-water fish are recorded, bass and panfish lead with catfish beside them', async ({ page, api, app }) => {
        api.species = { largemouth: 900, bluegill: 700, channelCatfish: 60, sauger: 4, rainbow: 3 }; // a few strays
        await app.open();
        // No "All species": with one temperature group it would mean the same as bass and panfish.
        await expect(choices(page)).toHaveText(['Bass & panfish', 'Catfish']);
        await expect(page.getByRole('button', { name: 'Bass & panfish' })).toHaveAttribute('aria-pressed', 'true');
        // 68°F sits just under the top of the bass curve, where "all species" would have given full marks.
        await expect(app.factor('Water temperature')).toContainText('Prime range for bass & panfish');
        await expect(app.factor('Water temperature').locator('.factor-points')).toHaveText(/^34\/35/);
    });

    test('catfish have their own score and lures, and the choice is remembered', async ({ page, app }) => {
        await app.open();
        await page.getByRole('button', { name: 'Catfish' }).click();
        await expect(page.getByRole('button', { name: 'Catfish' })).toHaveAttribute('aria-pressed', 'true');
        // 68°F is short of the catfish's warmer prime range.
        await expect(app.factor('Water temperature')).not.toContainText('Prime range');
        await expect(page.locator('.lure-target').first()).toHaveText(/^For catfish/);
        await expect(page.locator('.lure-target', { hasText: 'For bass' })).toHaveCount(0);

        await page.reload();
        await app.loaded();
        await expect(page.getByRole('button', { name: 'Catfish' })).toHaveAttribute('aria-pressed', 'true');
    });

    test('a preference for fish that do not live here is set aside, not forgotten', async ({ page, api, app }) => {
        await app.open();
        await page.getByRole('button', { name: 'Walleye & pike' }).click();
        await expect(page.getByRole('button', { name: 'Walleye & pike' })).toHaveAttribute('aria-pressed', 'true');

        // Asheville's region in this test: bass, smallmouth, perch and trout, but no walleye or pike.
        api.species = { largemouth: 500, bluegill: 300, smallmouth: 80, perch: 40, walleye: 2, brown: 200 };
        await app.search('Asheville', 'Asheville, North Carolina');
        await expect(choices(page)).toHaveText(['All species', 'Bass & panfish', 'Catfish', 'Smallmouth & perch', 'Trout']);
        await expect(page.getByRole('button', { name: 'Smallmouth & perch' })).toHaveAttribute('aria-pressed', 'true'); // same group, local name
        await expect(app.factor('Water temperature')).toContainText('Prime range for smallmouth & perch');

        // Lake Norman's region: no cool-water fish at all.
        api.species = { largemouth: 500, bluegill: 300, brown: 60 };
        await app.search('Lake Norman', 'Lake Norman, North Carolina');
        await expect(choices(page)).toHaveText(['All species', 'Bass & panfish', 'Catfish', 'Trout']);
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
        await expect(page.locator('#nowScore')).toHaveText(DEFAULT_SCORE);
        await expect(choices(page)).toHaveText(['All species', 'Bass & panfish', 'Catfish', 'Walleye & pike', 'Trout']);
    });
});

test.describe('nearby water', () => {
    test('a town offers its lakes and its rivers, each kind with its own places', async ({ page, app }) => {
        await app.open();
        await app.loaded();

        const nearby = page.locator('#nearbyWater');
        await expect(nearby.getByRole('group', { name: 'Lakes' }).getByRole('link')).toHaveText([/^Little Lake\s*1 mi$/, /^Test Reservoir\s*\d+ mi$/]);
        await expect(nearby.getByRole('group', { name: 'Rivers' }).getByRole('link')).toHaveText([/^Des Plaines River\s*1 mi$/, /^Fox River\s*2 mi$/]);
        await expect(nearby.getByRole('group', { name: 'Salt water' })).toHaveCount(0); // inland
        await expect(nearby.getByRole('link', { name: /Test Reservoir/ })).toHaveAttribute('href', /test-reservoir-illinois\?.*water=lake/);

        await nearby.getByRole('link', { name: /Test Reservoir/ }).click();
        await app.loaded();
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Test Reservoir, Illinois');
        await expect(nearby).toBeHidden(); // already on the water
    });

    test('on the coast, a bay opens in inshore mode', async ({ page, app }) => {
        await app.open();
        await page.getByRole('combobox', { name: 'Search for a place' }).fill('Galveston');
        await page.getByRole('option').first().click();
        await app.loaded();

        const salt = page.locator('#nearbyWater').getByRole('group', { name: 'Salt water' });
        await expect(salt.getByRole('link')).toHaveText([/^Galveston Bay\s*\d+ mi$/, /^West Bay\s*\d+ mi$/]);
        await expect(salt.getByRole('link', { name: /Galveston Bay/ })).toHaveAttribute('href', /galveston-bay-texas\?.*mode=inshore/);

        await salt.getByRole('link', { name: /Galveston Bay/ }).click();
        await app.loaded();
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Galveston Bay, Texas');
        await expect(page).toHaveURL(/mode=inshore/);
        await expect(page.locator('#nearbyWater')).toBeHidden();
    });

    test('without the lake list the rivers are still offered', async ({ page, api, app }) => {
        api.fail('lakes', 500);
        await app.open();
        await app.loaded();
        await expect(page.locator('#nearbyWater').getByRole('group', { name: 'Rivers' }).getByRole('link')).toHaveCount(2);
        await expect(page.locator('#nearbyWater').getByRole('group', { name: 'Lakes' })).toHaveCount(0);
    });
});

import { DEFAULT_SCORE, expect, test } from './support/fixtures.js';

// Every place has its own address. The static test server serves index.html for them, as the
// Pages Function does; what the function adds (title and meta tags in the served HTML) is
// covered by tests/place-url.test.js and by running these against `npm run preview`.

const ASHEVILLE = '/fishing/35.6,-82.55/asheville-north-carolina';
const MADISON = '/fishing/43.07,-89.4/madison-wisconsin';
const LAKE_CHAMPLAIN = '/fishing/44.32,-73.32/lake-champlain-vermont'; // has a sensor of its own (js/core/listed-places.js)
const heading = (page) => page.getByRole('heading', { level: 1 });
const path = (page) => new URL(page.url()).pathname;

test.describe('place addresses', () => {
    test('a shared link opens that place, with no first-visit hint and no switch to where you are', async ({ page, context, api, app }) => {
        await context.grantPermissions(['geolocation']);
        await context.setGeolocation({ latitude: 43.0731, longitude: -89.4012 });
        await app.open(ASHEVILLE);

        await expect(heading(page)).toHaveText('Asheville, North Carolina');
        await expect(page).toHaveTitle("Asheville, North Carolina Fishing Forecast Today — How's the Bite?");
        await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://howsthebite.io${ASHEVILLE}`);
        await expect(page.locator('#notice')).toBeHidden();
        expect(api.count('nws', '/points/35.6000,-82.5500')).toBeGreaterThan(0);

        // The conditions in a sentence under the name, and as the description a search result shows.
        await expect(page.locator('#locationLede')).toHaveText(/^[A-Z][a-z ]+ fishing today, best [\d:–APM ]+\. Water \d+\.\d°F/);
        await expect(page.locator('meta[name="description"]')).toHaveAttribute('content',
            /^Asheville, North Carolina fishing forecast for Monday, June 15: [a-z ]+, \d+ out of 100, best [\d:–APM ]+\. Water temperature \d+\.\d°F/);
        // The sections say whose weather and water they are.
        await expect(page.locator('#forecastTitle')).toHaveText('Asheville 5-day weather');
        await expect(page.locator('#waterTitle')).toHaveText('Water temperature, level and flow near Asheville');
        expect(path(page)).toBe(ASHEVILLE);

        // It is now the place this visitor last looked at.
        await page.goto('/');
        await app.loaded();
        await expect(heading(page)).toHaveText('Asheville, North Carolina');
    });

    test('choosing a place gives it its own address, and Back and Forward move between places', async ({ page, app }) => {
        await app.open();
        expect(path(page)).toBe('/'); // the default city keeps the home page's address
        await app.search('Asheville', 'Asheville, North Carolina');
        await expect(page).toHaveURL(new RegExp(`${ASHEVILLE}\\?fish=any$`));
        await app.search('Madison', 'Madison, Wisconsin');
        await expect.poll(() => path(page)).toBe(MADISON);

        await page.goBack();
        await expect(heading(page)).toHaveText('Asheville, North Carolina');
        await app.loaded();
        expect(path(page)).toBe(ASHEVILLE);
        await expect(page).toHaveTitle(/^Asheville, North Carolina/);

        await page.goForward();
        await expect(heading(page)).toHaveText('Madison, Wisconsin');
        await app.loaded();

        await page.reload();
        await app.loaded();
        await expect(heading(page)).toHaveText('Madison, Wisconsin');
    });

    test('opening the home page shows your place at its own address, keeping the #section', async ({ page, app }) => {
        await app.open();
        await app.search('Asheville', 'Asheville, North Carolina');
        await page.goto('/#forecast');
        await app.loaded();
        await expect(page).toHaveURL(new RegExp(`${ASHEVILLE}\\?fish=any#forecast$`));
    });

    test('the exact name rides along when the slug cannot spell it, and nothing else is accepted', async ({ page, app }) => {
        await app.open('/fishing/38.63,-90.2/st-louis-missouri?name=St.+Louis%2C+Missouri');
        await expect(heading(page)).toHaveText('St. Louis, Missouri');

        await app.open('/fishing/38.63,-90.2/st-louis-missouri?name=Cheap+tackle');
        await expect(heading(page)).toHaveText('St Louis, Missouri');
    });

    test('an address that names no place is a 404, or the home page where no server checks it', async ({ page, app }) => {
        const response = await page.goto('/fishing/999,1/nowhere');
        if (response.status() === 404) { // the Pages Function (npm run preview, production)
            await expect(heading(page)).toHaveText("Nothing's biting here");
            return;
        }
        await app.loaded();
        await expect(heading(page)).toHaveText('Chicago, Illinois');
        expect(path(page)).toBe('/');
    });

    test('a place with a water sensor of its own says so in its title, heading and summary', async ({ page, app }) => {
        await app.open(LAKE_CHAMPLAIN);
        await expect(heading(page)).toHaveText('Lake Champlain, Vermont');
        await expect(page).toHaveTitle("Lake Champlain, Vermont Fishing Forecast & Water Temperature Today — How's the Bite?");
        await expect(page.locator('#waterTitle')).toHaveText('Lake Champlain water temperature, level and flow');
        await expect(page.locator('#forecastTitle')).toHaveText('Lake Champlain 5-day weather');
        // Whatever the reading, it is never called "the nearest sensor's" here.
        await expect(page.locator('#locationLede')).toHaveText(/ fishing today, best .+\. Water /);
        await expect(page.locator('#locationLede')).not.toContainText('nearest water sensor');
        await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /^Lake Champlain, Vermont fishing forecast for Monday, June 15: .+ Water temperature /);
    });

    test('the place is written into the page as served, for search engines and link previews', async ({ page }) => {
        // Only the Pages Function does this; the static test server serves index.html as it is.
        const response = await page.request.get(`${ASHEVILLE}?fish=cold`);
        const html = await response.text();
        test.skip(!html.includes('<h1 id="locationName">Asheville'), 'needs the Pages Function: run against npm run preview');
        expect(html).toContain("<title>Asheville, North Carolina Fishing Forecast Today — How's the Bite?</title>");
        expect(html).toContain('id="forecastTitle">Asheville 5-day weather</h2>');
        expect(html).toContain('id="waterTitle">Water temperature, level and flow near Asheville</h2>');
        expect(html).toContain('<meta name="description" content="Asheville, North Carolina fishing forecast today: ');

        // A listed place with a sensor of its own promises its water temperature.
        const own = await (await page.request.get(LAKE_CHAMPLAIN)).text();
        expect(own).toContain("<title>Lake Champlain, Vermont Fishing Forecast &amp; Water Temperature Today — How's the Bite?</title>");
        expect(own).toContain('id="waterTitle">Lake Champlain water temperature, level and flow</h2>');
        expect(html).toContain(`<link rel="canonical" href="https://howsthebite.io${ASHEVILLE}">`);
        expect(html).toContain(`<meta property="og:url" content="https://howsthebite.io${ASHEVILLE}">`);
        expect(response.headers()['content-security-policy']).toContain("default-src 'self'");

        const near = await page.request.get('/fishing/35.601,-82.554/Asheville-North-Carolina/?fish=cold', { maxRedirects: 0 });
        expect(near.status()).toBe(301);
        const location = new URL(near.headers().location);
        expect(location.pathname + location.search).toBe(`${ASHEVILLE}?fish=cold`);
    });

    test('recent places are links to their addresses', async ({ page, app }) => {
        await app.open();
        await app.search('Asheville', 'Asheville, North Carolina');
        await app.search('Madison', 'Madison, Wisconsin');
        await expect(page.locator('#recentLocations .chip')).toHaveAttribute('href', ASHEVILLE);
    });

    test('the empty search box offers recent places, by mouse or keyboard', async ({ page, app }) => {
        await app.open();
        await app.search('Asheville', 'Asheville, North Carolina');
        await app.search('Madison', 'Madison, Wisconsin');

        const input = page.locator('#searchInput');
        await input.focus();
        const options = page.locator('#searchResults [role="option"]');
        await expect(page.locator('#searchResults')).toContainText('Recent places');
        await expect(options).toHaveText([/^Asheville, North Carolina/]); // not the place already showing
        await input.press('ArrowDown');
        await input.press('Enter');
        await expect(heading(page)).toHaveText('Asheville, North Carolina');
    });

    test('once the heading scrolls away, the header names the place and its score', async ({ page, app }) => {
        await app.open();
        const place = page.locator('#headerPlace');
        await expect(place).toBeHidden();
        await page.locator('#forecast').scrollIntoViewIfNeeded();
        await expect(place).toBeVisible();
        await expect(place).toContainText('Chicago, Illinois');
        await expect(page.locator('#headerScore')).toHaveText(await page.locator('#scoreValue').textContent());
        await place.click();
        await expect(place).toBeHidden(); // back at the top, with the heading in view
    });
});

test.describe('popular places', () => {
    const LAKE_NORMAN = '/fishing/35.59,-80.93/lake-norman-north-carolina';

    test('have their own page, linked from the home page, with ordinary links to place addresses', async ({ page, app }) => {
        await app.open();
        await expect(page.locator('#places')).toHaveCount(0); // no longer on the home page
        await page.getByRole('link', { name: 'Popular fishing spots' }).click();
        await expect(page).toHaveURL(/\/spots\/$/);
        // The places are grouped by state; the links are in the page whether a state is open or not.
        await expect(page.locator('#places details')).not.toHaveCount(0);
        await page.locator('#places summary', { hasText: /^North Carolina$/ }).click();
        const link = page.getByRole('link', { name: 'Lake Norman, North Carolina' });
        await expect(link).toHaveAttribute('href', LAKE_NORMAN); // what a search engine follows

        await link.click();
        await app.loaded();
        await expect(heading(page)).toHaveText('Lake Norman, North Carolina');
        // The app knows it is a lake, as a search for it would.
        await expect(page).toHaveURL(new RegExp(`${LAKE_NORMAN.replace('.', '\\.')}\\?water=lake`));
    });

    test('the questions have their own page, linked from the home page', async ({ page, app }) => {
        await app.open();
        await expect(page.locator('#questions')).toHaveCount(0);
        await page.getByRole('link', { name: 'Fishing questions, answered' }).click();
        await expect(page).toHaveURL(/\/faq\/$/);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fishing questions, answered');
        await expect(page.locator('#questions details')).not.toHaveCount(0);
    });

    test('someone who arrives at a listed place from a search engine gets its kind of water too', async ({ page, app }) => {
        await app.open(LAKE_NORMAN);
        await expect(heading(page)).toHaveText('Lake Norman, North Carolina');
        await expect(page).toHaveURL(/\?water=lake/);
        await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://howsthebite.io${LAKE_NORMAN}`);
    });

    test('before any script runs, the page already says what it is', async ({ page }) => {
        const html = await (await page.request.get('/')).text();
        expect(html).toContain('<h1 id="locationName">Fishing forecast</h1>');
        expect(html).not.toContain('Loading…');
    });
});

test.describe('shared choices', () => {
    test('the fish in a link is used for that visit, and your own choice is kept', async ({ page, app }) => {
        await app.open('/fishing/41.88,-87.63/chicago-illinois?fish=cold');
        await expect(page.getByRole('button', { name: 'Trout' })).toHaveAttribute('aria-pressed', 'true');

        await page.goto('/');
        await app.loaded();
        await expect(page.getByRole('button', { name: 'All species' })).toHaveAttribute('aria-pressed', 'true');
        await expect(page).toHaveURL(/\/fishing\/41\.88,-87\.63\/chicago-illinois\?fish=any$/);
    });

    test('a change of fish or water updates the address', async ({ page, app }) => {
        await app.open();
        await app.search('Galveston', 'Galveston, Texas');
        await page.getByRole('button', { name: 'Inshore', exact: true }).click();
        await expect(page).toHaveURL(/\/fishing\/29\.3,-94\.8\/galveston-texas\?mode=inshore(&fish=\w+)?$/);

        await page.goto('/fishing/29.3,-94.8/galveston-texas?mode=surf');
        await app.loaded();
        await expect(page.getByRole('button', { name: 'Surf', exact: true })).toHaveAttribute('aria-pressed', 'true');
    });
});

test.describe('the share button', () => {
    test('hands the address and the score to the system share sheet', async ({ page, app }) => {
        await page.addInitScript(() => {
            navigator.share = async (data) => { window.__shared = data; };
        });
        await app.open(ASHEVILLE);
        await page.getByRole('button', { name: 'Share' }).click();
        const shared = await page.evaluate(() => window.__shared);
        expect(shared.url).toBe(new URL(`${ASHEVILLE}?fish=any`, page.url()).href);
        expect(shared.text).toBe(`How's the bite at Asheville, North Carolina? ${DEFAULT_SCORE}/100 (excellent) right now.`);
    });

    test('copies the link where there is no share sheet, or where it is closed without sharing', async ({ page, app }) => {
        await page.addInitScript(() => {
            delete Navigator.prototype.share;
            Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text) => { window.__copied = text; } } });
        });
        await app.open(); // the default city has an address of its own when shared
        await page.getByRole('button', { name: 'Share' }).click();
        await expect(page.locator('#shareLabel')).toHaveText('Link copied');
        expect(await page.evaluate(() => window.__copied)).toBe(new URL('/fishing/41.88,-87.63/chicago-illinois?fish=any', page.url()).href);
        await expect(page.locator('#shareLabel')).toHaveText('Share', { timeout: 4000 });
    });

    test('closing the share sheet does nothing more', async ({ page, app }) => {
        await page.addInitScript(() => {
            navigator.share = async () => { throw new DOMException('Share canceled', 'AbortError'); };
            Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { window.__copied = true; } } });
        });
        await app.open(ASHEVILLE);
        await page.getByRole('button', { name: 'Share' }).click();
        await expect(page.locator('#shareLabel')).toHaveText('Share');
        await expect(page.locator('#notice')).toBeHidden();
        expect(await page.evaluate(() => window.__copied)).toBeUndefined();
    });
});

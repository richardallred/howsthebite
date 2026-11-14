import { DEFAULT_SCORE, expect, test } from './support/fixtures.js';

// Every place has its own address. The static test server serves index.html for them, as the
// Pages Function does; what the function adds (title and meta tags in the served HTML) is
// covered by tests/place-url.test.js and by running these against `npm run preview`.

const ASHEVILLE = '/fishing/35.6,-82.55/asheville-north-carolina';
const MADISON = '/fishing/43.07,-89.4/madison-wisconsin';
const heading = (page) => page.getByRole('heading', { level: 1 });
const path = (page) => new URL(page.url()).pathname;

test.describe('place addresses', () => {
    test('a shared link opens that place, with no first-visit hint and no switch to where you are', async ({ page, context, api, app }) => {
        await context.grantPermissions(['geolocation']);
        await context.setGeolocation({ latitude: 43.0731, longitude: -89.4012 });
        await app.open(ASHEVILLE);

        await expect(heading(page)).toHaveText('Asheville, North Carolina');
        await expect(page).toHaveTitle("Asheville, North Carolina Fishing Forecast — How's the Bite?");
        await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://howsthebite.io${ASHEVILLE}`);
        await expect(page.locator('#notice')).toBeHidden();
        expect(api.count('nws', '/points/35.6000,-82.5500')).toBeGreaterThan(0);
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

    test('the place is written into the page as served, for search engines and link previews', async ({ page }) => {
        // Only the Pages Function does this; the static test server serves index.html as it is.
        const response = await page.request.get(`${ASHEVILLE}?fish=cold`);
        const html = await response.text();
        test.skip(!html.includes('<h1 id="locationName">Asheville'), 'needs the Pages Function: run against npm run preview');
        expect(html).toContain("<title>Asheville, North Carolina Fishing Forecast — How's the Bite?</title>");
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
});

test.describe('popular places', () => {
    const LAKE_NORMAN = '/fishing/35.59,-80.93/lake-norman-north-carolina';

    test('are ordinary links to place addresses, and open without loading a new page', async ({ page, app }) => {
        await app.open();
        await page.locator('#places summary', { hasText: 'Lakes' }).click();
        const link = page.getByRole('link', { name: 'Lake Norman, North Carolina' });
        await expect(link).toHaveAttribute('href', LAKE_NORMAN); // what a search engine follows

        await page.evaluate(() => { window.sameDocument = true; });
        await link.click();
        await expect(heading(page)).toHaveText('Lake Norman, North Carolina');
        await app.loaded();
        expect(await page.evaluate(() => window.sameDocument)).toBe(true);
        expect(await page.evaluate(() => window.scrollY)).toBe(0); // back at the score, not left at the foot of the page
        // The list knows it is a lake, as a search for it would.
        await expect(page).toHaveURL(new RegExp(`${LAKE_NORMAN.replace('.', '\\.')}\\?water=lake`));
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

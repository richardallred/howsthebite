import { DEFAULT_SCORE, expect, test } from './support/fixtures.js';

// Every other spec blocks the service worker so request mocking is airtight.
// Here it is the thing under test.
test.use({ serviceWorkers: 'allow' });

test('after one visit the app opens offline and shows the last conditions with their age', async ({ page, context, api, app }) => {
    await app.open();
    await app.search('Asheville', 'Asheville, North Carolina');

    // Wait until the service worker has installed, cached the shell and taken control.
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    const cached = await page.evaluate(async () => {
        const names = await caches.keys();
        const keys = await (await caches.open(names[0])).keys();
        return keys.map((request) => new URL(request.url).pathname);
    });
    expect(cached).toEqual(expect.arrayContaining(['/index.html', '/styles.css', '/js/app.js', '/vendor/leaflet/leaflet.js']));

    // Mocked routes would still answer while "offline", so take the services down as well.
    const services = ['nws', 'usgs', 'photon', 'tiles'];
    await context.setOffline(true);
    services.forEach((service) => api.fail(service, 'network'));
    await page.reload();

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Asheville, North Carolina');
    await expect(page.locator('#scoreValue')).toHaveText(DEFAULT_SCORE);
    await expect(page.locator('.factor')).toHaveCount(6);
    await expect(page.locator('#pressureChart .chart-line')).toBeVisible();

    await page.getByRole('button', { name: 'Refresh conditions' }).click();
    await expect(page.locator('#noticeText')).toHaveText("You're offline. Showing conditions from just now.");
    await expect(page.locator('#scoreValue')).toHaveText(DEFAULT_SCORE);

    await context.setOffline(false);
    services.forEach((service) => api.restore(service));
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('#notice')).toBeHidden();
});

test('every file the app loads is in the service worker shell list', async ({ page, app }) => {
    const loaded = new Set();
    page.on('requestfinished', (request) => {
        const url = new URL(request.url());
        if (url.hostname !== 'localhost' || url.pathname.startsWith('/api/')) return; // the proxy is not a file
        loaded.add(url.pathname === '/' ? '/index.html' : url.pathname);
    });
    await app.open();
    await page.locator('#water').scrollIntoViewIfNeeded(); // loads the map library
    await expect(page.locator('.leaflet-container')).toBeVisible();

    const source = await (await page.request.get('/sw.js')).text();
    const shell = [...source.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)]
        .map((match) => (match[1] === './' ? '/index.html' : `/${match[1]}`));

    const missing = [...loaded].filter((path) => path !== '/sw.js' && !shell.includes(path));
    expect(missing, 'files loaded by the page but missing from SHELL in sw.js').toEqual([]);
});

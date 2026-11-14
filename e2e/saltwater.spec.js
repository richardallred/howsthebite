import { DEFAULT_SCORE, expect, test } from './support/fixtures.js';

const modes = (page) => page.locator('#modeGroup button');
const labels = (page) => page.locator('.factor-label');
const score = async (page) => Number(await page.locator('#scoreValue').textContent());

/** Open the app at Galveston, Texas: a beach town with a tide station under a mile away. */
async function openGalveston(app, mode = null) {
    await app.open();
    await app.search('Galveston', 'Galveston, Texas');
    if (mode) await app.page.getByRole('button', { name: mode, exact: true }).click();
}

test.describe('choosing the kind of water', () => {
    test('inland there is nothing to choose and no coastal service is asked', async ({ page, api, app }) => {
        await app.open();
        await expect(page.locator('#modeRow')).toBeHidden();
        await expect(page.locator('#tideCard')).toBeHidden();
        await expect(page.locator('#scoreValue')).toHaveText(DEFAULT_SCORE);
        expect(api.count('coops') + api.count('beach') + api.count('sst')).toBe(0);
    });

    test('at the coast, fresh water stays the default and salt water is offered', async ({ page, app }) => {
        await openGalveston(app);
        await expect(page.locator('#modeRow')).toBeVisible();
        await expect(modes(page)).toHaveText(['Freshwater', 'Inshore', 'Surf']);
        await expect(page.getByRole('button', { name: 'Freshwater' })).toHaveAttribute('aria-pressed', 'true');
        await expect(labels(page)).toContainText(['River flow', 'Moon']);
    });

    test('a tidal place that is not an ocean beach offers inshore but not surf', async ({ page, api, app }) => {
        api.coast = { beach: null };
        await openGalveston(app);
        await expect(modes(page)).toHaveText(['Freshwater', 'Inshore']);
    });

    test('the choice is remembered, and set aside where there is no tide', async ({ page, app }) => {
        await openGalveston(app, 'Inshore');
        await page.reload();
        await app.loaded();
        await expect(page.getByRole('button', { name: 'Inshore' })).toHaveAttribute('aria-pressed', 'true');

        await app.search('Asheville', 'Asheville, North Carolina');
        await expect(page.locator('#modeRow')).toBeHidden();
        await expect(labels(page)).toContainText(['River flow', 'Moon']); // scored as fresh water in the mountains
    });
});

test.describe('inshore', () => {
    test('scores water temperature, tide, light, wind and pressure, and shows the tides', async ({ page, app }) => {
        await openGalveston(app, 'Inshore');

        await expect(labels(page)).toHaveText(['Water temperature', 'Tide', 'Light', 'Wind', 'Barometric pressure']);
        await expect(page.locator('.factor-points')).toHaveText([/\/35/, /^27\/27/, /\/18/, /\/17/, /\/3/]);

        const water = app.factor('Water temperature');
        await expect(water.locator('.factor-value')).toHaveText('76.0°F'); // the tide station's own thermometer
        await expect(water).toContainText('Prime range for redfish & seatrout');
        await expect(water).toContainText(/NOAA station .+, 0\.\d mi away/);

        const tide = app.factor('Tide');
        await expect(tide.locator('.factor-value')).toHaveText('Falling · 1.2 ft');
        await expect(tide).toContainText('Outgoing tide at full flow');
        await expect(tide).toContainText('Low 1:00 PM (0.3 ft)');
        await expect(app.factor('Light')).toContainText('Bright sun — try deeper edges');

        // The water section turns into tides; the freshwater parts step aside.
        await expect(page.locator('#waterTitle')).toHaveText('Tides and water temperature');
        await expect(page.locator('#tideStats .level-stat')).toHaveText([
            /^Tide now1\.2 ftfalling$/, /^LowMon 1:00 PM0\.3 ft$/, /^HighMon 7:00 PM2\.0 ft$/, /^LowTue 1:00 AM0\.3 ft$/, /^HighTue 7:00 AM2\.0 ft$/,
        ]);
        await expect(page.locator('#tideSource')).toContainText('NOAA tide predictions for');
        for (const id of ['levelCard', 'waterGrid', 'waterFilter', 'waterChartCard', 'levelChartCard']) {
            await expect(page.locator(`#${id}`)).toBeHidden();
        }
        await expect(page.locator('#pressureChart .chart-line')).toHaveCount(1);
    });

    test('offers the fish of that coast, most recorded first', async ({ page, api, app }) => {
        api.species = { largemouth: 300, redfish: 220, seatrout: 180, southernFlounder: 60, snook: 40, tarpon: 15, stripedBass: 400, whiting: 90, pompano: 30 };
        await openGalveston(app, 'Inshore');
        // Striped bass are reservoir fish in Texas: 400 records there do not make a salt-water fishery.
        await expect(page.locator('#speciesGroup button')).toHaveText(['Redfish & seatrout', 'Snook & tarpon']);

        await page.getByRole('button', { name: 'Snook & tarpon' }).click();
        await expect(app.factor('Water temperature')).toContainText('Prime range for snook & tarpon');
        await page.reload();
        await app.loaded();
        await expect(page.getByRole('button', { name: 'Snook & tarpon' })).toHaveAttribute('aria-pressed', 'true');
    });

    test('slack water scores lower than a running tide', async ({ page, api, app }) => {
        await openGalveston(app, 'Inshore');
        const running = await score(page);

        api.coast = { tideOffsetHours: 3 };
        await page.getByRole('button', { name: 'Refresh conditions' }).click();
        await expect(app.factor('Tide').locator('.factor-value')).toHaveText('Slack · 2.0 ft');
        await expect(app.factor('Tide')).toContainText('Slack water at high tide');
        expect(await score(page)).toBeLessThan(running - 10);
    });

    test('cold water shuts snook down, and the advice says so', async ({ page, api, app }) => {
        api.species = { redfish: 220, seatrout: 180, snook: 400, tarpon: 60 };
        api.coast = { waterTempF: 55 };
        await openGalveston(app, 'Inshore');
        await page.getByRole('button', { name: 'Snook & tarpon' }).click();

        await expect(app.factor('Water temperature')).toContainText('Cold enough to shut snook down');
        await expect(page.locator('#scoreCap')).toHaveText('Held down by the water temperature');
        expect(await score(page)).toBeLessThan(25);
        await expect(page.locator('.lure').first()).toContainText('Leave the snook alone');
    });

    test('water temperature falls back from the station to the satellite to a labelled estimate', async ({ page, api, app }) => {
        api.proxy = true;
        api.coast = { waterTempF: null, beach: null };
        await openGalveston(app, 'Inshore');
        const water = app.factor('Water temperature');
        await expect(water.locator('.factor-value')).toHaveText('74.5°F');
        await expect(water).toContainText('satellite estimate from 1 day ago');

        api.coast = { waterTempF: null, beach: null, satelliteTempF: null };
        await page.getByRole('button', { name: 'Refresh conditions' }).click();
        await expect(water.locator('.factor-value')).toHaveText('≈ 72.0°F');
        await expect(water).toContainText('(estimated)');
        await expect(page.locator('#waterSummary')).toContainText('estimated from the last three days of air temperature');
    });

    test('if NOAA is down the page still loads, without a tide factor', async ({ page, api, app }) => {
        await openGalveston(app, 'Inshore');
        api.fail('coops', 503);
        await page.getByRole('button', { name: 'Refresh conditions' }).click();
        await expect(labels(page)).toHaveText(['Water temperature', 'Light', 'Wind', 'Barometric pressure']);
        await expect(page.locator('#tideSource')).toHaveText('Tide predictions are unavailable right now.');
        await expect(page.locator('#scoreValue')).toHaveText(/^\d+$/);
    });
});

test.describe('surf', () => {
    test('adds the surf from the beach forecast, with the rip-current risk', async ({ page, app }) => {
        await openGalveston(app, 'Surf');
        await expect(labels(page)).toHaveText(['Water temperature', 'Surf', 'Tide', 'Light', 'Wind', 'Barometric pressure']);

        const surf = app.factor('Surf');
        await expect(surf.locator('.factor-value')).toHaveText('3 ft');
        await expect(surf).toContainText('Fishable surf');
        await expect(surf).toContainText('Rip current risk: low');
        await expect(surf.locator('.factor-points')).toHaveText(/^22\/22/);
        await expect(page.locator('#speciesGroup button')).toHaveText(['Redfish & whiting', 'Pompano']);
    });

    test('out of season the wave forecast just offshore stands in, arriving a moment later', async ({ page, api, app }) => {
        api.coast = { beach: { name: 'N/A', rip: null, surf: null, wtemp: null }, waveFt: 4.5 };
        await openGalveston(app, 'Surf');

        const surf = app.factor('Surf');
        await expect(surf.locator('.factor-value')).toHaveText('5 ft'); // rounded from 4.5
        await expect(surf).toContainText('NWS wave forecast just offshore');
        await expect(surf).toContainText('Rough surf');
        // The forecast cell is remembered, so the search for it is not repeated.
        const probes = api.count('nws', '/zones');
        expect(probes).toBe(8);
        await page.reload();
        await app.loaded();
        await expect(app.factor('Surf').locator('.factor-value')).toHaveText('5 ft');
        expect(api.count('nws', '/zones')).toBe(probes);
    });

    test('with no wave information at all the surf is left out, not guessed', async ({ page, api, app }) => {
        api.coast = { beach: { name: 'N/A', rip: null, surf: null, wtemp: null }, waveFt: null };
        await openGalveston(app, 'Surf');
        await expect(labels(page)).toHaveText(['Water temperature', 'Tide', 'Light', 'Wind', 'Barometric pressure']);
    });

    test('heavy surf holds the score down and a high rip risk is flagged', async ({ page, api, app }) => {
        api.coast = { beach: { name: 'Galveston Island Beaches', rip: 'High', surf: '7 to 9 feet.', wtemp: 'in the mid 70s' } };
        await openGalveston(app, 'Surf');

        await expect(app.factor('Surf')).toContainText('Dangerous surf');
        await expect(page.locator('#scoreCap')).toHaveText('Held down by the surf');
        expect(await score(page)).toBeLessThan(25);
        await expect(page.locator('#alerts .alert')).toHaveText(['High rip current risk at the beach today']);

        // Inshore, behind the island, the same day is fine.
        await page.getByRole('button', { name: 'Inshore' }).click();
        expect(await score(page)).toBeGreaterThan(70);
        await expect(page.locator('#alerts')).toBeHidden();
    });
});

test.describe('lure suggestions', () => {
    test('the season and the last month of water temperature are shown above the picks', async ({ page, app }) => {
        await app.open();
        const pattern = page.locator('#lurePattern');
        await expect(pattern.locator('.lure-kicker')).toHaveText('Bass · Spawn');
        await expect(pattern.locator('.lure-pattern-text')).toContainText('Bass are on beds');
        await expect(pattern.locator('.lure-also')).toHaveText('Walleye: summer · Trout: summer');
        await expect(pattern.locator('.lure-trend-head')).toHaveText('Water, last 30 days');
        await expect(pattern.locator('.spark')).toHaveAttribute('aria-label', /from 68\.0°F to 68\.0°F/);
        await expect(pattern.locator('.lure-trend-facts')).toHaveText('Steady over 14 days');
        await expect(pattern.locator('.lure-trend-source')).toHaveText('Daily means from the USGS sensor');
        // The default barometer is falling 0.16 inHg in 12 hours.
        await expect(pattern.locator('.lure-situation')).toHaveText('The barometer is falling ahead of a front, which often brings a burst of feeding.');
    });

    test('a cold snap, against a warmer normal, slows the picks down and says why', async ({ page, api, app }) => {
        api.stations = api.stations.map((station) => (station.id === 'USGS-05500001'
            ? { ...station, readings: { ...station.readings, '00010': 17 }, dailyFromC: 21, dailyLastThreeC: 17, normalC: 21 }
            : station));
        await app.open();
        const pattern = page.locator('#lurePattern');
        await expect(pattern.locator('.lure-trend-facts li')).toHaveText([
            'Down 7.2°F in 14 days', 'Cold snap: down 7.2°F in 3 days', '7.2°F colder than usual for the date',
        ]);
        await expect(pattern.locator('.lure-situation').first()).toContainText('The water has dropped fast');
        await expect(page.locator('.lure-adjust')).toHaveText(['A slower presentation suits the sudden chill.']); // said once, not on every pick
    });

    test('salt water reads the month from the tide station', async ({ page, api, app }) => {
        api.coast = { waterTempFromF: 84 };
        await openGalveston(app, 'Inshore');
        const pattern = page.locator('#lurePattern');
        await expect(pattern.locator('.lure-kicker')).toHaveText(/^Redfish · /);
        await expect(pattern.locator('.lure-trend-source')).toHaveText('Hourly readings from the NOAA tide station');
        await expect(pattern.locator('.lure-trend-facts li').first()).toHaveText(/^Down \d\.\d°F in 14 days$/);
    });

    test('with no sensor, the season comes from the date and the estimate', async ({ page, api, app }) => {
        api.stations = [];
        await app.open();
        await expect(page.locator('#lurePattern .lure-kicker')).toHaveText(/^Bass · /);
        await expect(page.locator('#lurePattern .lure-trend-source')).toHaveText(/^No sensor nearby/);
        expect(api.count('usgs', '/daily/')).toBe(0);
    });

    test('fresh water: picks for the local fish and the conditions, each with a plain Amazon search link', async ({ page, app }) => {
        await app.open();
        await expect(page.locator('#lureSummary')).toContainText('Picked for the fish found around here from where they are in their year');
        await expect(page.locator('#lureSummary')).toContainText('the light, wind and clarity right now.');
        // Mid-June, 68°F and warming, bright sun, a light breeze: bass are on their beds. "All species" takes the
        // leading fish of each group: two picks for bass, one each for walleye and trout.
        await expect(page.locator('.lure-target')).toHaveText(['For bass · Spawn', 'For bass · Spawn', 'For walleye · Summer', /^For trout/]);
        await expect(page.locator('.lure h3').first()).toHaveText('Soft-plastic lizard or creature bait');

        // In a browser tab the links carry the Associates tag, and say so beside the link and on the page.
        const link = page.locator('.lure-shop').first();
        await expect(link).toHaveText('Find it on Amazon (paid link)');
        await expect(link).toHaveAttribute('href', 'https://www.amazon.com/s?k=soft+plastic+lizard+bass&tag=howsthebite-20');
        await expect(link).toHaveAttribute('rel', 'sponsored nofollow noopener');
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(page.locator('#affiliateDisclosure')).toHaveText('As an Amazon Associate I earn from qualifying purchases.');
        for (const href of await page.locator('.lure-shop').evaluateAll((links) => links.map((a) => a.href))) {
            expect(href).toMatch(/^https:\/\/www\.amazon\.com\/s\?k=[^&]+&tag=howsthebite-20$/); // plain amazon.com address, nothing else
        }
        await expect(page.locator('#lureColour')).toContainText('found no effect on catch rate');
        await expect(page.locator('.lure-note')).toContainText('not based on measured catch rates');
    });

    test('in the installed app the links are left untagged, with no affiliate wording', async ({ page, app }) => {
        // Amazon bars affiliate links in software "installable by an end user"; an installed web app may count.
        await page.addInitScript(() => {
            const real = window.matchMedia.bind(window);
            window.matchMedia = (query) => (query.includes('display-mode: standalone')
                ? { matches: true, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
                : real(query));
        });
        await app.open();
        const link = page.locator('.lure-shop').first();
        await expect(link).toHaveText('Find it on Amazon');
        await expect(link).toHaveAttribute('href', 'https://www.amazon.com/s?k=soft+plastic+lizard+bass');
        await expect(link).toHaveAttribute('rel', 'nofollow noopener');
        await expect(page.locator('#affiliateDisclosure')).toBeHidden();
    });

    test('follow the species choice and the water', async ({ page, api, app }) => {
        api.stations = api.stations.map((station) => (station.id === 'USGS-05500001'
            ? { ...station, readings: { ...station.readings, '00010': 23.5 }, medianCfs: 400 } // 74°F, and running at three times normal
            : station));
        await app.open();
        await page.getByRole('button', { name: 'Bass & panfish' }).click();
        await expect(page.locator('.lure h3').first()).toHaveText('Large-blade spinnerbait'); // vibration for muddy water
        await expect(page.locator('#lureColour')).toContainText('bright, vivid colours');

        await page.getByRole('button', { name: 'Trout' }).click();
        await expect(page.locator('.lure')).toHaveCount(1);
        await expect(page.locator('.lure h3')).toHaveText('Give the trout a rest');
        await expect(page.locator('.lure-shop')).toHaveCount(0); // advice, not a product
    });

    test('salt water: suggestions follow the tide and the kind of fishing', async ({ page, app }) => {
        await openGalveston(app, 'Inshore');
        await expect(page.locator('#lureSummary')).toContainText('Picked for redfish & seatrout from where they are in their year');
        await expect(page.locator('#lureSummary')).toContainText('the light, tide and wind right now.');
        await expect(page.locator('.lure-target')).toHaveText([/^For redfish/, /^For redfish/, /^For speckled trout/, /^For flounder/]);
        await expect(page.locator('.lure h3').first()).toHaveText('Gold spoon, weedless in grass'); // the tide is running

        await page.getByRole('button', { name: 'Surf', exact: true }).click();
        await expect(page.locator('.lure-target')).toHaveText([/^For redfish/, /^For redfish/, /^For whiting/, /^For whiting/]);
        await expect(page.locator('.lure h3').first()).toHaveText('Cut mullet or crab on a fish-finder rig');
    });
});

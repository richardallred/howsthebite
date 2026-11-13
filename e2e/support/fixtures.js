// Shared Playwright fixtures for every spec:
//
//   api   – all external services answered from fixtures, with knobs for
//           overriding the scenario or making a service fail
//   page  – clock pinned to NOW; the test fails on any uncaught page error,
//           and on any request to a host that has no mock
//   app   – small helpers for the things most tests do

import { test as base, expect } from '@playwright/test';

import {
    BLANK_TILE, DEFAULT_POINTS, DEFAULT_SCORE, DEFAULT_SPECIES, DEFAULT_STATIONS, NOW, alertsResponse,
    continuousResponse, flowNormalsResponse, forecastResponse, gbifResponse, latestContinuousResponse,
    monitoringLocationsResponse, observationsResponse, photonResponse, pointResponse, stationsResponse,
} from './api-mocks.js';

export { DEFAULT_POINTS, DEFAULT_SCORE, NOW, expect };

const SERVICES = {
    nws: 'api.weather.gov',
    photon: 'photon.komoot.io',
    usgs: 'api.waterdata.usgs.gov',
    gbif: 'api.gbif.org',
    tiles: 'tile.openstreetmap.org',
};

const PROXY_PATH = /\/api\/usgs\/(?:([a-z-]+)\/items|statistics\/(observationNormals))$/;

export const test = base.extend({
    api: async ({ context }, use) => {
        const api = {
            weather: {}, // overrides merged into DEFAULT_WEATHER (see api-mocks.js)
            stations: DEFAULT_STATIONS,
            alerts: [], // NWS alerts in effect: { event, onsetHours, endsHours } relative to NOW
            species: DEFAULT_SPECIES, // fish recorded in the region: { name: recordCount }, names from FISH in api-mocks.js
            // false: the site is plain static hosting, so /api/usgs is a 404 and the app goes direct.
            // true:  the Cloudflare Pages proxy is deployed and answers /api/usgs.
            proxy: false,
            failures: {}, // service name ('nws', 'photon', 'usgs', 'gbif', 'proxy', 'tiles') -> HTTP status, or 'network'
            calls: [], // { service, url } for every mocked request
            unexpected: [], // requests to hosts without a mock
            fail(service, status = 500) { this.failures[service] = status; },
            restore(service) { delete this.failures[service]; },
            count(service, urlPart = '') {
                return this.calls.filter((call) => call.service === service && call.url.includes(urlPart)).length;
            },
        };

        const respond = (route, status, body) => route.fulfill({
            status,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify(body),
        });
        const json = (route, body) => respond(route, 200, body);

        /** Returns true if the route was answered with a configured failure. */
        const failed = (route, service) => {
            const failure = api.failures[service];
            if (!failure) return false;
            if (failure === 'network') route.abort('failed');
            else respond(route, failure, { error: { code: failure === 429 ? 'OVER_RATE_LIMIT' : 'ERROR' } });
            return true;
        };

        const usgs = (route, url, collection) => {
            if (collection === 'latest-continuous') return json(route, latestContinuousResponse(url, api.stations));
            if (collection === 'monitoring-locations') return json(route, monitoringLocationsResponse(url, api.stations));
            if (collection === 'continuous') return json(route, continuousResponse(url, api.stations));
            if (collection === 'observationNormals') return json(route, flowNormalsResponse(url, api.stations));
            api.unexpected.push(url.href);
            return route.abort('blockedbyclient');
        };

        // The same-origin USGS proxy. Mocked even when "not deployed" so the result is the
        // same whether the tests run against a plain static server or a Pages preview.
        await context.route((url) => PROXY_PATH.test(url.pathname), (route) => {
            const url = new URL(route.request().url());
            api.calls.push({ service: 'proxy', url: url.href });
            if (!api.proxy) return respond(route, 404, { error: 'Not found' });
            if (failed(route, 'proxy')) return undefined;
            const [, collection, statistic] = PROXY_PATH.exec(url.pathname);
            return usgs(route, url, collection ?? statistic);
        });

        await context.route((url) => url.hostname !== 'localhost', (route) => {
            const url = new URL(route.request().url());
            const service = Object.keys(SERVICES).find((name) => SERVICES[name] === url.hostname);
            if (!service) {
                api.unexpected.push(url.href);
                return route.abort('blockedbyclient');
            }
            api.calls.push({ service, url: url.href });
            if (failed(route, service)) return undefined;

            switch (service) {
                case 'nws':
                    if (url.pathname.startsWith('/points/')) {
                        if ({ ...api.weather }.outsideCoverage) return respond(route, 404, { title: 'Data Unavailable For Requested Point' });
                        return json(route, pointResponse(api.weather));
                    }
                    if (url.pathname.endsWith('/forecast')) return json(route, forecastResponse(api.weather));
                    if (url.pathname.endsWith('/stations')) return json(route, stationsResponse(api.weather));
                    if (url.pathname.endsWith('/observations')) return json(route, observationsResponse(url, api.weather));
                    if (url.pathname === '/alerts/active') return json(route, alertsResponse(api.alerts));
                    api.unexpected.push(url.href);
                    return route.abort('blockedbyclient');
                case 'photon': return json(route, photonResponse(url));
                case 'gbif': return json(route, gbifResponse(api.species));
                case 'tiles': return route.fulfill({ status: 200, contentType: 'image/png', body: BLANK_TILE });
                default: return usgs(route, url, /(?:collections\/([a-z-]+)\/items|statistics\/v0\/(observationNormals))$/.exec(url.pathname)?.slice(1).find(Boolean));
            }
        });

        await use(api);
        expect(api.unexpected, 'requests to hosts or endpoints that have no mock').toEqual([]);
    },

    page: async ({ page, api }, use) => { // eslint-disable-line no-unused-vars -- `api` must be installed first
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        // A Content-Security-Policy violation is a bug in either the page or the policy in _headers.
        page.on('console', (message) => {
            if (message.type() === 'error' && /Content Security Policy/i.test(message.text())) errors.push(message.text());
        });
        await page.clock.setFixedTime(NOW);
        await use(page);
        expect(errors, 'uncaught errors or CSP violations in the page').toEqual([]);
    },

    app: async ({ page }, use) => {
        const app = {
            /** Open the app and wait until conditions have loaded. */
            async open(path = '/') {
                await page.goto(path);
                await this.loaded();
            },
            async loaded() {
                await expect(page.locator('#updatedAt')).toHaveText(/^Updated/);
            },
            /** Type in the search box and pick the option whose text matches. */
            async search(query, optionText) {
                await page.locator('#searchInput').fill(query);
                await page.getByRole('option', { name: optionText }).click();
                await this.loaded();
            },
            factor(label) {
                return page.locator('.factor', { has: page.getByRole('heading', { name: label }) });
            },
            station(name) {
                return page.locator('.station', { hasText: name });
            },
        };
        await use(app);
    },
});

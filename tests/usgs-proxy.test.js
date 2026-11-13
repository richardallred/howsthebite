import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { onRequest, onRequestGet, upstreamUrl } from '../functions/api/usgs/[[path]].js';

// Minimal stand-ins for the two Cloudflare/runtime pieces the function touches.
let upstreamCalls;
let upstreamResponse;
let store;
const realFetch = globalThis.fetch;
const realNow = Date.now;
let now;

beforeEach(() => {
    upstreamCalls = [];
    upstreamResponse = () => new Response('{"features":[1]}', { status: 200, headers: { 'content-type': 'application/json' } });
    store = new Map();
    now = 1_800_000_000_000;
    Date.now = () => now;
    globalThis.fetch = async (url, init) => {
        upstreamCalls.push({ url: String(url), headers: init?.headers ?? {} });
        const response = upstreamResponse();
        if (response instanceof Error) throw response;
        return response;
    };
    globalThis.caches = {
        default: {
            async match(request) { return store.get(request.url)?.clone(); },
            async put(request, response) { store.set(request.url, response); },
        },
    };
});

afterEach(() => {
    globalThis.fetch = realFetch;
    Date.now = realNow;
    delete globalThis.caches;
});

const call = (path, query = '', env = { USGS_API_KEY: 'secret-key' }) => onRequestGet({
    request: new Request(`https://example.test/api/usgs/${path}${query}`),
    env,
    params: { path: path.split('/') },
});

test('forwards only the three collections the app uses', async () => {
    assert.equal((await call('latest-continuous/items', '?bbox=1,2,3,4')).status, 200);
    assert.equal((await call('daily/items')).status, 404);
    assert.equal((await call('latest-continuous')).status, 404);
    assert.equal((await call('latest-continuous/items/extra')).status, 404);
    assert.equal((await call('../../secrets/items')).status, 404);
    assert.equal(upstreamCalls.length, 1);
});

test('whitelists and normalises query parameters, and never forwards a client key', () => {
    const { url } = upstreamUrl(
        'https://x.test/api/usgs/continuous/items?time=PT48H&api_key=stolen&limit=999999&evil=1&monitoring_location_id=USGS-1&f=html',
        ['continuous', 'items'],
    );
    assert.equal(url.href,
        'https://api.waterdata.usgs.gov/ogcapi/v1/collections/continuous/items?f=json&limit=5000&monitoring_location_id=USGS-1&time=PT48H');
    assert.equal(upstreamUrl('https://x.test/a?limit=abc', ['continuous', 'items']), null);
    assert.equal(upstreamUrl(`https://x.test/a?id=${'x'.repeat(3000)}`, ['monitoring-locations', 'items']), null);
});

test('forwards the day-of-year flow statistics, for one station at a time, and caches them for a day', async () => {
    const { url, freshSeconds } = upstreamUrl(
        'https://x.test/api/usgs/statistics/observationNormals?monitoring_location_id=USGS-1&parameter_code=00060'
        + '&computation_type=percentile&start_date=06-15&end_date=06-15&api_key=stolen&page_size=100000',
        ['statistics', 'observationNormals'],
    );
    assert.equal(url.href,
        'https://api.waterdata.usgs.gov/statistics/v0/observationNormals?computation_type=percentile&end_date=06-15'
        + '&monitoring_location_id=USGS-1&parameter_code=00060&start_date=06-15');
    assert.equal(freshSeconds, 86400);

    assert.equal((await call('statistics/observationNormals', '?monitoring_location_id=USGS-1')).status, 200);
    assert.equal((await call('statistics/observationNormals', '?parameter_code=00060')).status, 404); // no station: would be the whole country
    assert.equal((await call('statistics/observationIntervals', '?monitoring_location_id=USGS-1')).status, 404);
    assert.equal((await call('statistics/observationNormals/extra', '?monitoring_location_id=USGS-1')).status, 404);
    assert.equal((await call('constructor/items')).status, 404);
    assert.equal(upstreamCalls.length, 1);
});

test('adds the server-side API key as a header, not in the URL', async () => {
    await call('latest-continuous/items', '?bbox=1,2,3,4');
    assert.equal(upstreamCalls[0].headers['x-api-key'], 'secret-key');
    assert.ok(!upstreamCalls[0].url.includes('secret-key'));

    await call('continuous/items', '?time=PT1H', {}); // works without a key too
    assert.equal(upstreamCalls[1].headers['x-api-key'], undefined);
});

test('serves repeat questions from the cache while fresh, then refetches', async () => {
    const first = await call('latest-continuous/items', '?bbox=1,2,3,4&parameter_code=00010');
    assert.equal(first.headers.get('x-cache'), 'miss');
    assert.equal(first.headers.get('cache-control'), 'no-store');
    assert.equal(await first.text(), '{"features":[1]}');

    // Same question with the parameters in another order is the same cache entry.
    const second = await call('latest-continuous/items', '?parameter_code=00010&bbox=1,2,3,4');
    assert.equal(second.headers.get('x-cache'), 'hit');
    assert.equal(await second.text(), '{"features":[1]}');
    assert.equal(upstreamCalls.length, 1);

    now += 11 * 60 * 1000; // past the 10-minute freshness window
    assert.equal((await call('latest-continuous/items', '?bbox=1,2,3,4&parameter_code=00010')).headers.get('x-cache'), 'miss');
    assert.equal(upstreamCalls.length, 2);
});

test('station names are cached for a day', async () => {
    await call('monitoring-locations/items', '?id=USGS-1');
    now += 23 * 60 * 60 * 1000;
    assert.equal((await call('monitoring-locations/items', '?id=USGS-1')).headers.get('x-cache'), 'hit');
});

test('falls back to the last good answer when USGS rate-limits or is down', async () => {
    await call('latest-continuous/items', '?bbox=1,2,3,4');
    now += 30 * 60 * 1000;

    upstreamResponse = () => new Response('{"error":"OVER_RATE_LIMIT"}', { status: 429 });
    const limited = await call('latest-continuous/items', '?bbox=1,2,3,4');
    assert.equal(limited.status, 200);
    assert.equal(limited.headers.get('x-cache'), 'stale');
    assert.equal(await limited.text(), '{"features":[1]}');

    upstreamResponse = () => new TypeError('network down');
    assert.equal((await call('latest-continuous/items', '?bbox=1,2,3,4')).headers.get('x-cache'), 'stale');
});

test('with nothing cached, upstream failures are reported honestly', async () => {
    upstreamResponse = () => new Response('{}', { status: 429 });
    const limited = await call('latest-continuous/items', '?bbox=9,9,9,9');
    assert.equal(limited.status, 429);
    assert.match((await limited.json()).error, /rate limit/);

    upstreamResponse = () => new Response('{}', { status: 503 });
    assert.equal((await call('latest-continuous/items', '?bbox=9,9,9,9')).status, 502);

    upstreamResponse = () => new TypeError('network down');
    assert.equal((await call('latest-continuous/items', '?bbox=9,9,9,9')).status, 502);

    // A bad request is passed through and never masked by stale data.
    upstreamResponse = () => new Response('{}', { status: 400 });
    assert.equal((await call('latest-continuous/items', '?bbox=nonsense')).status, 400);
});

test('failed answers are never cached', async () => {
    upstreamResponse = () => new Response('{}', { status: 500 });
    await call('continuous/items', '?time=PT1H');
    assert.equal(store.size, 0);
});

test('other methods are rejected', async () => {
    const response = onRequest();
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET');
});

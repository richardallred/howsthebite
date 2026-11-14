import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { onRequest, onRequestGet, upstreamUrl } from '../functions/api/nws/[[path]].js';
import { HttpError } from '../js/api/http.js';
import { nwsFetch, resetNwsRoute } from '../js/api/nws.js';

// Minimal stand-ins for the two Cloudflare/runtime pieces the function touches.
let upstreamCalls;
let upstreamResponse;
let store;
const realFetch = globalThis.fetch;
const realNow = Date.now;
let now;

beforeEach(() => {
    upstreamCalls = [];
    upstreamResponse = () => new Response('{"properties":{}}', { status: 200, headers: { 'content-type': 'application/geo+json' } });
    store = new Map();
    now = 1_800_000_000_000;
    Date.now = () => now;
    globalThis.fetch = async (url, init) => {
        upstreamCalls.push({ url: String(url), headers: init?.headers ?? {} });
        const response = upstreamResponse(String(url));
        if (response instanceof Error) throw response;
        return response;
    };
    globalThis.caches = {
        default: {
            async match(request) { return store.get(request.url)?.clone(); },
            async put(request, response) { store.set(request.url, response); },
        },
    };
    resetNwsRoute();
});

afterEach(() => {
    globalThis.fetch = realFetch;
    Date.now = realNow;
    delete globalThis.caches;
});

const call = (path, query = '') => onRequestGet({
    request: new Request(`https://example.test/api/nws/${path}${query}`),
    params: { path: path.split('/') },
});

// ---------------------------------------------------------------------------
// The function
// ---------------------------------------------------------------------------

test('forwards every request the app makes, and nothing else', async () => {
    const forwarded = [
        ['points/41.8781,-87.6298', ''],
        ['points/29.200000000000003,-81', ''], // an offset coordinate, not rounded
        ['gridpoints/LOT/76,73/forecast', '?units=us'],
        ['gridpoints/LOT/76,73/forecast/hourly', '?units=us'],
        ['gridpoints/LOT/76,73/stations', '?limit=25'],
        ['gridpoints/LOT/76,73', ''],
        ['stations/KORD/observations', '?start=2026-06-12T15:04:05Z&limit=500'],
        ['alerts/active', '?point=41.8781,-87.6298'],
        ['zones', '?type=coastal&point=29.2,-81'],
    ];
    for (const [path, query] of forwarded) assert.equal((await call(path, query)).status, 200, path);

    const refused = [
        ['', ''], ['points', ''], ['points/abc,def', ''], ['products/types', ''], ['stations/KORD', ''],
        ['gridpoints/LOT/76,73/forecast/extra', ''], ['alerts', ''], ['alerts/active', '?point=<script>'],
        ['stations/KORD/observations', '?start=yesterday'], ['gridpoints/LOT/76,73/forecast', '?units=furlongs'],
    ];
    const before = upstreamCalls.length;
    for (const [path, query] of refused) {
        const response = await call(path, query);
        assert.equal(response.status, 400, path + query); // never 404, which would read as "NWS has no data here"
    }
    assert.equal(upstreamCalls.length, before, 'refused requests never reach NWS');
});

test('asks NWS as itself, forwarding only the parameters the app uses', async () => {
    await call('gridpoints/LOT/76,73/stations', '?limit=25&cursor=abc&units=us');
    assert.equal(upstreamCalls[0].url, 'https://api.weather.gov/gridpoints/LOT/76,73/stations?limit=25');
    assert.match(upstreamCalls[0].headers['user-agent'], /howsthebite\.io/);
    assert.equal(upstreamCalls[0].headers.accept, 'application/geo+json');
});

test('observation requests in the same hour share one cached answer', async () => {
    assert.equal(
        upstreamUrl('https://example.test/api/nws/x?start=2026-06-12T15:04:05Z&limit=500', ['stations', 'KORD', 'observations']).url.href,
        'https://api.weather.gov/stations/KORD/observations?start=2026-06-12T15%3A00%3A00Z&limit=500',
    );
    assert.equal((await call('stations/KORD/observations', '?start=2026-06-12T15:04:05Z&limit=500')).headers.get('x-cache'), 'miss');
    assert.equal((await call('stations/KORD/observations', '?start=2026-06-12T15:44:59Z&limit=500')).headers.get('x-cache'), 'hit');
    assert.equal(upstreamCalls.length, 1);

    now += 6 * 60 * 1000; // past the five minutes a reading stays fresh
    assert.equal((await call('stations/KORD/observations', '?start=2026-06-12T15:50:00Z&limit=500')).headers.get('x-cache'), 'miss');
    assert.equal(upstreamCalls.length, 2);
});

test('answers from NWS are marked, including its 404 for a spot it does not cover', async () => {
    const ok = await call('points/41.8781,-87.6298');
    assert.equal(ok.headers.get('x-proxy'), 'nws');
    assert.equal(ok.headers.get('content-type'), 'application/geo+json');
    assert.equal(ok.headers.get('cache-control'), 'no-store');

    upstreamResponse = () => new Response('{"title":"Data Unavailable For Requested Point"}', { status: 404 });
    const missing = await call('points/10,10');
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get('x-proxy'), 'nws');
    assert.equal(store.size, 1, 'a 404 is not cached');
});

test('serves the last good answer when NWS fails, and 502 when there is none', async () => {
    await call('gridpoints/LOT/76,73/forecast', '?units=us');
    now += 20 * 60 * 1000; // stale
    upstreamResponse = () => new Response('{}', { status: 503 });
    const stale = await call('gridpoints/LOT/76,73/forecast', '?units=us');
    assert.equal(stale.status, 200);
    assert.equal(stale.headers.get('x-cache'), 'stale');

    upstreamResponse = () => new TypeError('network down');
    assert.equal((await call('gridpoints/LOT/1,1/forecast', '?units=us')).status, 502);
});

test('only GET is allowed', async () => {
    const response = onRequest();
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET');
});

// ---------------------------------------------------------------------------
// The app's side: js/api/nws.js
// ---------------------------------------------------------------------------

const POINT = 'https://api.weather.gov/points/41.8781,-87.6298';
const marked = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'application/json', 'x-proxy': 'nws' } });

test('the app calls NWS directly when it can', async () => {
    await nwsFetch(POINT);
    await nwsFetch(POINT);
    assert.deepEqual(upstreamCalls.map((entry) => entry.url), [POINT, POINT]);
    assert.equal(upstreamCalls[0].headers.Accept, 'application/geo+json');
});

test('when the direct request cannot connect, the same-origin route is used, and kept', async () => {
    upstreamResponse = (url) => (url.startsWith('https://api.weather.gov') ? new TypeError('Failed to fetch') : marked('{"via":"proxy"}'));
    assert.deepEqual(await nwsFetch(`${POINT}?a=1`), { via: 'proxy' });
    assert.deepEqual(await nwsFetch('https://api.weather.gov/alerts/active?point=1,2'), { via: 'proxy' });
    assert.deepEqual(upstreamCalls.map((entry) => entry.url), [
        `${POINT}?a=1`, '/api/nws/points/41.8781,-87.6298?a=1',
        '/api/nws/alerts/active?point=1,2', // no second attempt at the blocked address
    ]);
});

test("NWS's own 404, relayed, is reported as a 404", async () => {
    upstreamResponse = (url) => (url.startsWith('https://api.weather.gov') ? new TypeError('Failed to fetch') : marked('{}', 404));
    await assert.rejects(nwsFetch(POINT), (error) => error instanceof HttpError && error.status === 404);
});

test('where there is no same-origin route, the direct failure is reported and it is not asked again', async () => {
    upstreamResponse = (url) => (url.startsWith('https://api.weather.gov')
        ? new TypeError('Failed to fetch')
        : new Response('<!DOCTYPE html><title>Page not found</title>', { status: 404, headers: { 'content-type': 'text/html' } }));
    await assert.rejects(nwsFetch(POINT), TypeError);
    await assert.rejects(nwsFetch(POINT), TypeError);
    assert.deepEqual(upstreamCalls.map((entry) => entry.url), [POINT, '/api/nws/points/41.8781,-87.6298', POINT]);
});

test('an HTTP error or a timeout from NWS is not retried by the other route', async () => {
    upstreamResponse = () => new Response('{}', { status: 503 });
    await assert.rejects(nwsFetch(POINT), (error) => error instanceof HttpError && error.status === 503);
    upstreamResponse = () => new DOMException('The request timed out', 'TimeoutError');
    await assert.rejects(nwsFetch(POINT), { name: 'TimeoutError' });
    assert.deepEqual(upstreamCalls.map((entry) => entry.url), [POINT, POINT]);
});

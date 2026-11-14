import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { nearestReading, onRequest, onRequestGet, upstreamUrl } from '../functions/api/sst.js';

let upstreamCalls;
let upstreamResponse;
let store;
const realFetch = globalThis.fetch;
const realNow = Date.now;
let now;

// A box off Daytona Beach as the satellite product returns it: land cells are null.
const table = {
    columnNames: ['time', 'latitude', 'longitude', 'analysed_sst'],
    rows: [
        ['2026-11-12T09:00:00Z', 29.2, -81.05, null],
        ['2026-11-12T09:00:00Z', 29.2, -81.0, null],
        ['2026-11-12T09:00:00Z', 29.2, -80.96, 25.349],
        ['2026-11-12T09:00:00Z', 29.2, -80.9, 25.9],
    ],
};

beforeEach(() => {
    upstreamCalls = [];
    upstreamResponse = () => new Response(JSON.stringify({ table }), { status: 200 });
    store = new Map();
    now = 1_800_000_000_000;
    Date.now = () => now;
    globalThis.fetch = async (url) => {
        upstreamCalls.push(String(url));
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

const call = (query) => onRequestGet({ request: new Request(`https://example.test/api/sst${query}`) });

test('asks for a small box on a fixed grid, so nearby visitors share one answer', () => {
    const a = upstreamUrl('https://x.test/api/sst?lat=29.21&lon=-81.02');
    const b = upstreamUrl('https://x.test/api/sst?lat=29.19&lon=-81.01&anything=else');
    assert.equal(a.url, b.url);
    assert.equal(a.url, 'https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41.json?analysed_sst[(last)][(29.14):(29.26)][(-81.06):(-80.94)]');
    assert.equal(upstreamUrl('https://x.test/api/sst?lat=abc&lon=1'), null);
    assert.equal(upstreamUrl('https://x.test/api/sst?lat=95&lon=1'), null);
    assert.equal(upstreamUrl('https://x.test/api/sst'), null);
});

test('uses the nearest cell that has water, in Fahrenheit', () => {
    assert.deepEqual(nearestReading(table, 29.2, -81.0), { tempF: 77.6, time: Date.parse('2026-11-12T09:00:00Z'), lat: 29.2, lon: -80.96 });
    assert.equal(nearestReading({ rows: table.rows.slice(0, 2) }, 29.2, -81.0), null); // all land
    assert.equal(nearestReading(undefined, 29.2, -81.0), null);
});

test('with days, asks for the last 30 days and answers with the chosen cell\'s series', async () => {
    const a = upstreamUrl('https://x.test/api/sst?lat=29.21&lon=-81.02&days=30');
    assert.equal(a.url, 'https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41.json?analysed_sst[last-29:1:last][(29.14):(29.26)][(-81.06):(-80.94)]');
    assert.equal(upstreamUrl('https://x.test/api/sst?lat=29.21&lon=-81.02&days=7').url, a.url); // one cache entry for any history
    assert.equal(upstreamUrl('https://x.test/api/sst?lat=29.21&lon=-81.02&days=junk').history, false);

    // Two days of the same box: the reading is the latest day's nearest water cell, and the series is that cell.
    const history = {
        rows: [
            ['2026-11-11T09:00:00Z', 29.2, -81.0, null],
            ['2026-11-11T09:00:00Z', 29.2, -80.96, 26.0],
            ['2026-11-11T09:00:00Z', 29.2, -80.9, 26.5],
            ...table.rows,
        ],
    };
    const reading = nearestReading(history, 29.2, -81.0, { history: true });
    assert.equal(reading.tempF, 77.6);
    assert.deepEqual(reading.series, [
        { t: Date.parse('2026-11-11T09:00:00Z'), tempF: 78.8 },
        { t: Date.parse('2026-11-12T09:00:00Z'), tempF: 77.6 },
    ]);
    assert.equal(nearestReading(history, 29.2, -81.0).series, undefined);

    upstreamResponse = () => new Response(JSON.stringify({ table: history }), { status: 200 });
    const body = await (await call('?lat=29.21&lon=-81.02&days=30')).json();
    assert.equal(body.series.length, 2);
});

test('answers with the reading and serves repeats from the cache', async () => {
    const first = await call('?lat=29.21&lon=-81.02');
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('x-cache'), 'miss');
    assert.equal((await first.json()).tempF, 77.6);

    const second = await call('?lat=29.20&lon=-81.00');
    assert.equal(second.headers.get('x-cache'), 'hit');
    assert.equal(upstreamCalls.length, 1);

    now += 7 * 3600 * 1000; // past six hours: refetch
    assert.equal((await call('?lat=29.21&lon=-81.02')).headers.get('x-cache'), 'miss');
    assert.equal(upstreamCalls.length, 2);
});

test('a spot with no water nearby gets a null reading, not an error', async () => {
    upstreamResponse = () => new Response(JSON.stringify({ table: { rows: table.rows.slice(0, 2) } }), { status: 200 });
    const response = await call('?lat=29.21&lon=-81.02');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { tempF: null, time: null });
});

test('an outage falls back to the last reading, and without one says so', async () => {
    await call('?lat=29.21&lon=-81.02');
    now += 7 * 3600 * 1000;
    upstreamResponse = () => new Response('busy', { status: 503 });
    const stale = await call('?lat=29.21&lon=-81.02');
    assert.equal(stale.headers.get('x-cache'), 'stale');
    assert.equal((await stale.json()).tempF, 77.6);

    upstreamResponse = () => new Error('network down');
    assert.equal((await call('?lat=40.00&lon=-70.00')).status, 502);
});

test('bad requests and other methods are rejected', async () => {
    assert.equal((await call('?lat=1')).status, 400);
    assert.equal(upstreamCalls.length, 0);
    assert.equal(onRequest().status, 405);
});

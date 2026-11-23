import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import {
    DEPTH_BANDS, DEPTH_SOURCES, chartBox, depthBand, depthBox, depthOnChart, depthOnLake, depthRange, depthUrl, findDepth, pickLevels, shapeContours, shoreCoverage, snapBox, sourcesFor,
} from '../js/core/depth.js';
import { boxFor, onRequest, onRequestGet } from '../functions/api/depth.js';
import { targetPlan } from '../js/core/target-zones.js';

const MICHIGAN = DEPTH_SOURCES.find((source) => source.id === 'mi-dnr');
const NOAA = DEPTH_SOURCES.find((source) => source.id === 'noaa-enc');
const HOUGHTON = [-84.86, 44.27, -84.62, 44.41]; // Houghton Lake, Michigan
const NORMAN = [-81.05, 35.45, -80.85, 35.7]; // Lake Norman, North Carolina: no state source

const line = (value, coordinates, field = 'MinDepth') => ({ type: 'Feature', properties: { [field]: value }, geometry: { type: 'LineString', coordinates } });
/** A closed square contour, as [lon, lat], `half` degrees either side of a centre. */
const square = (lon, lat, half) => [[lon - half, lat - half], [lon + half, lat - half], [lon + half, lat + half], [lon - half, lat + half], [lon - half, lat - half]];
const collection = (features, extra = {}) => ({ type: 'FeatureCollection', features, ...extra });

// ----- Boxes ---------------------------------------------------------------------------------

test('snapBox snaps outward to a grid, so everyone on a lake asks the same question', () => {
    assert.deepEqual(snapBox([-84.8512, 44.2731, -84.6288, 44.4012]), [-84.86, 44.27, -84.62, 44.41]);
    assert.deepEqual(snapBox([-84.86, 44.27, -84.62, 44.41]), [-84.86, 44.27, -84.62, 44.41]);
});

test('snapBox refuses what is not a lake-sized box in the US', () => {
    assert.equal(snapBox([-84, 44, -85, 45]), null, 'west of east');
    assert.equal(snapBox([-88, 42, -85, 45]), null, 'the size of Lake Michigan');
    assert.equal(snapBox([2.2, 48.8, 2.4, 48.9]), null, 'Paris');
    assert.equal(snapBox([-84, 44, -83.9, Number.NaN]), null);
    assert.equal(snapBox('-84,44,-83,45'), null);
});

test('depthBox is the bounds of a lake\'s shore, islands aside', () => {
    const lake = {
        id: 'nhd/1',
        rings: [
            { outer: true, coords: [[44.301, -84.801], [44.301, -84.652], [44.398, -84.652], [44.398, -84.801], [44.301, -84.801]] },
            { outer: false, coords: [[44.35, -84.7], [44.35, -84.69], [44.36, -84.69], [44.35, -84.7]] },
        ],
    };
    assert.deepEqual(depthBox(lake), [-84.81, 44.3, -84.65, 44.4]);
    assert.equal(depthBox({ rings: [] }), null);
    assert.equal(depthBox(null), null);
});

test('a state\'s own survey is preferred to NOAA\'s charts, which cover everywhere', () => {
    assert.deepEqual(sourcesFor(HOUGHTON).map((source) => source.id), ['mi-dnr', 'noaa-enc']);
    assert.deepEqual(sourcesFor(NORMAN).map((source) => source.id), ['noaa-enc']);
});

// ----- Asking --------------------------------------------------------------------------------

test('depthUrl asks for the lines in the box, simplified by the server and a page at a time', () => {
    const url = new URL(depthUrl(MICHIGAN.layers[0], HOUGHTON, 2000));
    assert.equal(url.origin, 'https://services3.arcgis.com');
    assert.equal(url.searchParams.get('geometry'), '-84.86,44.27,-84.62,44.41');
    assert.equal(url.searchParams.get('outFields'), 'MinDepth');
    assert.equal(url.searchParams.get('f'), 'geojson');
    assert.equal(url.searchParams.get('resultOffset'), '2000');
    assert.equal(url.searchParams.get('resultRecordCount'), '2000');
    assert.equal(url.searchParams.get('orderByFields'), 'OBJECTID');
    // NOAA's approach charts have no OBJECTID, and refuse a query ordered by one.
    assert.equal(new URL(depthUrl(NOAA.layers[1], HOUGHTON)).searchParams.get('orderByFields'), 'APPROACH.DEPCNT.FID');
    assert.equal(url.searchParams.get('maxAllowableOffset'), '0.00008');
    // A bigger box is simplified more, a pond less, within limits.
    assert.equal(new URL(depthUrl(MICHIGAN.layers[0], [-85, 44, -83.6, 45.4])).searchParams.get('maxAllowableOffset'), '0.00040');
    assert.equal(new URL(depthUrl(MICHIGAN.layers[0], [-84.71, 44.3, -84.7, 44.31])).searchParams.get('maxAllowableOffset'), '0.00003');
});

// ----- Shaping -------------------------------------------------------------------------------

test('shapeContours groups lines by depth in feet, shallowest first, as [lat, lon]', () => {
    const contours = shapeContours([
        line(20, square(-84.74, 44.34, 0.01)),
        line(10, square(-84.74, 44.34, 0.03)),
        { type: 'Feature', properties: { MinDepth: 10 }, geometry: { type: 'MultiLineString', coordinates: [square(-84.7, 44.38, 0.005)] } },
    ], MICHIGAN, MICHIGAN.layers[0], HOUGHTON);
    assert.deepEqual(contours.map((c) => c.ft), [10, 20]);
    assert.equal(contours[0].lines.length, 2);
    assert.deepEqual(contours[1].lines[0][0], [44.33, -84.75]);
});

test('shapeContours leaves out the shoreline, nulls and values that cannot be depths', () => {
    const contours = shapeContours([
        line(0, square(-84.74, 44.34, 0.04)),
        line(null, square(-84.74, 44.34, 0.03)),
        line(-4, square(-84.74, 44.34, 0.02)),
        line(6200, square(-84.74, 44.34, 0.02)), // an elevation in the depth field
        line(15, square(-84.74, 44.34, 0.01)),
        { type: 'Feature', properties: { MinDepth: 5 }, geometry: null },
    ], MICHIGAN, MICHIGAN.layers[0], HOUGHTON);
    assert.deepEqual(contours.map((c) => c.ft), [15]);
});

test('NOAA\'s metres become whole feet', () => {
    const layer = NOAA.layers[0];
    const contours = shapeContours([line(1.8, square(-76.45, 38.96, 0.01), 'VALDCO'), line(9.1, square(-76.45, 38.96, 0.005), 'VALDCO')],
        NOAA, layer, [-76.5, 38.93, -76.4, 39]);
    assert.deepEqual(contours.map((c) => c.ft), [6, 30]);
});

test('shapeContours keeps only the part of a line inside the box', () => {
    // A contour that runs on along the coast, far outside the box.
    const long = Array.from({ length: 41 }, (_, i) => [-85.2 + i * 0.02, 44.34]);
    const [contour] = shapeContours([line(30, long)], MICHIGAN, MICHIGAN.layers[0], HOUGHTON);
    const lons = contour.lines.flat().map((p) => p[1]);
    assert.ok(Math.min(...lons) >= -84.9 && Math.max(...lons) <= -84.58, `${Math.min(...lons)}..${Math.max(...lons)}`);
    assert.ok(lons.length >= 12);
});

test('shapeContours thins a dense survey to what a phone should be sent', () => {
    // 40 wiggly rings of 600 points each.
    const ring = (radius) => Array.from({ length: 601 }, (_, i) => {
        const a = (i / 600) * 2 * Math.PI;
        const r = radius * (1 + 0.02 * Math.sin(a * 40));
        return [-84.74 + r * Math.cos(a), 44.34 + r * 0.7 * Math.sin(a)];
    });
    const features = Array.from({ length: 40 }, (_, i) => line(5 + (i % 8) * 5, ring(0.01 + i * 0.002)));
    const contours = shapeContours(features, MICHIGAN, MICHIGAN.layers[0], HOUGHTON);
    const points = contours.reduce((sum, c) => sum + c.lines.reduce((s, l) => s + l.length, 0), 0);
    assert.ok(points <= 6000, `${points} points`);
    assert.ok(points > 1500, `${points} points: thinned too far`);
    assert.equal(contours.length, 8);
    assert.equal(contours.reduce((sum, c) => sum + c.lines.length, 0), 40, 'every ring is still there');
});

test('pickLevels thins one-foot contours to a readable step', () => {
    assert.deepEqual(pickLevels([10, 5, 20, 5]), [5, 10, 20]);
    const everyFoot = Array.from({ length: 60 }, (_, i) => i + 1);
    assert.deepEqual(pickLevels(everyFoot), [1, 2, 4, 6, 8, 10, 20, 30, 40, 50, 60]);
    const deep = Array.from({ length: 150 }, (_, i) => (i + 1) * 2);
    assert.deepEqual(pickLevels(deep), [2, 8, 10, 20, 30, 40, 50, 100, 150, 200, 250, 300], 'the shallows keep a finer step');
    assert.deepEqual(pickLevels([5, 10, 15, 20, 25, 30, 35, 40, 50, 60, 70, 80, 90, 100, 110, 120]), [5, 10, 15, 20, 40, 60, 80, 100, 120]);
    // Depths no step fits are still cut down, keeping the shallowest and the deepest.
    const odd = [1, 3, 7, 9, 11, 13, 17, 19, 21, 23, 27, 29, 31, 33, 37];
    const picked = pickLevels(odd);
    assert.equal(picked.length, 12);
    assert.equal(new Set(picked).size, 12);
    assert.equal(picked[0], 1);
    assert.equal(picked.at(-1), 37);
});

// ----- Finding -------------------------------------------------------------------------------

test('findDepth takes the first source with contours and says whose they are', async () => {
    const asked = [];
    const get = async (url) => {
        asked.push(new URL(url).hostname);
        return collection([line(10, square(-84.74, 44.34, 0.03)), line(20, square(-84.74, 44.34, 0.01))]);
    };
    const { depth } = await findDepth(HOUGHTON, { get });
    assert.equal(depth.source, 'mi-dnr');
    assert.equal(depth.credit, 'Michigan DNR');
    assert.match(depth.link, /^https:\/\//);
    assert.deepEqual(depth.contours.map((c) => c.ft), [10, 20]);
    assert.deepEqual(asked, ['services3.arcgis.com'], 'NOAA was not needed');
});

test('findDepth falls through to NOAA, and from its harbour charts to its approach charts', async () => {
    const asked = [];
    const get = async (url) => {
        asked.push(url);
        return collection(url.includes('enc_approach') ? [line(6.1, square(-84.74, 44.34, 0.02), 'VALDCO')] : []);
    };
    const { depth } = await findDepth(HOUGHTON, { get });
    assert.equal(depth.source, 'noaa-enc');
    assert.deepEqual(depth.contours.map((c) => c.ft), [20]);
    assert.equal(asked.length, 3);
    assert.match(asked[1], /enc_harbour/);
});

test('findDepth answers null where no source has the water', async () => {
    assert.deepEqual(await findDepth(NORMAN, { get: async () => collection([]) }), { depth: null });
});

test('findDepth pages through a big answer', async () => {
    const offsets = [];
    const get = async (url) => {
        const offset = Number(new URL(url).searchParams.get('resultOffset'));
        offsets.push(offset);
        return collection([line(10 + offset / 100, square(-84.74, 44.34, 0.01 + offset / 1e5))], offset < 4000 ? { exceededTransferLimit: true } : {});
    };
    const { depth } = await findDepth(HOUGHTON, { get });
    assert.deepEqual(offsets, [0, 2000, 4000]);
    assert.deepEqual(depth.contours.map((c) => c.ft), [10, 30, 50]);
});

test('findDepth uses another source when one is down, but never calls an outage "no depth map"', async () => {
    const noaaOnly = async (url) => {
        if (url.includes('arcgis.com')) throw new Error('down');
        return collection([line(3.6, square(-84.74, 44.34, 0.02), 'VALDCO')]);
    };
    assert.equal((await findDepth(HOUGHTON, { get: noaaOnly })).depth.source, 'noaa-enc');

    const michiganDown = async (url) => {
        if (url.includes('arcgis.com')) throw new Error('down');
        return collection([]);
    };
    await assert.rejects(findDepth(HOUGHTON, { get: michiganDown }), /down/);
    await assert.rejects(findDepth(HOUGHTON, { get: async () => ({ error: { message: 'Invalid query' } }) }), /Invalid query/);
});

// ----- On the lake ---------------------------------------------------------------------------

test('depthOnLake keeps this lake\'s contours and drops its neighbours\' and the sea\'s', () => {
    const shore = square(-84.74, 44.34, 0.05).map(([lon, lat]) => [lat, lon]);
    const island = square(-84.74, 44.34, 0.004).map(([lon, lat]) => [lat, lon]);
    const lake = { id: 'nhd/1', rings: [{ outer: true, coords: shore }, { outer: false, coords: island }] };
    const latLon = (ring) => ring.map(([lon, lat]) => [lat, lon]);
    const depth = {
        source: 'mi-dnr',
        credit: 'Michigan DNR',
        link: 'https://example.test',
        contours: [
            { ft: 10, lines: [latLon(square(-84.74, 44.34, 0.045)), latLon(square(-84.6, 44.34, 0.02))] }, // the second is the lake next door
            { ft: 20, lines: [latLon(square(-84.6, 44.34, 0.01))] },
        ],
    };
    const onLake = depthOnLake(depth, lake);
    assert.deepEqual(onLake.contours.map((c) => [c.ft, c.lines.length]), [[10, 1]]);
    assert.equal(onLake.credit, 'Michigan DNR');
    assert.equal(onLake.partial, false);
    assert.equal(depthOnLake({ ...depth, contours: [depth.contours[1]] }, lake), null);
    assert.equal(depthOnLake(null, lake), null);
});

test('depthOnLake chooses the depths to draw from the lake\'s own, not its neighbours\'', () => {
    const shore = square(-84.74, 44.34, 0.05).map(([lon, lat]) => [lat, lon]);
    const lake = { id: 'nhd/1', rings: [{ outer: true, coords: shore }] };
    const latLon = (ring) => ring.map(([lon, lat]) => [lat, lon]);
    // The lake has a line every 5 ft to 100; the pond next door has one at every odd foot.
    const depth = {
        source: 'mi-dnr',
        contours: [
            ...Array.from({ length: 20 }, (_, i) => ({ ft: (i + 1) * 5, lines: [latLon(square(-84.74, 44.34, 0.046 - i * 0.002))] })),
            ...Array.from({ length: 15 }, (_, i) => ({ ft: i * 2 + 1, lines: [latLon(square(-84.6, 44.34, 0.02 - i * 0.001))] })),
        ].sort((a, b) => a.ft - b.ft),
    };
    assert.deepEqual(depthOnLake(depth, lake).contours.map((c) => c.ft), [5, 10, 15, 20, 40, 60, 80, 100]);
});

test('a chart of one corner of a lake is not passed off as its depth map', () => {
    // A lake 8 km by 4 km, its shore drawn every 100 m or so.
    const side = (from, to, n) => Array.from({ length: n }, (_, i) => [from[0] + ((to[0] - from[0]) * i) / n, from[1] + ((to[1] - from[1]) * i) / n]);
    const [s, n, w, e] = [44.3, 44.336, -84.8, -84.7];
    const shore = [...side([s, w], [s, e], 80), ...side([s, e], [n, e], 40), ...side([n, e], [n, w], 80), ...side([n, w], [s, w], 40), [s, w]];
    const lake = { id: 'nhd/2', rings: [{ outer: true, coords: shore }] };
    const ringAt = (west, east, inset) => [...side([s + inset, west], [s + inset, east], 40), ...side([s + inset, east], [n - inset, east], 20),
        ...side([n - inset, east], [n - inset, west], 40), ...side([n - inset, west], [s + inset, west], 20), [s + inset, west]];
    const depth = (lines) => ({ source: 'noaa-enc', credit: 'NOAA charts', link: 'https://example.test', contours: [{ ft: 12, lines }] });

    const whole = depthOnLake(depth([ringAt(w + 0.003, e - 0.003, 0.002)]), lake);
    assert.equal(whole.partial, false);
    assert.ok(shoreCoverage(whole.contours, lake) > 0.95);

    const half = depthOnLake(depth([ringAt(w + 0.003, -84.75, 0.002)]), lake); // the western half, as on Lake Tahoe
    assert.equal(half.partial, true);

    assert.equal(depthOnLake(depth([ringAt(e - 0.008, e - 0.003, 0.012)]), lake), null, 'a channel at the east end, as on Oneida Lake');
});

// ----- Salt water: the chart around a place ---------------------------------------------------

test('chartBox is the water around a place, on a grid, as wide on the ground at any latitude', () => {
    assert.deepEqual(chartBox(29.3013, -94.7977), [-94.87, 29.26, -94.73, 29.34]); // Galveston
    assert.deepEqual(chartBox(29.309, -94.805), chartBox(29.3013, -94.7977), 'people fishing the same water share the box');
    const anchorage = chartBox(61.2, -149.9);
    assert.deepEqual(anchorage, [-150.02, 61.16, -149.78, 61.24]); // degrees of longitude are half as long up there
    assert.equal(chartBox(Number.NaN, -94.8), null);
    assert.equal(chartBox(48.85, 2.35), null, 'Paris');
});

test('salt water is asked of the charts only, never of a state\'s lake survey', () => {
    assert.deepEqual(sourcesFor(HOUGHTON, { charts: true }).map((source) => source.id), ['noaa-enc']);
});

test('a chart keeps the low-water line that a lake\'s contours leave to its outline', async () => {
    const galveston = chartBox(29.3, -94.8);
    const get = async (url) => collection(url.includes('enc_harbour')
        ? [line(0, square(-94.8, 29.3, 0.02), 'VALDCO'), line(1.8, square(-94.8, 29.3, 0.01), 'VALDCO'), line(-0.5, square(-94.8, 29.3, 0.03), 'VALDCO')]
        : []);
    const chart = await findDepth(galveston, { get, charts: true });
    assert.equal(chart.depth.source, 'noaa-enc');
    assert.deepEqual(chart.depth.contours.map((c) => c.ft), [0, 6], 'the drying bank (a negative) is still left out');
    assert.equal(depthRange(chart.depth), '0 to 6 ft');
    assert.equal(depthBand(0), 1);

    const lake = await findDepth(galveston, { get });
    assert.deepEqual(lake.depth.contours.map((c) => c.ft), [6]);
});

test('depthOnChart thins a chart to the depths worth drawing', () => {
    const contours = Array.from({ length: 31 }, (_, ft) => ({ ft, lines: [[[29.3, -94.8], [29.31, -94.79]]] }));
    assert.deepEqual(depthOnChart({ source: 'noaa-enc', contours }).contours.map((c) => c.ft), [0, 1, 2, 3, 4, 5, 10, 15, 20, 25, 30]);
    assert.equal(depthOnChart({ source: 'noaa-enc', contours: [] }), null);
    assert.equal(depthOnChart(null), null);
});

// ----- Drawing -------------------------------------------------------------------------------

test('depth bands run from the shallows to deep water', () => {
    assert.deepEqual([3, 5, 6, 10, 15, 40, 41, 80, 300].map(depthBand), [1, 1, 2, 2, 3, 4, 5, 5, 6]);
    assert.equal(DEPTH_BANDS.at(-1).label, '80+');
});

test('depthRange says how deep the lines go', () => {
    assert.equal(depthRange({ contours: [{ ft: 5 }, { ft: 60 }, { ft: 20 }] }), '5 to 60 ft');
    assert.equal(depthRange({ contours: [{ ft: 20 }] }), '20 ft');
    assert.equal(depthRange(null), '');
});

test('the note about deep structure points to the depth lines when the map has them', () => {
    assert.match(targetPlan({ phaseId: 'summer', hasDepth: true }).depthNote, /depth lines bunch together/);
    assert.match(targetPlan({ phaseId: 'summer' }).depthNote, /doesn't have here/);
    assert.equal(targetPlan({ phaseId: 'spawn', hasDepth: true }).depthNote, null);
});

// ----- The proxy -----------------------------------------------------------------------------

let upstreamCalls;
let upstreamResponse;
let store;
const realFetch = globalThis.fetch;
const realNow = Date.now;
let now;

beforeEach(() => {
    upstreamCalls = [];
    upstreamResponse = () => new Response(JSON.stringify(collection([line(10, square(-84.74, 44.34, 0.03))])), { status: 200 });
    store = new Map();
    now = 1_800_000_000_000;
    Date.now = () => now;
    globalThis.fetch = async (url) => {
        upstreamCalls.push(String(url));
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
});

afterEach(() => {
    globalThis.fetch = realFetch;
    Date.now = realNow;
    delete globalThis.caches;
});

const call = (query) => onRequestGet({ request: new Request(`https://example.test/api/depth${query}`) });

test('the proxy reads a box and snaps it', () => {
    assert.deepEqual(boxFor('https://x.test/api/depth?box=-84.8512,44.2731,-84.6288,44.4012'), [-84.86, 44.27, -84.62, 44.41]);
    assert.equal(boxFor('https://x.test/api/depth?box=-84.85,44.27,-84.62'), null);
    assert.equal(boxFor('https://x.test/api/depth?box=a,b,c,d'), null);
    assert.equal(boxFor('https://x.test/api/depth'), null);
});

test('the proxy answers with contours and keeps them for the next visitor on the lake', async () => {
    const first = await call('?box=-84.8512,44.2731,-84.6288,44.4012');
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('x-cache'), 'miss');
    const { depth } = await first.json();
    assert.equal(depth.source, 'mi-dnr');
    assert.deepEqual(depth.contours.map((c) => c.ft), [10]);
    assert.equal(upstreamCalls.length, 1);

    const second = await call('?box=-84.855,44.271,-84.621,44.409'); // elsewhere on the same lake's outline
    assert.equal(second.headers.get('x-cache'), 'hit');
    assert.equal(upstreamCalls.length, 1);
    assert.deepEqual((await second.json()).depth.contours.map((c) => c.ft), [10]);
});

test('the proxy remembers that a lake has no depth map, too', async () => {
    upstreamResponse = () => new Response(JSON.stringify(collection([])), { status: 200 });
    const first = await call('?box=-81.05,35.45,-80.85,35.7');
    assert.deepEqual(await first.json(), { depth: null });
    const calls = upstreamCalls.length;
    assert.equal((await call('?box=-81.05,35.45,-80.85,35.7')).headers.get('x-cache'), 'hit');
    assert.equal(upstreamCalls.length, calls);
});

test('the proxy serves the last good answer through an outage, and says so when it has none', async () => {
    await call('?box=-84.86,44.27,-84.62,44.41');
    now += 31 * 24 * 60 * 60 * 1000; // past fresh
    upstreamResponse = () => new Response('busy', { status: 503 });
    const stale = await call('?box=-84.86,44.27,-84.62,44.41');
    assert.equal(stale.status, 200);
    assert.equal(stale.headers.get('x-cache'), 'stale');

    const none = await call('?box=-85.5,44.7,-85.3,44.8');
    assert.equal(none.status, 502);
    assert.equal(store.size, 1, 'a failure is not cached');
});

test('the proxy keeps a chart of salt water apart from a lake\'s contours in the same box', async () => {
    upstreamResponse = (url) => new Response(JSON.stringify(collection(url.includes('encdirect')
        ? [line(0, square(-94.8, 29.3, 0.02), 'VALDCO'), line(1.8, square(-94.8, 29.3, 0.01), 'VALDCO')] : [])), { status: 200 });
    const chart = await call('?box=-94.87,29.26,-94.73,29.34&charts=1');
    assert.equal(chart.headers.get('x-cache'), 'miss');
    assert.deepEqual((await chart.json()).depth.contours.map((c) => c.ft), [0, 6]);
    assert.ok(upstreamCalls.every((url) => url.includes('encdirect.noaa.gov')));

    const lake = await call('?box=-94.87,29.26,-94.73,29.34');
    assert.equal(lake.headers.get('x-cache'), 'miss', 'not the chart\'s answer');
    assert.deepEqual((await lake.json()).depth.contours.map((c) => c.ft), [6]);
    assert.equal((await call('?box=-94.87,29.26,-94.73,29.34&charts=1')).headers.get('x-cache'), 'hit');
});

test('the proxy refuses a bad box and anything but GET', async () => {
    assert.equal((await call('?box=1,2,3')).status, 400);
    assert.equal((await call('?box=-95,30,-80,45')).status, 400);
    assert.equal(upstreamCalls.length, 0);
    const post = onRequest();
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('allow'), 'GET');
});

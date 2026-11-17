import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { findLake, joinRings, lakeCandidates, lakeFromGeometry, lakeFromNhd, lookupQuery, nhdUrl, simplifyRing, tooBig } from '../js/core/lake-shape.js';
import { compassName, locateZones, targetPlan } from '../js/core/target-zones.js';
import { onRequestGet, pointFor } from '../functions/api/lake.js';

// A lake drawn in metres around 35°N and turned into [lat, lon].
const LAT0 = 35;
const LON0 = -80;
const kx = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const toLatLon = ([x, y]) => [LAT0 + y / 110540, LON0 + x / kx];
const ring = (xy, outer = true) => ({ outer, coords: [...xy, xy[0]].map(toLatLon) });
const node = ([lat, lon]) => ({ lat, lon });

// 2 km square.
const SQUARE = [[0, 0], [2000, 0], [2000, 2000], [0, 2000]];
// 3 km by 2 km, with a cove reaching 1.2 km back into the land south of it and a point
// reaching 1 km into the water from the north shore.
const SHAPED = [
    [0, 0], [1300, 0], [1400, -1200], [1600, -1200], [1700, 0], [3000, 0],
    [3000, 2000], [1000, 2000], [900, 1000], [800, 2000], [0, 2000],
];

const near = (a, b, metres) => Math.hypot((a[0] - b[0]) * 110540, (a[1] - b[1]) * kx) <= metres;

test('compass names', () => {
    assert.equal(compassName(0), 'north');
    assert.equal(compassName(95), 'east');
    assert.equal(compassName(225), 'southwest');
    assert.equal(compassName(-10), 'north');
});

test('joinRings joins ways end to end, reversing where needed, and drops lines that never close', () => {
    const a = node([0, 0]);
    const b = node([0, 1]);
    const c = node([1, 1]);
    const d = node([1, 0]);
    const rings = joinRings([[a, b], [c, b], [c, d, a], [node([5, 5]), node([6, 6])]]);
    assert.equal(rings.length, 1);
    assert.equal(rings[0].length, 5);
    assert.deepEqual(rings[0][0], rings[0][4]);
});

test('simplifyRing keeps the corners of a square traced with many points', () => {
    const traced = [];
    for (let i = 0; i < 100; i += 1) traced.push([i * 10, 0]);
    for (let i = 0; i < 100; i += 1) traced.push([1000, i * 10]);
    for (let i = 0; i < 100; i += 1) traced.push([1000 - i * 10, 1000]);
    for (let i = 0; i < 100; i += 1) traced.push([0, 1000 - i * 10]);
    traced.push([0, 0]);
    const simple = simplifyRing(traced, 5);
    assert.equal(simple.length, 5);
});

test('lakeCandidates keeps named still water of a mappable size, biggest first', () => {
    const bounds = (span) => ({ minlat: 35, minlon: -80, maxlat: 35 + span, maxlon: -80 + span });
    const elements = [
        { type: 'way', id: 1, tags: { natural: 'water', water: 'pond', name: 'Marina basin' }, bounds: bounds(0.003) },
        { type: 'relation', id: 2, tags: { natural: 'water', water: 'reservoir', name: 'Big Lake' }, bounds: bounds(0.2) },
        { type: 'way', id: 3, tags: { natural: 'water', water: 'river' }, bounds: bounds(0.5) },
        { type: 'way', id: 4, tags: { natural: 'water' }, bounds: bounds(0.0005) },
    ];
    assert.deepEqual(lakeCandidates(elements).map((c) => c.id), [2, 1]);
    assert.equal(tooBig(elements), false);
    assert.equal(tooBig([{ type: 'relation', id: 9, tags: { natural: 'water', name: 'Lake Michigan' }, bounds: bounds(4) }]), true);
    assert.deepEqual(lakeCandidates([{ type: 'relation', id: 9, tags: { natural: 'water' }, bounds: bounds(4) }]), []);
});

test('lookupQuery asks for the water at and beside the point', () => {
    const query = lookupQuery(35.123456, -80.5);
    assert.match(query, /is_in\(35\.12346,-80\.50000\)/);
    assert.match(query, /around:400/);
});

test('lakeFromGeometry joins a relation into an outer shore and its islands', () => {
    const outer = ring(SQUARE).coords.map(node);
    const island = ring([[900, 900], [1100, 900], [1100, 1100], [900, 1100]], false).coords.map(node);
    const lake = lakeFromGeometry({
        type: 'relation',
        id: 7,
        tags: { name: 'Test Lake' },
        members: [
            { type: 'way', role: 'outer', geometry: outer.slice(0, 3) },
            { type: 'way', role: 'outer', geometry: outer.slice(2) },
            { type: 'way', role: 'inner', geometry: island },
        ],
    });
    assert.equal(lake.id, 'relation/7');
    assert.equal(lake.name, 'Test Lake');
    assert.deepEqual(lake.rings.map((r) => r.outer), [true, false]);
    assert.equal(lake.rings[0].coords.length, 5);
});

test('targetPlan follows the phase: coves and the north shore in the spawn, creek arms in the fall', () => {
    assert.deepEqual(targetPlan({ phaseId: 'spawn' }).kinds.map((k) => k.kind), ['cove', 'sun']);
    const fall = targetPlan({ phaseId: 'fall' });
    assert.equal(fall.kinds[0].title, 'Creek arms and coves');
    assert.match(fall.kinds[0].why, /shad/);
    assert.equal(fall.depthNote, null);
    assert.match(targetPlan({ phaseId: 'summer' }).depthNote, /depth map/);
});

test('targetPlan adds the wind-blown bank only in a real wind and water warm enough', () => {
    const windy = targetPlan({ phaseId: 'prespawn', windMph: 14, windFrom: 270, waterTempF: 58 });
    const wind = windy.kinds.find((k) => k.kind === 'wind');
    assert.equal(wind.title, 'Wind-blown bank: the east shore');
    assert.equal(windy.kinds[1].kind, 'wind');
    assert.ok(!targetPlan({ phaseId: 'prespawn', windMph: 4, windFrom: 270, waterTempF: 58 }).kinds.some((k) => k.kind === 'wind'));
    const cold = targetPlan({ phaseId: 'winter', windMph: 14, windFrom: 270, waterTempF: 42 });
    assert.ok(!cold.kinds.some((k) => k.kind === 'wind'));
    assert.match(cold.calmNote, /calm/);
    assert.ok(!targetPlan({ phaseId: 'spawn', windMph: 14, windFrom: 270, waterTempF: 66 }).kinds.some((k) => k.kind === 'wind'));
});

test('the north shore and the wind-blown bank land on the right sides, whichever way the outline runs', () => {
    for (const xy of [SQUARE, SQUARE.slice().reverse()]) {
        const lake = { rings: [ring(xy)] };
        const zones = locateZones(lake, { kinds: [{ kind: 'sun' }, { kind: 'wind' }] }, { windFrom: 270 });
        const sun = zones.find((z) => z.kind === 'sun');
        const wind = zones.find((z) => z.kind === 'wind');
        assert.ok(near(sun.at, toLatLon([1000, 2000]), 200), `north shore, got ${sun.at}`);
        assert.ok(near(wind.at, toLatLon([2000, 1000]), 200), `east shore, got ${wind.at}`);
    }
});

test('an island\'s south shore faces the sun no more than the lake\'s does: islands keep the water on the right side', () => {
    const lake = { rings: [ring(SQUARE), ring([[800, 800], [1200, 800], [1200, 1200], [800, 1200]], false)] };
    const zones = locateZones(lake, { kinds: [{ kind: 'sun' }] });
    // Only north-shore stretches: the lake's north bank (y 2000) and the island's south bank (y 800), whose land is to the north.
    for (const zone of zones) {
        const y = (zone.at[0] - LAT0) * 110540;
        assert.ok(Math.abs(y - 2000) < 30 || Math.abs(y - 800) < 30, `unexpected sun bank at y=${y}`);
    }
});

test('locateZones finds the cove and the point in the outline', () => {
    const lake = { rings: [ring(SHAPED)] };
    const zones = locateZones(lake, { kinds: [{ kind: 'cove' }, { kind: 'point' }] });
    const cove = zones.find((z) => z.kind === 'cove');
    const point = zones.find((z) => z.kind === 'point');
    assert.ok(cove && near(cove.at, toLatLon([1500, -1200]), 150), `cove at ${cove?.at}`);
    assert.ok(point && near(point.at, toLatLon([900, 1000]), 150), `point at ${point?.at}`);
});

test('a wind blowing across a narrow strip of water makes no wind-blown bank', () => {
    const strip = { rings: [ring([[0, 0], [100, 0], [100, 3000], [0, 3000]])] };
    assert.deepEqual(locateZones(strip, { kinds: [{ kind: 'wind' }] }, { windFrom: 270 }), []);
});

// ----- The proxy -------------------------------------------------------------------------

const realFetch = globalThis.fetch;
afterEach(() => {
    globalThis.fetch = realFetch;
});

test('pointFor snaps to the grid and refuses places outside the US', () => {
    assert.deepEqual(pointFor('https://x/api/lake?lat=35.5923&lon=-80.9329'), { lat: 35.59, lon: -80.935 });
    assert.equal(pointFor('https://x/api/lake?lat=51.5&lon=-0.1'), null);
    assert.equal(pointFor('https://x/api/lake?lat=abc&lon=-80'), null);
});

// An NHD answer as the map server sends it: [lon, lat] rings, clockwise around the water.
const esriRing = (xy, clockwise) => {
    const ring = [...xy, xy[0]].map(toLatLon).map(([lat, lon]) => [lon, lat]);
    const area = ring.reduce((sum, p, i) => (i ? sum + ring[i - 1][0] * p[1] - p[0] * ring[i - 1][1] : 0), 0);
    return (area < 0) === clockwise ? ring : ring.reverse();
};
const nhdFeature = (attributes, rings) => ({ attributes, geometry: { rings } });
const SQUARE_NHD = nhdFeature({ objectid: 11, gnis_name: 'Square Lake', ftype: 390, areasqkm: 4 },
    [esriRing(SQUARE, true), esriRing([[800, 800], [1200, 800], [1200, 1200], [800, 1200]], false)]);

test('nhdUrl asks for the waterbodies in a small box around the point, simplified', () => {
    const url = new URL(nhdUrl(35.5, -80.9));
    assert.equal(url.searchParams.get('geometryType'), 'esriGeometryEnvelope');
    assert.equal(url.searchParams.get('geometry'), '-80.90300,35.49700,-80.89700,35.50300');
    assert.equal(url.searchParams.get('outSR'), '4326');
    assert.ok(Number(url.searchParams.get('maxAllowableOffset')) > 0);
});

test('lakeFromNhd reads the shore and islands from the ring direction', () => {
    const [lat, lon] = toLatLon([1000, 300]);
    const { lake } = lakeFromNhd({ features: [SQUARE_NHD] }, lat, lon);
    assert.equal(lake.id, 'nhd/11');
    assert.equal(lake.name, 'Square Lake');
    assert.deepEqual(lake.rings.map((r) => r.outer), [true, false]);
});

test('lakeFromNhd prefers the lake the point is in, skips marshes, and calls huge water too big', () => {
    const [lat, lon] = toLatLon([1000, 300]);
    const bigger = nhdFeature({ OBJECTID: 12, GNIS_NAME: 'Neighbour Lake', FTYPE: 436, AREASQKM: 40 }, [esriRing([[3000, 0], [9000, 0], [9000, 6000], [3000, 6000]], true)]);
    const marsh = nhdFeature({ objectid: 13, gnis_name: 'Bog', ftype: 466, areasqkm: 90 }, [esriRing(SQUARE, true)]);
    assert.equal(lakeFromNhd({ features: [bigger, marsh, SQUARE_NHD] }, lat, lon).lake.name, 'Square Lake');
    assert.equal(lakeFromNhd({ features: [bigger, marsh] }, lat, lon).lake.name, 'Neighbour Lake'); // beside it: the biggest
    assert.deepEqual(lakeFromNhd({ features: [marsh] }, lat, lon), { lake: null, reason: 'none' });
    const sea = nhdFeature({ objectid: 14, gnis_name: 'Inland Sea', ftype: 390, areasqkm: 5000 }, [esriRing(SQUARE, true)]);
    assert.equal(lakeFromNhd({ features: [sea] }, lat, lon).reason, 'too-big');
    const unnamed = nhdFeature({ objectid: 15, gnis_name: ' ', ftype: 390, areasqkm: 4 }, [esriRing(SQUARE, true)]);
    assert.equal(lakeFromNhd({ features: [unnamed] }, lat, lon).lake.name, null);
});

test('findLake uses NHD, and turns to OpenStreetMap only when NHD fails', async () => {
    const [lat, lon] = toLatLon([1000, 300]);
    const osm = async (query) => (query.includes('is_in')
        ? { elements: [{ type: 'way', id: 5, tags: { natural: 'water', name: 'OSM Lake' }, bounds: { minlat: 35, minlon: -80, maxlat: 35.02, maxlon: -79.98 } }] }
        : { elements: [{ type: 'way', id: 5, tags: { natural: 'water', name: 'OSM Lake' }, geometry: ring(SQUARE).coords.map(node) }] });
    let posts = 0;
    const post = (query) => { posts += 1; return osm(query); };

    const fromNhd = await findLake(lat, lon, { get: async () => ({ features: [SQUARE_NHD] }), post });
    assert.equal(fromNhd.source, 'nhd');
    assert.equal(fromNhd.lake.name, 'Square Lake');
    assert.equal(posts, 0);

    const none = await findLake(lat, lon, { get: async () => ({ features: [] }), post });
    assert.deepEqual([none.lake, none.reason, posts], [null, 'none', 0]); // NHD's "no lake" is believed

    for (const get of [async () => { throw new Error('504'); }, async () => ({ error: { code: 500, message: 'busy' } })]) {
        const fallback = await findLake(lat, lon, { get, post });
        assert.equal(fallback.source, 'osm');
        assert.equal(fallback.lake.name, 'OSM Lake');
    }
});

test('the proxy finds the lake through NHD and answers with the shaped lake', async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push(init?.method ?? 'GET');
        return new Response(JSON.stringify({ features: [SQUARE_NHD] }), { headers: { 'content-type': 'application/json' } });
    };
    const response = await onRequestGet({ request: new Request('https://x/api/lake?lat=35.01&lon=-79.99') });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.lake.name, 'Square Lake');
    assert.deepEqual(calls, ['GET']);
});

test('the proxy answers 502 when both sources fail and nothing is cached', async () => {
    globalThis.fetch = async () => new Response('busy', { status: 504 });
    const response = await onRequestGet({ request: new Request('https://x/api/lake?lat=35.01&lon=-79.99') });
    assert.equal(response.status, 502);
});

test('the proxy refuses a request without coordinates', async () => {
    const response = await onRequestGet({ request: new Request('https://x/api/lake') });
    assert.equal(response.status, 400);
});

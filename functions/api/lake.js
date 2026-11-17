// Cloudflare Pages Function: the outline of the lake at a point, simplified.
//
//   GET /api/lake?lat=35.59&lon=-80.93
//     ->  { "lake": { "id": "nhd/1172832", "name": "Lake Norman", "rings": [{ "outer": true, "coords": [[lat, lon], …] }, …] } }
//     ->  { "lake": null, "reason": "none" | "too-big" }
//
// The outline comes from the USGS National Hydrography Dataset, or from OpenStreetMap
// through the public Overpass API when that fails (see js/core/lake-shape.js). Either can
// take most of a minute for a big reservoir, and lake shores do not move, so the shaped
// answer is cached at the edge for a month: one visitor waits, everyone after gets it at once. The point is snapped to a grid so that
// people standing on the same lake share the answer.

import { SITE } from '../_middleware.js';
import { OVERPASS, findLake } from '../../js/core/lake-shape.js';

const GRID_DEGREES = 0.005; // about 500 m
const FRESH_SECONDS = 30 * 24 * 60 * 60;
const STALE_IF_ERROR_SECONDS = 180 * 24 * 60 * 60;
const UPSTREAM_TIMEOUT_MS = 60_000;
const USER_AGENT = `${new URL(SITE).hostname} (${SITE})`;

const json = (body, status = 200, extra = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
});

const snap = (value) => (Math.round(value / GRID_DEGREES) * GRID_DEGREES).toFixed(3);

/** The snapped point for a request, or null if the coordinates are not usable. */
export function pointFor(requestUrl) {
    const params = new URL(requestUrl).searchParams;
    const lat = Number.parseFloat(params.get('lat'));
    const lon = Number.parseFloat(params.get('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 17 || lat > 72 || lon < -180 || lon > -64) return null;
    return { lat: Number(snap(lat)), lon: Number(snap(lon)) };
}

async function get(url) {
    const response = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`NHD answered ${response.status}`);
    return response.json();
}

async function post(query) {
    const response = await fetch(OVERPASS, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'user-agent': USER_AGENT },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Overpass answered ${response.status}`);
    return response.json();
}

export async function onRequestGet({ request, waitUntil }) {
    const point = pointFor(request.url);
    if (!point) return json({ error: 'lat and lon (in the US) are required' }, 400);

    const cache = globalThis.caches?.default ?? null;
    const cacheKey = new Request(`${SITE}/api/lake?lat=${point.lat}&lon=${point.lon}`, { method: 'GET' });
    const cached = cache ? await cache.match(cacheKey) : null;
    const age = cached ? (Date.now() - Number(cached.headers.get('x-fetched-at'))) / 1000 : Infinity;
    if (cached && age < FRESH_SECONDS) return json(await cached.text(), 200, { 'x-cache': 'hit' });

    let body;
    try {
        body = JSON.stringify(await findLake(point.lat, point.lon, { get, post }));
    } catch {
        if (cached) return json(await cached.text(), 200, { 'x-cache': 'stale' });
        return json({ error: 'Lake outlines are unavailable' }, 502);
    }

    if (cache) {
        const stored = new Response(body, {
            headers: {
                'content-type': 'application/json; charset=utf-8',
                'cache-control': `public, max-age=${FRESH_SECONDS + STALE_IF_ERROR_SECONDS}`,
                'x-fetched-at': String(Date.now()),
            },
        });
        const write = cache.put(cacheKey, stored);
        if (waitUntil) waitUntil(write);
        else await write;
    }
    return json(body, 200, { 'x-cache': cache ? 'miss' : 'bypass' });
}

/** Anything but GET. */
export function onRequest() {
    return json({ error: 'Method not allowed' }, 405, { allow: 'GET' });
}

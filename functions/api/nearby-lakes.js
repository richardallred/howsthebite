// Cloudflare Pages Function: the named lakes and reservoirs around a town.
//
//   GET /api/nearby-lakes?lat=35.6&lon=-82.55
//     ->  { "lakes": [{ "name": "Lake Julian", "detail": "Lake · 299 acres", "lat": 35.47, "lon": -82.54, "kind": "lake", "miles": 8.4 }, …] }
//
// The list comes from the USGS National Hydrography Dataset (see js/core/nearby-water.js),
// which can take half a minute for a box this size. Lakes do not move, so the answer is cached
// at the edge for a month: one visitor waits, everyone after gets it at once. The point is
// snapped to a grid so that people in the same town share the answer.

import { SITE } from '../_middleware.js';
import { lakesFromNhd, nearbyLakesUrl } from '../../js/core/nearby-water.js';

const GRID_DEGREES = 0.02; // about 2 km
const FRESH_SECONDS = 30 * 24 * 60 * 60;
const STALE_IF_ERROR_SECONDS = 180 * 24 * 60 * 60;
const UPSTREAM_TIMEOUT_MS = 60_000;
const USER_AGENT = `${new URL(SITE).hostname} (${SITE})`;

const json = (body, status = 200, extra = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
});

const snap = (value) => Number((Math.round(value / GRID_DEGREES) * GRID_DEGREES).toFixed(2));

/** The snapped point for a request, or null if the coordinates are not usable. */
export function pointFor(requestUrl) {
    const params = new URL(requestUrl).searchParams;
    const lat = Number.parseFloat(params.get('lat'));
    const lon = Number.parseFloat(params.get('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 17 || lat > 72 || lon < -180 || lon > -64) return null;
    return { lat: snap(lat), lon: snap(lon) };
}

export async function onRequestGet({ request, waitUntil }) {
    const point = pointFor(request.url);
    if (!point) return json({ error: 'lat and lon (in the US) are required' }, 400);

    const cache = globalThis.caches?.default ?? null;
    const cacheKey = new Request(`${SITE}/api/nearby-lakes?lat=${point.lat}&lon=${point.lon}`, { method: 'GET' });
    const cached = cache ? await cache.match(cacheKey) : null;
    const age = cached ? (Date.now() - Number(cached.headers.get('x-fetched-at'))) / 1000 : Infinity;
    if (cached && age < FRESH_SECONDS) return json(await cached.text(), 200, { 'x-cache': 'hit' });

    let body;
    try {
        const response = await fetch(nearbyLakesUrl(point.lat, point.lon), {
            headers: { accept: 'application/json', 'user-agent': USER_AGENT },
            signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`NHD answered ${response.status}`);
        const answer = await response.json();
        if (answer?.error) throw new Error(answer.error.message ?? 'NHD error');
        body = JSON.stringify({ lakes: lakesFromNhd(answer, point.lat, point.lon) });
    } catch {
        if (cached) return json(await cached.text(), 200, { 'x-cache': 'stale' });
        return json({ error: 'Nearby lakes are unavailable' }, 502);
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

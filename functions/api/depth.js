// Cloudflare Pages Function: the depth contours in a box around a lake, where a public
// survey has them.
//
//   GET /api/depth?box=-84.86,44.27,-84.62,44.41      (west,south,east,north)
//     ->  { "depth": { "source": "mi-dnr", "credit": "Michigan DNR", "link": "…",
//                      "contours": [{ "ft": 10, "lines": [[[lat, lon], …], …] }, …] } }
//     ->  { "depth": null }                            no source has this water
//
//   GET /api/depth?box=…&charts=1                      salt water: NOAA's charts only, with the low-water (0 ft) line
//
// The sources are state and federal map services (see js/core/depth.js). They allow browsers,
// but a lake's contours are megabytes as published and each source has its own fields and
// units, so the lines are fetched, read, thinned and cached here: lake beds do not move, and
// one visitor waits so that everyone after gets the answer at once. The box is snapped to a
// grid, and the app asks for a lake's whole outline, so people on the same lake share it.

import { SITE } from '../_middleware.js';
import { findDepth, snapBox } from '../../js/core/depth.js';

const FRESH_SECONDS = 30 * 24 * 60 * 60;
const STALE_IF_ERROR_SECONDS = 180 * 24 * 60 * 60;
const UPSTREAM_TIMEOUT_MS = 30_000;
const USER_AGENT = `${new URL(SITE).hostname} (${SITE})`;

const json = (body, status = 200, extra = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
});

/** The snapped box for a request, or null if it is not a usable box in the US. */
export function boxFor(requestUrl) {
    const parts = (new URL(requestUrl).searchParams.get('box') ?? '').split(',');
    return parts.length === 4 ? snapBox(parts.map((part) => Number.parseFloat(part))) : null;
}

async function get(url) {
    const response = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`The depth service answered ${response.status}`);
    return response.json();
}

export async function onRequestGet({ request, waitUntil }) {
    const box = boxFor(request.url);
    if (!box) return json({ error: 'box=west,south,east,north (in the US, at most 2 degrees across) is required' }, 400);

    const charts = new URL(request.url).searchParams.get('charts') === '1';

    const cache = globalThis.caches?.default ?? null;
    const cacheKey = new Request(`${SITE}/api/depth?box=${box.join(',')}${charts ? '&charts=1' : ''}`, { method: 'GET' });
    const cached = cache ? await cache.match(cacheKey) : null;
    const age = cached ? (Date.now() - Number(cached.headers.get('x-fetched-at'))) / 1000 : Infinity;
    if (cached && age < FRESH_SECONDS) return json(await cached.text(), 200, { 'x-cache': 'hit' });

    let body;
    try {
        body = JSON.stringify(await findDepth(box, { get, charts }));
    } catch {
        if (cached) return json(await cached.text(), 200, { 'x-cache': 'stale' });
        return json({ error: 'Depth contours are unavailable' }, 502);
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

// Cloudflare Pages Function: a stand-in route to the National Weather Service API.
//
//   GET /api/nws/points/41.8781,-87.6298            ->  https://api.weather.gov/points/41.8781,-87.6298
//   GET /api/nws/gridpoints/LOT/76,73/forecast?...  ->  https://api.weather.gov/gridpoints/LOT/76,73/forecast?...
//
// Why it exists:
//   * Browsers call api.weather.gov directly, and that stays the normal route. But
//     api.weather.gov/robots.txt disallows everything, and a search engine rendering a page
//     obeys robots.txt for every request the page makes. Without this, Google's renderer
//     gets no weather, so no score, forecast or best times: it sees an error where the
//     content should be. The app (js/api/nws.js) comes here only when the direct request
//     cannot connect, which is also what a network filter blocking weather.gov looks like.
//   * Answers are cached at the edge, so a crawl of many pages costs NWS very little.
//
// It is not an open proxy: only the endpoints and query parameters the app uses are
// forwarded, and only for GET.
//
// Every answer that came from NWS carries `x-proxy: nws`, so the app can tell "NWS says
// 404" (no forecast for that spot) from "there is no proxy here" (plain static hosting).

import { SITE } from '../../_middleware.js';

const UPSTREAM = 'https://api.weather.gov';
// NWS asks every client to say who it is.
const USER_AGENT = `(${new URL(SITE).hostname}, ${SITE})`;

const MINUTE = 60;
const DAY = 24 * 60 * MINUTE;
const COORDS = '-?\\d{1,3}(?:\\.\\d{1,15})?,-?\\d{1,3}(?:\\.\\d{1,15})?';
const GRID = 'gridpoints/[A-Z]{3,4}/\\d{1,4},\\d{1,4}';
const POINT_PARAM = new RegExp(`^${COORDS}$`);

/** What the app asks for: path, the query parameters it may carry, and seconds an answer stays fresh. */
export const ROUTES = [
    { path: new RegExp(`^points/${COORDS}$`), params: {}, freshSeconds: DAY }, // a coordinate's grid cell never changes
    { path: new RegExp(`^${GRID}/forecast(?:/hourly)?$`), params: { units: /^(?:us|si)$/ }, freshSeconds: 15 * MINUTE },
    { path: new RegExp(`^${GRID}/stations$`), params: { limit: /^\d{1,3}$/ }, freshSeconds: DAY },
    { path: new RegExp(`^${GRID}$`), params: {}, freshSeconds: 30 * MINUTE }, // the raw grid: wave heights
    {
        path: /^stations\/[A-Za-z0-9]{3,12}\/observations$/,
        params: { start: /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/, limit: /^\d{1,3}$/ },
        freshSeconds: 5 * MINUTE,
    },
    { path: /^alerts\/active$/, params: { point: POINT_PARAM }, freshSeconds: 2 * MINUTE },
    { path: /^zones$/, params: { type: /^[a-z]{1,20}$/, point: POINT_PARAM }, freshSeconds: DAY },
];

const STALE_IF_ERROR_SECONDS = 60 * MINUTE;
const UPSTREAM_TIMEOUT_MS = 10_000;
const MARK = { 'x-proxy': 'nws' };

const json = (body, status, headers = {}) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

/** The upstream URL for a request, or null if the request is not one the app makes. */
export function upstreamUrl(requestUrl, pathSegments) {
    const path = (pathSegments ?? []).join('/');
    const route = ROUTES.find((candidate) => candidate.path.test(path));
    if (!route) return null;

    const incoming = new URL(requestUrl).searchParams;
    const url = new URL(`${UPSTREAM}/${path}`);
    // Fixed order + whitelist => one cache entry per distinct question.
    for (const [name, allowed] of Object.entries(route.params)) {
        let value = incoming.get(name);
        if (value === null || value === '') continue;
        if (!allowed.test(value)) return null;
        // "Observations since 72 hours ago" names a new instant every second. Asking from the
        // top of that hour instead returns a few more readings and lets requests share an answer.
        if (name === 'start') value = `${value.slice(0, 13)}:00:00Z`;
        url.searchParams.set(name, value);
    }
    return { url, freshSeconds: route.freshSeconds };
}

/** What the browser receives. The browser is told not to cache: the edge cache is the cache. */
function reply(cached, status) {
    return new Response(cached.body, {
        status: 200,
        headers: {
            'content-type': cached.headers.get('content-type') ?? 'application/geo+json',
            'cache-control': 'no-store',
            'x-cache': status,
            ...MARK,
        },
    });
}

export async function onRequestGet({ request, params, waitUntil }) {
    const target = upstreamUrl(request.url, params?.path);
    // 400, not 404: to the app a 404 from here means NWS has no data for the spot.
    if (!target) return json({ error: 'Not a request this proxy forwards' }, 400, MARK);

    const cache = globalThis.caches?.default ?? null;
    const cacheKey = new Request(target.url.toString(), { method: 'GET' });
    const cached = cache ? await cache.match(cacheKey) : null;
    if (cached) {
        const ageSeconds = (Date.now() - Number(cached.headers.get('x-fetched-at'))) / 1000;
        if (ageSeconds < target.freshSeconds) return reply(cached, 'hit');
    }

    let upstream;
    try {
        upstream = await fetch(target.url, {
            headers: { accept: 'application/geo+json', 'user-agent': USER_AGENT },
            signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
    } catch {
        upstream = null; // network error or timeout
    }

    if (upstream?.ok) {
        const body = await upstream.arrayBuffer();
        const contentType = upstream.headers.get('content-type') ?? 'application/geo+json';
        if (cache) {
            const stored = new Response(body, {
                headers: {
                    'content-type': contentType,
                    // Kept past "fresh" so it can stand in during an outage.
                    'cache-control': `public, max-age=${target.freshSeconds + STALE_IF_ERROR_SECONDS}`,
                    'x-fetched-at': String(Date.now()),
                },
            });
            const write = cache.put(cacheKey, stored.clone());
            if (waitUntil) waitUntil(write);
            else await write;
            return reply(stored, 'miss');
        }
        return new Response(body, {
            status: 200,
            headers: { 'content-type': contentType, 'cache-control': 'no-store', 'x-cache': 'bypass', ...MARK },
        });
    }

    // Upstream failed. "No data for that spot" (404) is an answer the app acts on; anything
    // else falls back to the last good answer if there is one.
    const status = upstream?.status ?? 504;
    const callerError = status >= 400 && status < 500 && status !== 429;
    if (cached && !callerError) return reply(cached, 'stale');
    return json(
        { error: 'National Weather Service request failed', upstreamStatus: upstream?.status ?? null },
        callerError || status === 429 ? status : 502,
        MARK,
    );
}

/** Anything but GET. */
export function onRequest() {
    return json({ error: 'Method not allowed' }, 405, { allow: 'GET' });
}

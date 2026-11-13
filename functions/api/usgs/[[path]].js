// Cloudflare Pages Function: caching proxy for the USGS Water Data API.
//
//   GET /api/usgs/<collection>/items?...  ->  https://api.waterdata.usgs.gov/ogcapi/v1/collections/<collection>/items?...
//
// Why it exists:
//   * The API key stays on the server (Pages secret USGS_API_KEY) instead of in every browser.
//   * Answers are cached at the edge, so visitors looking at the same water share one
//     upstream request and the key's hourly quota goes a long way.
//   * If USGS is rate-limiting or down, the last good answer (up to six hours old) is
//     served instead of an error. Every reading carries its own timestamp, and the app
//     shows it, so stale data is never presented as fresh.
//
// It is not an open proxy: only the three collections and the query parameters the
// app uses are forwarded, and only for GET.

const UPSTREAM = 'https://api.waterdata.usgs.gov/ogcapi/v1/collections';

/** Collection -> seconds an answer is considered fresh. Station names almost never change. */
export const COLLECTIONS = {
    'latest-continuous': 10 * 60,
    continuous: 10 * 60,
    'monitoring-locations': 24 * 60 * 60,
};

export const ALLOWED_PARAMS = [
    'bbox', 'id', 'limit', 'monitoring_location_id', 'parameter_code', 'properties',
    'skipGeometry', 'time', 'time_series_id',
];

const STALE_IF_ERROR_SECONDS = 6 * 60 * 60;
const MAX_LIMIT = 5000;
const MAX_PARAM_LENGTH = 2000;
const UPSTREAM_TIMEOUT_MS = 10_000;

const json = (body, status, headers = {}) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

/** The upstream URL for a request, or null if the request is not one the app makes. */
export function upstreamUrl(requestUrl, pathSegments) {
    const [collection, items, ...extra] = pathSegments ?? [];
    if (!(collection in COLLECTIONS) || items !== 'items' || extra.length) return null;

    const incoming = new URL(requestUrl).searchParams;
    const url = new URL(`${UPSTREAM}/${collection}/items`);
    url.searchParams.set('f', 'json');
    // Fixed order + whitelist => one cache entry per distinct question.
    for (const name of ALLOWED_PARAMS) {
        const value = incoming.get(name);
        if (value === null || value === '') continue;
        if (value.length > MAX_PARAM_LENGTH) return null;
        if (name === 'limit') {
            const limit = Number.parseInt(value, 10);
            if (!Number.isInteger(limit) || limit < 1) return null;
            url.searchParams.set(name, String(Math.min(limit, MAX_LIMIT)));
        } else {
            url.searchParams.set(name, value);
        }
    }
    return { url, freshSeconds: COLLECTIONS[collection] };
}

/** What the browser receives. The browser is told not to cache: the edge cache is the cache. */
function reply(cached, status) {
    return new Response(cached.body, {
        status: 200,
        headers: {
            'content-type': cached.headers.get('content-type') ?? 'application/json',
            'cache-control': 'no-store',
            'x-cache': status,
            'x-fetched-at': cached.headers.get('x-fetched-at') ?? '',
        },
    });
}

export async function onRequestGet({ request, env, params, waitUntil }) {
    const target = upstreamUrl(request.url, params?.path);
    if (!target) return json({ error: 'Not found' }, 404);

    const cache = globalThis.caches?.default ?? null;
    const cacheKey = new Request(target.url.toString(), { method: 'GET' });
    const cached = cache ? await cache.match(cacheKey) : null;
    if (cached) {
        const ageSeconds = (Date.now() - Number(cached.headers.get('x-fetched-at'))) / 1000;
        if (ageSeconds < target.freshSeconds) return reply(cached, 'hit');
    }

    let upstream;
    try {
        const headers = { accept: 'application/json' };
        if (env?.USGS_API_KEY) headers['x-api-key'] = env.USGS_API_KEY;
        upstream = await fetch(target.url, { headers, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
    } catch {
        upstream = null; // network error or timeout
    }

    if (upstream?.ok) {
        const body = await upstream.arrayBuffer();
        if (cache) {
            const stored = new Response(body, {
                headers: {
                    'content-type': upstream.headers.get('content-type') ?? 'application/json',
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
            headers: {
                'content-type': upstream.headers.get('content-type') ?? 'application/json',
                'cache-control': 'no-store',
                'x-cache': 'bypass',
            },
        });
    }

    // Upstream failed. A bad request is the caller's problem; anything else falls back to stale data.
    const status = upstream?.status ?? 504;
    const callerError = status >= 400 && status < 500 && status !== 429;
    if (cached && !callerError) return reply(cached, 'stale');
    return json(
        { error: status === 429 ? 'USGS rate limit reached' : 'USGS request failed', upstreamStatus: upstream?.status ?? null },
        callerError || status === 429 ? status : 502,
    );
}

/** Anything but GET. */
export function onRequest() {
    return json({ error: 'Method not allowed' }, 405, { allow: 'GET' });
}

// Cloudflare Pages Function: satellite sea-surface temperature near a point.
//
//   GET /api/sst?lat=29.21&lon=-81.02  ->  { "tempF": 77.6, "time": 1794474000000, "lat": 29.2, "lon": -80.96 }
//
// Used for salt water where no tide station nearby has a thermometer. The source is NASA
// JPL's MUR analysis (1 km, daily, about a day and a half behind), served by NOAA
// CoastWatch's ERDDAP. That server sends no CORS headers, so a browser cannot call it
// directly; this function does, and caches the answer at the edge.
//
// The shoreline itself is masked as land, so a small box around the point is requested
// and the nearest cell that has water is used. Bays read a degree or two warm, because
// the analysis is smoothed toward the open shelf; the app labels it a satellite estimate.

const UPSTREAM = 'https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41.json';
const GRID_DEGREES = 0.05; // requests are snapped to this grid so neighbours share an answer
const BOX_DEGREES = 0.06;
const FRESH_SECONDS = 6 * 60 * 60; // the product updates once a day
const STALE_IF_ERROR_SECONDS = 3 * 24 * 60 * 60; // the sea changes slowly; an old reading beats none
const UPSTREAM_TIMEOUT_MS = 10_000;

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

const snap = (value) => Math.round(value / GRID_DEGREES) * GRID_DEGREES;

/** The upstream URL for a request, or null if the coordinates are not usable. */
export function upstreamUrl(requestUrl) {
    const params = new URL(requestUrl).searchParams;
    const lat = Number.parseFloat(params.get('lat'));
    const lon = Number.parseFloat(params.get('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 75 || Math.abs(lon) > 180) return null;
    const [centreLat, centreLon] = [snap(lat), snap(lon)];
    const range = (centre) => `[(${(centre - BOX_DEGREES).toFixed(2)}):(${(centre + BOX_DEGREES).toFixed(2)})]`;
    return { url: `${UPSTREAM}?analysed_sst[(last)]${range(centreLat)}${range(centreLon)}`, lat: centreLat, lon: centreLon };
}

/** The water cell nearest the centre of an ERDDAP answer, as the app's reply; null if every cell is land. */
export function nearestReading(table, lat, lon) {
    let best = null;
    for (const [time, cellLat, cellLon, celsius] of table?.rows ?? []) {
        if (typeof celsius !== 'number' || celsius < -2 || celsius > 40) continue;
        const distance = (cellLat - lat) ** 2 + ((cellLon - lon) * Math.cos((lat * Math.PI) / 180)) ** 2;
        if (!best || distance < best.distance) best = { distance, time, cellLat, cellLon, celsius };
    }
    if (!best) return null;
    return {
        tempF: Number(((best.celsius * 9) / 5 + 32).toFixed(1)),
        time: Date.parse(best.time),
        lat: best.cellLat,
        lon: best.cellLon,
    };
}

function reply(cached, status) {
    return new Response(cached.body, {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-cache': status },
    });
}

export async function onRequestGet({ request, waitUntil }) {
    const target = upstreamUrl(request.url);
    if (!target) return json({ error: 'lat and lon are required' }, 400);

    const cache = globalThis.caches?.default ?? null;
    const cacheKey = new Request(target.url, { method: 'GET' });
    const cached = cache ? await cache.match(cacheKey) : null;
    if (cached && (Date.now() - Number(cached.headers.get('x-fetched-at'))) / 1000 < FRESH_SECONDS) return reply(cached, 'hit');

    let reading = null;
    let failed = false;
    try {
        const upstream = await fetch(target.url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
        if (upstream.ok) reading = nearestReading((await upstream.json()).table, target.lat, target.lon);
        else failed = true;
    } catch {
        failed = true;
    }

    if (failed) {
        if (cached) return reply(cached, 'stale');
        return json({ error: 'Sea-surface temperature is unavailable' }, 502);
    }

    // "No water here" is a real answer and is cached too, as a null reading.
    const body = JSON.stringify(reading ?? { tempF: null, time: null });
    if (cache) {
        const stored = new Response(body, {
            headers: {
                'content-type': 'application/json; charset=utf-8',
                'cache-control': `public, max-age=${FRESH_SECONDS + STALE_IF_ERROR_SECONDS}`,
                'x-fetched-at': String(Date.now()),
            },
        });
        const write = cache.put(cacheKey, stored.clone());
        if (waitUntil) waitUntil(write);
        else await write;
        return reply(stored, 'miss');
    }
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-cache': 'bypass' } });
}

/** Anything but GET. */
export function onRequest() {
    return json({ error: 'Method not allowed' }, 405, { allow: 'GET' });
}

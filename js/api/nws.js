// Requests to the National Weather Service API, with a second route for when the first is shut.
//
// Browsers call api.weather.gov directly. Some clients cannot: api.weather.gov/robots.txt
// disallows everything, and a search engine rendering this page obeys robots.txt for every
// request the page makes, so its renderer would get no weather and index a page with an
// error where the score should be. Network filters that block weather.gov look the same
// from here: the request never connects.
//
// So when a direct request cannot connect, the same question is put to this site's own
// stand-in (functions/api/nws/[[path]].js), and once that has answered, the rest of the
// visit goes that way. Where the stand-in is not deployed (plain static hosting, local
// `npm start`) the direct failure is reported as it always was.

import { API } from '../config.js';
import { HttpError, fetchJson } from './http.js';

const HEADERS = { Accept: 'application/geo+json' };

// 'direct' until a direct request fails to connect; then 'proxy' if the stand-in answered,
// or 'direct-only' if there is none (so it is not asked again).
let route = 'direct';

const proxied = (url) => {
    const { pathname, search } = new URL(url);
    return `${API.NWS_PROXY}${pathname}${search}`;
};

/** An answer that came through the stand-in from NWS, as opposed to a host with no stand-in saying 404. */
const fromProxy = (error) => error instanceof HttpError && error.headers?.get('x-proxy') === 'nws';

/**
 * GET JSON from an api.weather.gov URL. Rejects as fetchJson does: HttpError for an HTTP
 * error status, AbortError when cancelled, TimeoutError when too slow.
 */
export async function nwsFetch(url, { signal, timeoutMs } = {}) {
    const options = { signal, timeoutMs, headers: HEADERS };
    if (route === 'proxy') return fetchJson(proxied(url), options);
    try {
        return await fetchJson(url, options);
    } catch (error) {
        // fetch() rejects with a TypeError when the request could not be made at all. An HTTP
        // status, a cancellation or a timeout would be no different by another route.
        const blocked = error instanceof TypeError && route !== 'direct-only' && globalThis.navigator?.onLine !== false;
        if (!blocked) throw error;
        try {
            const data = await fetchJson(proxied(url), options);
            route = 'proxy';
            return data;
        } catch (proxyError) {
            if (fromProxy(proxyError)) {
                route = 'proxy';
                throw proxyError; // NWS's own answer, e.g. 404 for a spot it does not cover
            }
            // The stand-in answered with something of its own (a static host's 404 page): there is none.
            if (proxyError instanceof HttpError || proxyError instanceof SyntaxError) route = 'direct-only';
            throw error;
        }
    }
}

/** For tests: forget what has been learned about the routes. */
export function resetNwsRoute() {
    route = 'direct';
}

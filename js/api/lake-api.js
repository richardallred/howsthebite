// The lake outline behind "Where to look": through the site's caching proxy
// (functions/api/lake.js) where it is deployed, otherwise straight from the sources, which
// allow browsers (CORS) and need no key: the USGS National Hydrography Dataset, then
// OpenStreetMap through Overpass if that fails. Both can be slow for a big reservoir, so
// each outline is also kept in this browser: a lake opened before shows at once.

import { API } from '../config.js';
import { HttpError, buildUrl, fetchJson, isAbort } from './http.js';
import { OVERPASS, findLake } from '../core/lake-shape.js';

const PROXY_TIMEOUT_MS = 90_000; // a first visit to a big reservoir waits on the sources
const DIRECT_TIMEOUT_MS = 75_000;
const KEPT_PREFIX = 'htb-lake:';
const KEPT_MAX = 6; // outlines are 20–70 kB each
const KEPT_DAYS = 90;

let proxyAvailable = null; // null = not yet known
const answers = new Map(); // snapped point -> promise of the answer, for this visit

// ----- Kept in this browser -------------------------------------------------------------

function kept(key) {
    try {
        const entry = JSON.parse(localStorage.getItem(KEPT_PREFIX + key));
        if (entry && Date.now() - entry.at < KEPT_DAYS * 24 * 60 * 60 * 1000) return entry.answer;
    } catch {
        // storage unavailable or the entry is damaged: fetch it again
    }
    return null;
}

function keep(key, answer) {
    try {
        const keys = Object.keys(localStorage).filter((k) => k.startsWith(KEPT_PREFIX));
        const oldest = keys
            .map((k) => ({ k, at: JSON.parse(localStorage.getItem(k))?.at ?? 0 }))
            .sort((a, b) => a.at - b.at);
        while (oldest.length >= KEPT_MAX) localStorage.removeItem(oldest.shift().k);
        localStorage.setItem(KEPT_PREFIX + key, JSON.stringify({ at: Date.now(), answer }));
    } catch {
        // full or blocked: the outline still shows this visit
    }
}

// ----- Fetching ----------------------------------------------------------------------------

function direct(lat, lon, signal) {
    const get = (url) => fetchJson(url, { signal, timeoutMs: DIRECT_TIMEOUT_MS });
    const post = async (query) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new DOMException('The request timed out', 'TimeoutError')), DIRECT_TIMEOUT_MS);
        const onAbort = () => controller.abort(signal.reason);
        signal?.addEventListener('abort', onAbort, { once: true });
        try {
            const response = await fetch(OVERPASS, {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body: `data=${encodeURIComponent(query)}`,
                signal: controller.signal,
            });
            if (!response.ok) throw new HttpError(response.status, OVERPASS);
            return await response.json();
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
        }
    };
    return findLake(lat, lon, { get, post });
}

async function load(lat, lon, signal) {
    if (proxyAvailable !== false) {
        try {
            const data = await fetchJson(buildUrl(new URL(API.LAKE_PROXY, document.baseURI), { lat, lon }), { signal, timeoutMs: PROXY_TIMEOUT_MS });
            proxyAvailable = true;
            return data;
        } catch (error) {
            // A static host (npm start, GitHub Pages) answers the proxy's path with its 404 page.
            const notDeployed = error instanceof HttpError && error.status === 404;
            if (isAbort(error) || !notDeployed) throw error;
            proxyAvailable = false;
        }
    }
    return direct(lat, lon, signal);
}

/**
 * The lake at a point: { lake, reason } (see core/lake-shape.js findLake).
 * Asking again for the same spot reuses the answer: from this visit, or kept from an earlier one.
 */
export function fetchLake(lat, lon, { signal } = {}) {
    const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
    if (!answers.has(key)) {
        const known = kept(key);
        const promise = known ? Promise.resolve(known) : load(lat, lon, signal).then((answer) => {
            keep(key, answer);
            return answer;
        });
        answers.set(key, promise);
        promise.catch(() => answers.delete(key)); // a failure (or a cancel) can be retried
    }
    return answers.get(key);
}

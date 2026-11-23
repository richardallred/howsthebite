// Depth contours for the lake map: through the site's caching proxy (functions/api/depth.js)
// where it is deployed, otherwise straight from the sources (js/core/depth.js), which allow
// browsers (CORS) and need no key. Each answer is also kept in this browser, "no depth map"
// included, so a lake opened before is drawn at once and a reload asks nobody anything.

import { API } from '../config.js';
import { HttpError, buildUrl, fetchJson, isAbort } from './http.js';
import { findDepth } from '../core/depth.js';

const PROXY_TIMEOUT_MS = 60_000; // the first visit to a big lake waits on the sources
const DIRECT_TIMEOUT_MS = 30_000;

const KEPT_PREFIX = 'htb-depth:';
const KEPT_MAX = 6; // up to about 100 kB each
const KEPT_DAYS = 90;

let proxyAvailable = null; // null = not yet known
const answers = new Map(); // box -> promise of the answer, for this visit

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
        // full or blocked: the contours still show this visit
    }
}

// ----- Fetching ----------------------------------------------------------------------------

async function load(box, charts, signal) {
    if (proxyAvailable !== false) {
        try {
            const data = await fetchJson(buildUrl(new URL(API.DEPTH_PROXY, document.baseURI), { box: box.join(','), charts: charts ? '1' : null }), { signal, timeoutMs: PROXY_TIMEOUT_MS });
            proxyAvailable = true;
            return data;
        } catch (error) {
            // A static host (npm start, GitHub Pages) answers the proxy's path with its 404 page.
            const notDeployed = error instanceof HttpError && error.status === 404;
            if (isAbort(error) || !notDeployed) throw error;
            proxyAvailable = false;
        }
    }
    return findDepth(box, { charts, get: (url) => fetchJson(url, { signal, timeoutMs: DIRECT_TIMEOUT_MS }) });
}

/**
 * The depth contours in a box (from depthBox or chartBox in core/depth.js): { depth }, where
 * depth is null when no source has that water. `charts` asks NOAA's charts only, for salt
 * water. Asking again for the same box reuses the answer: from this visit, or kept from an
 * earlier one.
 */
export function fetchDepth(box, { signal, charts = false } = {}) {
    const key = `${box.join(',')}${charts ? '|charts' : ''}`;
    if (!answers.has(key)) {
        const known = kept(key);
        const promise = known ? Promise.resolve(known) : load(box, charts, signal).then((answer) => {
            keep(key, answer);
            return answer;
        });
        answers.set(key, promise);
        promise.catch(() => answers.delete(key)); // a failure (or a cancel) can be retried
    }
    return answers.get(key);
}

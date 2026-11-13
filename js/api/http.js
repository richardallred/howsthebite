import { APP } from '../config.js';

export class HttpError extends Error {
    constructor(status, url) {
        super(`Request failed with HTTP ${status}`);
        this.name = 'HttpError';
        this.status = status;
        this.url = url;
    }
}

export const isAbort = (error) => error?.name === 'AbortError';

/**
 * fetch() + JSON with a timeout. `signal` lets the caller cancel a request that
 * has been superseded (e.g. the user picked another location); a cancelled
 * request rejects with an AbortError, a timed-out one with a TimeoutError.
 */
export async function fetchJson(url, { signal, timeoutMs = APP.REQUEST_TIMEOUT_MS, headers } = {}) {
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal.reason);
    if (signal?.aborted) onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });

    const timer = setTimeout(
        () => controller.abort(new DOMException('The request timed out', 'TimeoutError')),
        timeoutMs,
    );

    try {
        const response = await fetch(url, { signal: controller.signal, headers });
        if (!response.ok) throw new HttpError(response.status, String(url));
        return await response.json();
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
    }
}

export function buildUrl(base, params) {
    const url = new URL(base);
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    }
    return url;
}

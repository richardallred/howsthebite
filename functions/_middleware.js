// Moves visitors from the old Cloudflare address to the site's own domain.
//
// A permanent redirect is how search engines learn that a site has moved: links to the old
// address count for the new one, and only the new one is indexed. Only page loads are
// redirected, and only on the production pages.dev address:
// - per-deployment and preview addresses (<hash>.howsthebite.pages.dev) and local
//   development are left alone, so they can still be tested;
// - files fetched by the page or the service worker (scripts, styles, sw.js, the data
//   proxies) are left alone, so a page or installed app that is still open on the old
//   address keeps working until its next load, which then lands on the new domain.
//   Browsers and saved data are per address, so saved places do not carry over.
// _routes.json limits this function to page requests and the proxies, so static
// files never wake a Worker.

export const OLD_HOST = 'howsthebite.pages.dev';
export const SITE = 'https://howsthebite.io';

const isPagePath = (path) => path === '/' || path.endsWith('.html') || !/\.[a-z0-9]+$/i.test(path.split('/').pop());

export function redirectTarget(request) {
    const url = new URL(request.url);
    if (url.hostname !== OLD_HOST) return null;
    if (request.method !== 'GET' && request.method !== 'HEAD') return null;
    if (url.pathname.startsWith('/api/') || !isPagePath(url.pathname)) return null;
    // Browsers say how a request is used; crawlers send no such header. A fetch() from the
    // page or the service worker ('cors', 'no-cors', 'same-origin') is not a page load.
    const mode = request.headers.get('sec-fetch-mode');
    if (mode && mode !== 'navigate') return null;
    return `${SITE}${url.pathname}${url.search}`;
}

export async function onRequest({ request, next }) {
    const target = redirectTarget(request);
    return target ? Response.redirect(target, 301) : next();
}

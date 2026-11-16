// Cloudflare Pages Function: the page for a place, /fishing/<lat>,<lon>/<name>.
//
// The app is one page that reads the place from its address (js/core/place-url.js). This
// serves that page with the place written into what search engines and link previews read
// without running scripts: the title, the description, the canonical address, the Open
// Graph tags and the <h1>. Everything else is the ordinary index.html, streamed through
// HTMLRewriter, so this costs about as much as serving the file.
//
// - Addresses that are almost right (more decimals, capitals, a trailing slash, a
//   punctuated name) get a permanent redirect to the canonical one, so every place has
//   one address in search results. The query string (shared choices) is kept.
// - Addresses that cannot name a place get the site's 404 page.
// - Places outside the Weather Service's coverage are served, but marked noindex.
// - The canonical origin comes from the canonical link in index.html, so a change of
//   domain is made there only.
// - A place with a link-preview card of its own (og/<slug>.jpg, made for the popular spots by
//   art/share/render.mjs) gets it as its Open Graph image; any other keeps the site's card.

import { parsePlacePath, placeMeta, placeName, inCoverage } from '../../js/core/place-url.js';

/**
 * What to do with a request for a place address.
 * @returns {{ redirect: string } | { notFound: true } | { path: string, name: string, indexable: boolean, card: string|null }}
 */
export function placePage(url) {
    if (url.pathname === '/fishing' || url.pathname === '/fishing/') return { redirect: '/' };
    const parsed = parsePlacePath(url.pathname);
    if (!parsed) return { notFound: true };
    if (parsed.canonical !== url.pathname) return { redirect: parsed.canonical + url.search };
    return {
        path: parsed.canonical,
        name: placeName(parsed, url.searchParams.get('name')),
        indexable: inCoverage(parsed.lat, parsed.lon),
        // A card shows the name from the address, so a page shared under another name keeps the site's card.
        card: url.searchParams.has('name') || !parsed.slug ? null : `/og/${parsed.slug}.jpg`,
    };
}

const setAttribute = (name, value) => ({ element: (element) => element.setAttribute(name, value) });
const setText = (text) => ({ element: (element) => element.setInnerContent(text) }); // escaped, never parsed as HTML
const absolute = (path) => ({
    element(element) {
        const site = element.getAttribute(element.tagName === 'link' ? 'href' : 'content');
        element.setAttribute(element.tagName === 'link' ? 'href' : 'content', new URL(path, site).href);
    },
});

/** The elements of index.html that are rewritten; tests/place-url.test.js checks they exist. */
export function rewriter(page) {
    const meta = placeMeta(page.name);
    const html = new HTMLRewriter();
    if (page.card) {
        html.on('meta[property="og:image"]', absolute(page.card))
            .on('meta[property="og:image:alt"]', setAttribute('content', `How's the Bite? fishing forecast for ${page.name}`));
    }
    return html
        .on('title', setText(meta.title))
        .on('meta[name="description"]', setAttribute('content', meta.description))
        .on('link[rel="canonical"]', absolute(page.path))
        .on('meta[property="og:url"]', absolute(page.path))
        .on('meta[property="og:title"]', setAttribute('content', meta.ogTitle))
        .on('meta[property="og:description"]', setAttribute('content', meta.ogDescription))
        .on('h1#locationName', setText(page.name));
}

export async function onRequest({ request, env, next }) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return next();
    const url = new URL(request.url);
    const page = placePage(url);
    if (page.redirect) return Response.redirect(new URL(page.redirect, url).href, 301);
    if (page.notFound) return next(); // no such file: Pages answers with 404.html and a 404 status

    const [shell, card] = await Promise.all([
        env.ASSETS.fetch(new URL('/', url)),
        page.card ? env.ASSETS.fetch(new URL(page.card, url), { method: 'HEAD' }) : null,
    ]);
    if (!shell.ok) return shell;
    if (!card?.ok) page.card = null; // most places have no card of their own
    const headers = new Headers(shell.headers);
    headers.delete('etag'); // the body differs from the file's
    headers.delete('content-length');
    if (!page.indexable) headers.set('x-robots-tag', 'noindex');
    const response = rewriter(page).transform(new Response(shell.body, { status: 200, headers }));
    return request.method === 'HEAD' ? new Response(null, { status: 200, headers: response.headers }) : response;
}

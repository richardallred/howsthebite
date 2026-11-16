// The sitemap, worked out from the pages themselves so they cannot disagree: the home page, the
// other pages (popular spots, questions), and every place those pages link to.
//
// - The site's address comes from the canonical link, so a change of domain is made there only.
// - Only canonical addresses are listed, which is what a sitemap is for.
// - No <lastmod>: Google uses it only when it is verifiably accurate, and these pages show
//   live conditions rather than something edited on a date. <priority> and <changefreq> are
//   ignored by Google, so they are left out too.

/** The paths of the place pages linked from the page, in order, without repeats. */
export function placeLinks(html) {
    return [...new Set([...html.matchAll(/<a\s[^>]*href="(\/fishing\/[^"#?]+)"/g)].map((match) => match[1]))];
}

/**
 * sitemap.xml for the site whose index.html this is.
 * @param {string} html  the home page, whose canonical link gives the site address
 * @param {Record<string, string>} [pages]  the other pages, by path ('/spots/'): their HTML
 */
export function sitemapXml(html, pages = {}) {
    const canonical = /<link rel="canonical" href="(https:\/\/[^"]+)">/.exec(html)?.[1];
    if (!canonical) throw new Error('index.html has no canonical link to take the site address from');
    const places = placeLinks([html, ...Object.values(pages)].join('\n'));
    const urls = ['/', ...Object.keys(pages), ...places].map((path) => new URL(path, canonical).href);
    const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...urls.map((url) => `    <url><loc>${escape(url)}</loc></url>`),
        '</urlset>',
        '',
    ].join('\n');
}

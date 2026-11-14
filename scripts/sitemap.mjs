// The sitemap, worked out from index.html so the two cannot disagree: the home page, plus
// every place the page links to (the "popular fishing spots" list).
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

/** sitemap.xml for the site whose index.html this is. */
export function sitemapXml(html) {
    const canonical = /<link rel="canonical" href="(https:\/\/[^"]+)">/.exec(html)?.[1];
    if (!canonical) throw new Error('index.html has no canonical link to take the site address from');
    const urls = ['/', ...placeLinks(html)].map((path) => new URL(path, canonical).href);
    const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...urls.map((url) => `    <url><loc>${escape(url)}</loc></url>`),
        '</urlset>',
        '',
    ].join('\n');
}

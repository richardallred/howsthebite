import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { inCoverage, nameFromSlug, parsePlacePath } from '../js/core/place-url.js';
import { placeLinks, sitemapXml } from '../scripts/sitemap.mjs';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
// <a href="/fishing/…" data-water="lake">Name</a>, as written in the popular places list.
const links = [...html.matchAll(/<a href="(\/fishing\/[^"]+)"(?: data-water="([^"]*)")?>([^<]+)<\/a>/g)]
    .map(([, href, water, text]) => ({ href, water, text }));

test('the page links to a good number of places, each one once', () => {
    assert.ok(links.length >= 30, `only ${links.length} place links found`);
    assert.equal(new Set(links.map((link) => link.href)).size, links.length, 'an address is listed twice');
    assert.equal(new Set(links.map((link) => link.text)).size, links.length, 'a name is listed twice');
    assert.deepEqual(placeLinks(html), links.map((link) => link.href), 'a place link is written in a form the sitemap does not pick up');
});

test('every listed address is the canonical one, so it is served without a redirect', () => {
    for (const { href } of links) {
        const parsed = parsePlacePath(href);
        assert.ok(parsed, `${href} is not a place address`);
        assert.equal(parsed.canonical, href);
        assert.ok(parsed.slug, `${href} has no name`);
        assert.ok(inCoverage(parsed.lat, parsed.lon), `${href} is outside the weather service's coverage and would be noindex`);
    }
});

test("every link's text is the name its page will show", () => {
    // The page takes its name from the address. If the two differ ("St. Louis" comes back as
    // "St Louis"), the link promises one heading and the page shows another.
    for (const { href, text } of links) assert.equal(nameFromSlug(parsePlacePath(href).slug), text);
});

test('the kind of water is lake, river or left out', () => {
    for (const { href, water } of links) assert.ok([undefined, 'lake', 'river'].includes(water), `${href}: data-water="${water}"`);
});

test('the sitemap lists the home page and every linked place, on the site in the canonical link', () => {
    const xml = sitemapXml(html);
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    assert.equal(locs[0], 'https://howsthebite.io/');
    assert.deepEqual(locs.slice(1), links.map((link) => `https://howsthebite.io${link.href}`));
    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">\n/);
    assert.doesNotMatch(xml, /lastmod|priority|changefreq/);

    const moved = sitemapXml(html.replace('<link rel="canonical" href="https://howsthebite.io/">', '<link rel="canonical" href="https://example.org/">'));
    assert.match(moved, /<loc>https:\/\/example\.org\/fishing\//);
    assert.throws(() => sitemapXml('<html></html>'), /canonical/);
});

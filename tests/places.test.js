import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { inCoverage, nameFromSlug, parsePlacePath } from '../js/core/place-url.js';
import { LISTED_WATER, OWN_SENSOR, isOwnSensor } from '../js/core/listed-places.js';
import { placeLinks, sitemapXml } from '../scripts/sitemap.mjs';

const home = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const html = await readFile(new URL('../spots/index.html', import.meta.url), 'utf8');
const faq = await readFile(new URL('../faq/index.html', import.meta.url), 'utf8');
// <a href="/fishing/…" data-water="lake">Name</a>, as written in the popular spots page.
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

test('the app knows the kind of water at every listed place, and only those', () => {
    const listed = Object.fromEntries(links.filter((link) => link.water).map((link) => [link.href, link.water]));
    assert.deepEqual(LISTED_WATER, listed, 'js/core/listed-places.js is out of step with spots/index.html');
});

test('every place said to have a sensor of its own is a listed place', () => {
    const listed = new Set(links.map((link) => link.href));
    assert.ok(OWN_SENSOR.size > 0);
    for (const [href, sensor] of OWN_SENSOR) {
        assert.ok(listed.has(href), `${href} is in OWN_SENSOR but not on the spots page`);
        assert.match(sensor, /^USGS-\d{8,15}$/, `${href}: ${sensor} is not a USGS sensor id`);
    }
});

test('only the place\'s own sensor counts as its own water', () => {
    const champlain = '/fishing/44.32,-73.32/lake-champlain-vermont';
    assert.equal(isOwnSensor(champlain, OWN_SENSOR.get(champlain)), true);
    assert.equal(isOwnSensor(champlain, 'USGS-01570500'), false, 'another sensor chosen at the place');
    assert.equal(isOwnSensor(champlain, undefined), false);
    assert.equal(isOwnSensor('/fishing/36.77,-88.13/kentucky-lake-kentucky', 'USGS-03612600'), false, 'a place with no sensor of its own');
    assert.equal(isOwnSensor('/fishing/1,1/nowhere', undefined), false);
});

test('the places are grouped by state, each under its own', () => {
    const groups = [...html.matchAll(/<summary>([^<]+)<\/summary>([\s\S]*?)<\/details>/g)];
    assert.ok(groups.length >= 30, `only ${groups.length} states`);
    assert.deepEqual(groups.map(([, state]) => state), groups.map(([, state]) => state).sort(), 'the states are not in alphabetical order');
    let grouped = 0;
    for (const [, state, body] of groups) {
        const names = [...body.matchAll(/>([^<]+)<\/a>/g)].map((match) => match[1]);
        assert.ok(names.length > 0, `${state} has no places`);
        for (const name of names) assert.ok(name.endsWith(`, ${state}`), `${name} is listed under ${state}`);
        grouped += names.length;
    }
    assert.equal(grouped, links.length, 'a place is outside the state groups');
});

test('the home page links to the spots and questions pages', () => {
    assert.match(home, /<a href="\/spots\/">/);
    assert.match(home, /<a href="\/faq\/">/);
});

test('the sitemap lists the pages and every linked place, on the site in the canonical link', () => {
    const xml = sitemapXml(home, { '/spots/': html, '/faq/': faq });
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    assert.deepEqual(locs.slice(0, 3), ['https://howsthebite.io/', 'https://howsthebite.io/spots/', 'https://howsthebite.io/faq/']);
    assert.deepEqual(locs.slice(3), links.map((link) => `https://howsthebite.io${link.href}`));
    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">\n/);
    assert.doesNotMatch(xml, /lastmod|priority|changefreq/);

    const moved = sitemapXml(home.replace('<link rel="canonical" href="https://howsthebite.io/">', '<link rel="canonical" href="https://example.org/">'));
    assert.match(moved, /<loc>https:\/\/example\.org\/<\/loc>/);
    assert.throws(() => sitemapXml('<html></html>'), /canonical/);
});

test('every popular spot has a link-preview card of its own (node art/share/render.mjs makes them)', async () => {
    const { access } = await import('node:fs/promises');
    for (const { href } of links) {
        const slug = href.split('/').pop();
        await access(new URL(`../og/${slug}.jpg`, import.meta.url)).catch(() => assert.fail(`og/${slug}.jpg is missing`));
    }
});

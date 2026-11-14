import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
    coordinateName, formatCoord, inCoverage, nameFromSlug, parsePlacePath, placeHref, placeMeta, placeName, readPlaceUrl, slugify,
} from '../js/core/place-url.js';
import { placePage } from '../functions/fishing/[[path]].js';
import { redirectTarget } from '../functions/_middleware.js';

const at = (href) => new URL(href, 'https://howsthebite.io');

test('coordinates are written with at most 2 decimals, no trailing zeros and no negative zero', () => {
    assert.equal(formatCoord(35.596), '35.6');
    assert.equal(formatCoord(-82.551), '-82.55');
    assert.equal(formatCoord(40), '40');
    assert.equal(formatCoord(-0.001), '0');
});

test('names become lower-case, hyphenated, ASCII slugs of bounded length', () => {
    assert.equal(slugify('Asheville, North Carolina'), 'asheville-north-carolina');
    assert.equal(slugify("Coeur d'Alene, Idaho"), 'coeur-dalene-idaho');
    assert.equal(slugify('Lac Vieux Désert, Michigan'), 'lac-vieux-desert-michigan');
    assert.equal(slugify('Bass & Bluegill Pond'), 'bass-and-bluegill-pond');
    assert.equal(slugify('  --  '), '');
    const long = slugify('Very '.repeat(40));
    assert.ok(long.length <= 80 && !long.endsWith('-'), long);
});

test("the app's own place names come back from their slugs unchanged", () => {
    for (const name of [
        'Asheville, North Carolina', 'Lake Norman, North Carolina', 'Lake of the Ozarks, Missouri',
        'French Broad River, North Carolina', 'Charleston, West Virginia', 'Washington, District of Columbia',
        'McHenry, Illinois', 'Chicago, Illinois',
    ]) {
        assert.equal(nameFromSlug(slugify(name)), name);
    }
    // Punctuation cannot be recovered from a slug...
    assert.equal(nameFromSlug(slugify('St. Louis, Missouri')), 'St Louis, Missouri');
    assert.equal(coordinateName(35.6, -82.55), '35.6°N, 82.55°W');
});

test('...so the exact name rides along in the address only when it is needed', () => {
    assert.equal(placeHref({ lat: 35.60095, lon: -82.55402, name: 'Asheville, North Carolina' }), '/fishing/35.6,-82.55/asheville-north-carolina');
    assert.equal(placeHref({ lat: 38.627, lon: -90.199, name: 'St. Louis, Missouri' }),
        '/fishing/38.63,-90.2/st-louis-missouri?name=St.+Louis%2C+Missouri');
    assert.equal(placeHref({ lat: 35.592, lon: -80.933, name: 'Lake Norman, North Carolina', kind: 'lake' }, { mode: 'fresh', fish: 'warm' }),
        '/fishing/35.59,-80.93/lake-norman-north-carolina?water=lake&mode=fresh&fish=warm');
    assert.equal(placeHref({ lat: 35.6, lon: -82.55, name: '' }), '/fishing/35.6,-82.55');
});

test('an address and the place it names round-trip', () => {
    for (const place of [
        { lat: 35.6, lon: -82.55, name: 'Asheville, North Carolina' },
        { lat: 38.63, lon: -90.2, name: 'St. Louis, Missouri' },
        { lat: 35.59, lon: -80.93, name: 'Lake Norman, North Carolina', kind: 'lake' },
        { lat: 61.22, lon: -149.9, name: 'Anchorage, Alaska' },
    ]) {
        assert.deepEqual(readPlaceUrl(at(placeHref(place))).place, place);
    }
});

test('a near-miss address is mapped to its canonical form', () => {
    assert.equal(parsePlacePath('/fishing/35.600,-82.55/Asheville-North-Carolina/').canonical, '/fishing/35.6,-82.55/asheville-north-carolina');
    assert.equal(parsePlacePath('/fishing/35.60095,-82.55402/Asheville%2C%20NC').canonical, '/fishing/35.6,-82.55/asheville-nc');
    assert.equal(parsePlacePath('/fishing/35.6,-82.55').canonical, '/fishing/35.6,-82.55');
});

test('addresses that cannot name a place are rejected', () => {
    for (const path of [
        '/fishing/', '/fishing/asheville', '/fishing/91,0/x', '/fishing/0,181/x', '/fishing/1,2,3/x',
        '/fishing/1,2/x/y', '/fishing/1e3,2/x', '/fishing/,/x', '/fishing/1,2/%E0%A4%A', '/other/1,2/x',
    ]) {
        assert.equal(parsePlacePath(path), null, path);
    }
});

test('a name in the query is used only when it matches the slug', () => {
    const parsed = parsePlacePath('/fishing/38.63,-90.2/st-louis-missouri');
    assert.equal(placeName(parsed, 'St. Louis, Missouri'), 'St. Louis, Missouri');
    assert.equal(placeName(parsed, 'Cheap tackle, click here'), 'St Louis, Missouri');
    assert.equal(placeName(parsed, null), 'St Louis, Missouri');
    assert.equal(placeName(parsePlacePath('/fishing/35.6,-82.55'), null), '35.6°N, 82.55°W');
});

test('choices in the query are read only when they are real ones', () => {
    assert.deepEqual(readPlaceUrl(at('/?section=forecast')), { place: null, invalid: false, mode: null, freshFish: null, saltFish: null });
    assert.equal(readPlaceUrl(at('/fishing/999,1/x')).invalid, true);
    const linked = readPlaceUrl(at('/fishing/35.6,-82.55/asheville-north-carolina?mode=inshore&fish=cold&water=pond'));
    assert.equal(linked.mode, 'inshore');
    assert.equal(linked.freshFish, 'cold');
    assert.equal(linked.saltFish, null);
    assert.equal(linked.place.kind, undefined);
    assert.equal(readPlaceUrl(at('/fishing/29.3,-94.8/galveston-texas?fish=warmsalt')).saltFish, 'warmsalt');
    assert.equal(readPlaceUrl(at('/fishing/29.3,-94.8/galveston-texas?mode=deep-sea&fish=shark')).mode, null);
});

test('coverage is the United States and its territories, roughly', () => {
    for (const [lat, lon] of [[35.6, -82.55], [61.22, -149.9], [21.31, -157.86], [18.47, -66.11], [13.47, 144.75], [25.76, -80.19]]) {
        assert.ok(inCoverage(lat, lon), `${lat},${lon}`);
    }
    for (const [lat, lon] of [[51.5, -0.12], [-33.87, 151.21], [19.43, -99.13], [0, 0]]) {
        assert.ok(!inCoverage(lat, lon), `${lat},${lon}`);
    }
});

test('the server redirects near-misses (keeping shared choices), 404s nonsense and noindexes places it has no data for', () => {
    assert.deepEqual(placePage(at('/fishing')), { redirect: '/' });
    assert.deepEqual(placePage(at('/fishing/35.600,-82.55/Asheville-North-Carolina/?fish=cold')),
        { redirect: '/fishing/35.6,-82.55/asheville-north-carolina?fish=cold' });
    assert.deepEqual(placePage(at('/fishing/999,0/x')), { notFound: true });
    assert.deepEqual(placePage(at('/fishing/35.6,-82.55/asheville-north-carolina')),
        { path: '/fishing/35.6,-82.55/asheville-north-carolina', name: 'Asheville, North Carolina', indexable: true });
    assert.equal(placePage(at('/fishing/51.5,-0.12/london')).indexable, false);
    assert.equal(placePage(at('/fishing/38.63,-90.2/st-louis-missouri?name=St.+Louis%2C+Missouri')).name, 'St. Louis, Missouri');
});

test('page titles and descriptions name the place', () => {
    const meta = placeMeta('Lake Norman, North Carolina');
    assert.equal(meta.title, "Lake Norman, North Carolina Fishing Forecast — How's the Bite?");
    assert.match(meta.description, /^Fishing forecast for Lake Norman, North Carolina: /);
    assert.ok(meta.description.length <= 200, meta.description);
});

test('index.html still has every element the place pages rewrite', async () => {
    // functions/fishing/[[path]].js finds these with HTMLRewriter; if one goes missing, place
    // pages silently lose their title, description or canonical address in search results.
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    for (const pattern of [
        /<title>[^<]+<\/title>/, /<meta name="description" content="[^"]+">/, /<link rel="canonical" href="https:\/\/[^"]+\/">/,
        /<meta property="og:url" content="https:\/\/[^"]+\/">/, /<meta property="og:title" content="[^"]+">/,
        /<meta property="og:description" content="[^"]+">/, /<h1 id="locationName">/,
    ]) {
        assert.match(html, pattern);
    }
    // Relative paths would resolve under /fishing/… and fail to load there.
    assert.deepEqual(html.match(/(?:href|src)="(?!\/|#|https?:)[^"]*"/g), null);
});

test('place pages on the old address are redirected too, though they end in a coordinate', () => {
    const request = new Request('https://howsthebite.pages.dev/fishing/35.6,-82.55', { headers: { 'sec-fetch-mode': 'navigate' } });
    assert.equal(redirectTarget(request), 'https://howsthebite.io/fishing/35.6,-82.55');
});

// Addresses for places, shared by the app and the Pages Function that serves them
// (functions/fishing/[[path]].js). No DOM access in here.
//
//   /fishing/35.6,-82.55/asheville-north-carolina
//   /fishing/35.59,-80.93/lake-norman-north-carolina?water=lake&mode=inshore&fish=warmsalt
//
// - The coordinates identify the place. They are rounded to 2 decimals (about 1 km): a
//   shared link does not give away anyone's exact position, nearby copies of the same
//   place share one address, and it matches the key the app files places under.
// - The slug is the name, readable in the address and in search results. It is turned
//   back into a name for whoever opens the link ("Asheville, North Carolina"). When that
//   would come out wrong ("St. Louis", "McHenry") the exact name rides along in `name`.
// - `water`, `mode` and `fish` carry the choices behind the score, so a friend sees the
//   same one. They are not part of the canonical address.

import { US_STATES } from '../config.js';
import { GROUP_IDS, SALT_GROUP_IDS } from './species.js';

export const PLACE_PREFIX = '/fishing/';
const MAX_NAME = 80;
const MAX_SLUG = 80;

/** Coordinates as they appear in an address: 2 decimals, no trailing zeros, never "-0". */
export const formatCoord = (value) => String(Number(value.toFixed(2)) || 0);

/** "Coeur d'Alene, Idaho" -> "coeur-dalene-idaho". Never longer than MAX_SLUG; may be ''. */
export function slugify(name) {
    const slug = String(name ?? '')
        .normalize('NFKD').replace(/[̀-ͯ]/g, '') // é -> e
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (slug.length <= MAX_SLUG) return slug;
    const cut = slug.slice(0, MAX_SLUG + 1);
    return cut.slice(0, cut.lastIndexOf('-') > 0 ? cut.lastIndexOf('-') : MAX_SLUG);
}

/** A name from the address bar or the network, made safe to show: one line, no control characters, not too long. */
export function cleanName(name) {
    return String(name ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

// Full state names as slugs, longest first so "west-virginia" wins over "virginia".
const STATE_SLUGS = Object.values(US_STATES)
    .map((name) => [slugify(name), name])
    .sort((a, b) => b[0].length - a[0].length);
const SMALL_WORDS = new Set(['of', 'the', 'and', 'at', 'on', 'in', 'by', 'to', 'de', 'du', 'la', 'le']);

const titleWord = (word, index) => {
    if (index > 0 && SMALL_WORDS.has(word)) return word;
    if (/^mc[a-z]/.test(word)) return `Mc${word.charAt(2).toUpperCase()}${word.slice(3)}`;
    return word.charAt(0).toUpperCase() + word.slice(1);
};
const titleCase = (slug) => slug.split('-').filter(Boolean).map(titleWord).join(' ');

/** "lake-of-the-ozarks-missouri" -> "Lake of the Ozarks, Missouri". The app's own names always end in a state. */
export function nameFromSlug(slug) {
    for (const [stateSlug, stateName] of STATE_SLUGS) {
        if (slug.endsWith(`-${stateSlug}`)) return `${titleCase(slug.slice(0, -stateSlug.length - 1))}, ${stateName}`;
    }
    return titleCase(slug);
}

/** "35.6°N, 82.55°W": the name of a place whose address has no slug. */
export function coordinateName(lat, lon) {
    const part = (value, positive, negative) => `${formatCoord(Math.abs(value))}°${value < 0 ? negative : positive}`;
    return `${part(lat, 'N', 'S')}, ${part(lon, 'E', 'W')}`;
}

/** The canonical path for a place. */
export function placePath({ lat, lon, name }) {
    const slug = slugify(name);
    return `${PLACE_PREFIX}${formatCoord(lat)},${formatCoord(lon)}${slug ? `/${slug}` : ''}`;
}

/**
 * The full address for a place: its path, plus `name` when the slug alone would not give
 * the name back, plus the choices that shape the score.
 * @param {{ lat: number, lon: number, name: string, kind?: string }} place
 * @param {{ mode?: string|null, fish?: string|null }} [choices]
 */
export function placeHref(place, { mode = null, fish = null } = {}) {
    const params = new URLSearchParams();
    const slug = slugify(place.name);
    if (slug && nameFromSlug(slug) !== place.name && cleanName(place.name) === place.name) params.set('name', place.name);
    if (place.kind === 'lake' || place.kind === 'river') params.set('water', place.kind);
    if (mode) params.set('mode', mode);
    if (fish) params.set('fish', fish);
    const query = params.toString();
    return placePath(place) + (query ? `?${query}` : '');
}

const COORD = /^-?\d{1,3}(?:\.\d{1,8})?$/;

/**
 * Read a place address. Null when the path is not a place address or names an impossible place.
 * `canonical` is the path it should have been (rounded coordinates, a clean slug); when it
 * differs from what was asked for, the server redirects to it.
 * @returns {null | { lat: number, lon: number, slug: string, canonical: string }}
 */
export function parsePlacePath(pathname) {
    if (!pathname.startsWith(PLACE_PREFIX)) return null;
    const [coords, rawSlug = '', ...extra] = pathname.slice(PLACE_PREFIX.length).split('/');
    if (extra.some(Boolean)) return null;
    const [latText, lonText, ...more] = (coords ?? '').split(',');
    if (more.length || !COORD.test(latText ?? '') || !COORD.test(lonText ?? '')) return null;
    const lat = Number(Number(latText).toFixed(2));
    const lon = Number(Number(lonText).toFixed(2));
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    let slug;
    try {
        slug = slugify(decodeURIComponent(rawSlug));
    } catch {
        return null; // malformed %-escapes
    }
    return { lat: lat || 0, lon: lon || 0, slug, canonical: `${PLACE_PREFIX}${formatCoord(lat)},${formatCoord(lon)}${slug ? `/${slug}` : ''}` };
}

/** The name to show for a parsed address: `name` from the query when it matches the slug, else one rebuilt from the slug. */
export function placeName(parsed, nameParam) {
    const given = cleanName(nameParam);
    if (given && slugify(given) === parsed.slug) return given;
    return parsed.slug ? nameFromSlug(parsed.slug) : coordinateName(parsed.lat, parsed.lon);
}

/**
 * Where the National Weather Service has forecasts, roughly: the lower 48, Alaska, Hawaii,
 * Puerto Rico and the Virgin Islands, Guam and the Northern Marianas. Generous boxes; the app
 * itself says when a spot has no data. Used to keep pages for impossible places out of search.
 */
const COVERAGE = [
    [-125.0, 24.3, -66.8, 49.5], // lower 48
    [-180.0, 51.0, -129.9, 71.6], // Alaska
    [172.0, 51.0, 180.0, 53.1], // the far Aleutians
    [-160.6, 18.8, -154.6, 22.4], // Hawaii
    [-67.4, 17.5, -64.4, 18.6], // Puerto Rico and the Virgin Islands
    [144.5, 13.1, 146.1, 20.6], // Guam and the Northern Marianas
];
export const inCoverage = (lat, lon) => COVERAGE.some(([w, s, e, n]) => lon >= w && lon <= e && lat >= s && lat <= n);

/**
 * Title and descriptions for a place's page; the same words in the page and in link previews.
 * @param {string} name
 * @param {{ ownSensor?: boolean }} [about]  the place has a water-temperature sensor of its own
 *   (core/listed-places.js). Only then do the title and description promise a water
 *   temperature: elsewhere the reading is the nearest sensor's, which may be on other water.
 */
export function placeMeta(name, { ownSensor = false } = {}) {
    return {
        // What people search for, in their words. Search results cut a long title short from
        // the end, so the site's name goes last.
        title: `${name} Fishing Forecast${ownSensor ? ' & Water Temperature' : ''} Today — How's the Bite?`,
        // Search results show about 155 characters, so the place and the point come first. Once
        // the conditions have loaded the app replaces this with the day's numbers (core/summary.js).
        description: ownSensor
            ? `${name} fishing forecast and water temperature today: a 0–100 score and the best `
                + 'two hours to fish, from the sensor on the water, wind, weather and tides, with lure picks.'
            : `${name} fishing forecast today: a 0–100 score and the best two hours to fish, `
                + 'from live weather, wind, tides and the nearest water sensors, with lure picks.',
        ogTitle: `${name} fishing forecast — How's the Bite?`,
        ogDescription: `How's the bite at ${name}? A 0–100 fishing score with the best times to fish today and the next two days.`,
    };
}

/**
 * Headings of the weather and water sections. For a named place they carry its name without
 * the state ("Lake Champlain 5-day weather"): that is how people search for them, and it says
 * whose weather this is to someone who landed half-way down the page. The water is called the
 * place's own only where it has a sensor of its own; elsewhere the readings are from nearby.
 * The same words go into the page as it is served (functions/fishing/[[path]].js).
 * @param {string|null} [name]  "Lake Champlain, Vermont", or null for no place in particular
 * @param {{ ownSensor?: boolean }} [about]
 */
export function sectionHeadings(name = null, { ownSensor = false } = {}) {
    const place = name ? name.split(',')[0].trim() : '';
    const lead = (text) => (place ? `${place} ${text.charAt(0).toLowerCase()}${text.slice(1)}` : text);
    const water = 'Water temperature, level and flow';
    return {
        weather: lead('5-day weather'),
        water: !place ? water : ownSensor ? lead(water) : `${water} near ${place}`,
        tides: lead('Tides and water temperature'),
    };
}

const FRESH_FISH = new Set(['any', ...GROUP_IDS]);
const SALT_FISH = new Set(SALT_GROUP_IDS);
const MODES = new Set(['fresh', 'inshore', 'surf']);

/**
 * Everything a page address says, for the app. `place` is null when the address names no
 * place (the home page) and `invalid` is true when it tried to and failed.
 * @param {URL|Location} url
 */
export function readPlaceUrl(url) {
    const params = new URLSearchParams(url.search);
    const mode = params.get('mode');
    const fish = params.get('fish');
    const choices = {
        mode: MODES.has(mode) ? mode : null,
        freshFish: FRESH_FISH.has(fish) ? fish : null,
        saltFish: SALT_FISH.has(fish) ? fish : null,
    };
    if (!url.pathname.startsWith(PLACE_PREFIX)) return { place: null, invalid: false, ...choices };
    const parsed = parsePlacePath(url.pathname);
    if (!parsed) return { place: null, invalid: true, ...choices };
    const place = { lat: parsed.lat, lon: parsed.lon, name: placeName(parsed, params.get('name')) };
    const water = params.get('water');
    if (water === 'lake' || water === 'river') place.kind = water;
    return { place, slug: parsed.slug, invalid: false, ...choices };
}

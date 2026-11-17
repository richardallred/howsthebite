// "Nearby water": the lakes, rivers and salt water around a town, offered so a tap gives the
// score and gauges for that water rather than the town. Each kind has its own places in the
// row, so a run of small creeks can never push out the lakes, or the lakes the bay.
//
// - Lakes and reservoirs come from a bundled list of the US lakes that have a Wikipedia
//   article (data/lakes.json, from Wikidata): the best-known, weighed against distance.
// - Rivers come from the USGS gauges the page has already found: the biggest by the flow
//   they carry, each placed at its nearest gauge, whose level and flow the score then uses.
// - Salt water comes from the bundled NOAA tide-station list: the bays, sounds, harbors and
//   inlets the stations are named for, each opened in inshore mode at its nearest station.

import { distanceMiles } from './util.js';

export const NEARBY_RADIUS_MI = 25;
export const PER_CATEGORY = 2;

const KM_PER_MI = 1.609344;

// ----- Lakes ---------------------------------------------------------------------------------

/**
 * The lakes worth offering around a point, from data/lakes.json rows
 * [name, lat, lon, sitelinks, km²]: the best-known first, weighed against distance.
 * A lake with a known area is measured to its edge (as a circle of that area), and a big one
 * is placed on the town's side of it rather than at its middle.
 * Each is { name, lat, lon, kind: 'lake', miles, detail }.
 */
export function lakesNear(rows, lat, lon, { radiusMi = NEARBY_RADIUS_MI, count = PER_CATEGORY } = {}) {
    const found = [];
    for (const [name, la, lo, links, km2] of rows ?? []) {
        if (Math.abs(la - lat) > 3 || Math.abs(lo - lon) > 4) continue; // quick reject: nothing that far reaches the town
        const centre = distanceMiles(lat, lon, la, lo);
        const reach = km2 > 0 ? Math.sqrt(km2 / Math.PI) / KM_PER_MI : 0;
        const miles = Math.max(0, centre - reach);
        if (miles > radiusMi) continue;
        let at = { lat: la, lon: lo };
        if (reach > 1 && centre > reach) { // well inside the near shore, on the town's side
            const f = (reach * 0.8) / centre;
            at = { lat: la + (lat - la) * f, lon: lo + (lon - lo) * f };
        }
        found.push({ name, ...at, kind: 'lake', miles, links, detail: km2 > 0 ? `${Math.round(km2 * 247.1).toLocaleString('en-US')} acres` : '' });
    }
    // More Wikipedias writing about a lake means more people know it; a few miles' drive is
    // worth it for the lake everyone means.
    const weight = (lake) => (1 + Math.log2(lake.links)) / (1 + lake.miles / 10);
    return found
        .sort((a, b) => weight(b) - weight(a))
        .slice(0, count)
        .map(({ links, ...lake }) => lake);
}

// ----- Rivers --------------------------------------------------------------------------------

const PLACE_WORDS = /\s+(?:at|near|nr|below|blw|above|abv|in|upstream|downstream|@|off)\s+.*$/i;

/**
 * The river a gauge is on, from its name: "French Broad River at Asheville, NC" ->
 * "French Broad River", "Pigeon R near Canton" -> "Pigeon River"; null for creeks, lakes
 * and canals, and for "Waller Creek at Red River", which is on the creek.
 */
export function riverName(stationName) {
    const water = String(stationName ?? '').replace(/,.*$/, '').replace(PLACE_WORDS, '').trim();
    const match = /^(.+?)\s+(?:River|R\.?)$/.exec(water);
    return match ? `${match[1].trim()} River` : null;
}

/**
 * The rivers with a gauge near a point, biggest first: by the most flow measured on any of
 * their gauges here, then by how many gauges they have. Each is placed at its nearest gauge.
 */
export function riversFromStations(stations, lat, lon, { radiusMi = NEARBY_RADIUS_MI, count = PER_CATEGORY } = {}) {
    const byName = new Map();
    for (const station of stations ?? []) {
        if (station.kind !== 'river') continue;
        const name = riverName(station.name);
        if (!name) continue;
        const miles = distanceMiles(lat, lon, station.lat, station.lon);
        if (miles > radiusMi) continue;
        const key = name.toLowerCase();
        const river = byName.get(key) ?? { name, kind: 'river', cfs: 0, gauges: 0, miles: Infinity, detail: '' };
        river.gauges += 1;
        river.cfs = Math.max(river.cfs, station.flow?.cfs ?? 0);
        if (miles < river.miles) Object.assign(river, { lat: station.lat, lon: station.lon, miles, detail: `gauge: ${station.name}` });
        byName.set(key, river);
    }
    return [...byName.values()]
        .sort((a, b) => b.cfs - a.cfs || b.gauges - a.gauges || a.miles - b.miles)
        .slice(0, count)
        .map(({ cfs, gauges, ...river }) => river);
}

// ----- Salt water ----------------------------------------------------------------------------

const SALT_BODY = /([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*)*\s+(?:Bay|Sound|Harbor|Harbour|Inlet|Lagoon))\b/;

/**
 * The bay, sound, harbor or inlet a tide station is named for: "Gandy Bridge, Old Tampa Bay"
 * -> "Old Tampa Bay", "McKay Bay Entrance" -> "McKay Bay"; null for "Fort Sumter".
 * The water is usually named after the comma, so the last part that names one wins.
 */
export function saltWaterName(stationName) {
    const parts = String(stationName ?? '').split(',').reverse();
    for (const part of parts) {
        const match = SALT_BODY.exec(part.trim());
        if (match) return match[1];
    }
    return null;
}

/**
 * The salt water around a point, from the tide stations ([id, name, lat, lon, flags] rows,
 * flag 1 = tide predictions): the bays and sounds with the most stations first (the big
 * water), each placed at its nearest station and opened in inshore mode.
 */
export function saltWaterNear(rows, lat, lon, { radiusMi = NEARBY_RADIUS_MI, count = PER_CATEGORY } = {}) {
    const byName = new Map();
    for (const [, station, la, lo, flags] of rows ?? []) {
        if (!(flags & 1) || Math.abs(la - lat) > 1 || Math.abs(lo - lon) > 1.5) continue;
        const name = saltWaterName(station);
        if (!name) continue;
        const miles = distanceMiles(lat, lon, la, lo);
        if (miles > radiusMi) continue;
        const key = name.toLowerCase();
        const water = byName.get(key) ?? { name, kind: 'salt', mode: 'inshore', stations: 0, miles: Infinity, detail: '' };
        water.stations += 1;
        if (miles < water.miles) Object.assign(water, { lat: la, lon: lo, miles, detail: `tide station: ${station}` });
        byName.set(key, water);
    }
    return [...byName.values()]
        .sort((a, b) => b.stations - a.stations || a.miles - b.miles)
        .slice(0, count)
        .map(({ stations, ...water }) => water);
}

// ----- The row -------------------------------------------------------------------------------

export const CATEGORIES = [
    { id: 'lake', label: 'Lakes' },
    { id: 'river', label: 'Rivers' },
    { id: 'salt', label: 'Salt water' },
];

/**
 * The groups for a town, in the order lakes, rivers, salt water, leaving out any kind there
 * is none of; each place nearest first, named with the town's state ("Lake Julian, North
 * Carolina") the way a search for it would be, with distances in whole miles.
 */
export function nearbyWater({ lakes = [], rivers = [], salt = [], state = '' }) {
    const lists = { lake: lakes, river: rivers, salt };
    return CATEGORIES
        .map(({ id, label }) => ({
            id,
            label,
            places: [...lists[id]].sort((a, b) => a.miles - b.miles).map((place) => ({
                ...place,
                label: place.name,
                name: state ? `${place.name}, ${state}` : place.name,
                miles: Math.max(1, Math.round(place.miles)),
            })),
        }))
        .filter((group) => group.places.length);
}

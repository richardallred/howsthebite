// "Nearby water": the best-known lakes and rivers around a town, offered so a tap gives the
// score and gauges for that water rather than the town.
//
// Lakes come from the USGS National Hydrography Dataset (the named lakes and reservoirs in a
// box around the town, biggest first, outlines simplified to a few hundred metres). Each is
// placed at its shore nearest the town, which is also where its outline is found again for
// "Where to look". Rivers come from the USGS gauges the page has already found: a gauged
// river is the one whose level and flow the score can use.

import { NHD } from './lake-shape.js';
import { boundingBox, distanceMiles } from './util.js';

export const NEARBY_RADIUS_MI = 25;
const LAKE_MIN_KM2 = 0.1; // about 25 acres: leaves out the subdivision and farm ponds
const NHD_LAKE_TYPES = { 390: 'Lake', 436: 'Reservoir' };
const PER_KIND = 3;

/** The NHD query for the named lakes and reservoirs around a point, biggest first. */
export function nearbyLakesUrl(lat, lon) {
    const params = new URLSearchParams({
        where: `gnis_name IS NOT NULL AND ftype IN (390,436) AND areasqkm >= ${LAKE_MIN_KM2}`,
        geometry: boundingBox(lat, lon, NEARBY_RADIUS_MI).map((v) => v.toFixed(3)).join(','),
        geometryType: 'esriGeometryEnvelope',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: 'gnis_name,ftype,areasqkm',
        orderByFields: 'areasqkm DESC',
        resultRecordCount: '25',
        returnGeometry: 'true',
        outSR: '4326',
        maxAllowableOffset: '0.003',
        geometryPrecision: '4',
        f: 'json',
    });
    return `${NHD}?${params}`;
}

const field = (attributes, name) => attributes?.[name] ?? attributes?.[name.toUpperCase()];

/**
 * The lakes worth offering from an NHD answer: one per name, at the shore nearest the point,
 * the biggest (weighed against how far away they are) first. Each is
 * { name, detail, lat, lon, kind: 'lake', miles }; `name` is the bare name.
 */
export function lakesFromNhd(answer, lat, lon, { radiusMi = NEARBY_RADIUS_MI } = {}) {
    const byName = new Map();
    for (const feature of answer?.features ?? []) {
        const name = String(field(feature.attributes, 'gnis_name') ?? '').trim();
        const type = NHD_LAKE_TYPES[Number(field(feature.attributes, 'ftype'))];
        const km2 = Number(field(feature.attributes, 'areasqkm')) || 0;
        if (!name || /^noname$/i.test(name) || !type) continue;

        let shore = null;
        for (const ring of feature.geometry?.rings ?? []) {
            for (const [x, y] of ring) {
                const miles = distanceMiles(lat, lon, y, x);
                if (!shore || miles < shore.miles) shore = { lat: y, lon: x, miles };
            }
        }
        if (!shore || shore.miles > radiusMi) continue;

        const known = byName.get(name.toLowerCase());
        if (known && known.km2 >= km2) continue;
        byName.set(name.toLowerCase(), { name, type, km2, ...shore });
    }
    // A big lake a few miles further off is still the one people mean.
    const weight = (lake) => Math.sqrt(lake.km2) / (1 + lake.miles / 10);
    return [...byName.values()]
        .sort((a, b) => weight(b) - weight(a))
        .slice(0, PER_KIND)
        .map(({ name, type, km2, lat: la, lon: lo, miles }) => ({
            name,
            detail: `${type} · ${Math.round(km2 * 247.1).toLocaleString('en-US')} acres`,
            lat: la,
            lon: lo,
            kind: 'lake',
            miles,
        }));
}

/**
 * "French Broad River at Asheville, NC" -> "French Broad River", "Pigeon R near Canton" ->
 * "Pigeon River"; null for creeks, canals and lakes.
 */
export function riverName(stationName) {
    const match = /^(.+?)\s+(?:River|R\.?)(?=\s|$)/.exec(String(stationName ?? '').replace(/,.*$/, ''));
    return match ? `${match[1].trim()} River` : null;
}

/**
 * The rivers with a gauge near a point, nearest first: each at its nearest gauge, so
 * picking it uses that gauge's level and flow.
 */
export function riversFromStations(stations, lat, lon, { radiusMi = NEARBY_RADIUS_MI } = {}) {
    const byName = new Map();
    for (const station of stations ?? []) {
        if (station.kind !== 'river') continue;
        const name = riverName(station.name);
        if (!name) continue;
        const miles = distanceMiles(lat, lon, station.lat, station.lon);
        if (miles > radiusMi) continue;
        const known = byName.get(name.toLowerCase());
        if (known && known.miles <= miles) continue;
        byName.set(name.toLowerCase(), { name, detail: `River · gauge ${station.name}`, lat: station.lat, lon: station.lon, kind: 'river', miles });
    }
    return [...byName.values()].sort((a, b) => a.miles - b.miles).slice(0, PER_KIND);
}

/**
 * The chips for a town: lakes then rivers, each nearest first, named with the town's state
 * ("Lake Julian, North Carolina") the way a search for them would be. Distances are whole miles.
 */
export function nearbyWater({ lakes = [], rivers = [], state = '' }) {
    const byDistance = (a, b) => a.miles - b.miles;
    return [...[...lakes].sort(byDistance), ...rivers].map((place) => ({
        ...place,
        label: place.name,
        name: state ? `${place.name}, ${state}` : place.name,
        miles: Math.max(1, Math.round(place.miles)),
    }));
}

// The outline of a lake, made small enough to send to a phone: from the USGS National
// Hydrography Dataset (below), or from OpenStreetMap when that fails.
//
// OpenStreetMap maps lakes and reservoirs as areas tagged natural=water. A small lake is one
// closed way; a big reservoir is a relation of dozens or hundreds of ways that have to be
// joined end to end into rings: the outer shoreline, and one inner ring for each island.
// The Overpass API finds them with no key, but a big reservoir comes back as megabytes of
// points (Lake Norman, NC: about 3 MB), so the outline is simplified to a few thousand
// points before it is used. functions/api/lake.js does this once and caches the answer;
// without that proxy the browser does it itself (see js/api/lake-api.js).
//
// Used on both sides, so nothing here touches the DOM or the network.

export const OVERPASS = 'https://overpass-api.de/api/interpreter';

/** Kinds of water that are lakes for this purpose: not rivers, canals or treatment ponds. */
const STILL = new Set([undefined, 'lake', 'reservoir', 'pond', 'oxbow', 'lagoon', 'basin', 'lock']);
const NEAR_M = 400; // a place on the bank still finds the lake beside it
const MAX_SPAN_DEG = 1.2; // larger than this (the Great Lakes, Lake Okeechobee's whole system) is open water, not a lake to map
const MAX_POINTS = 4000;

const round = (value) => Math.round(value * 1e5) / 1e5;

/** Step 1: which water areas are at or right beside a point, with their tags and bounds only. */
export function lookupQuery(lat, lon) {
    const at = `${lat.toFixed(5)},${lon.toFixed(5)}`;
    return `[out:json][timeout:25];is_in(${at})->.a;`
        + '(way(pivot.a)[natural=water];rel(pivot.a)[natural=water];)->.in;'
        + `(way(around:${NEAR_M},${at})[natural=water];rel(around:${NEAR_M},${at})[natural=water];)->.near;`
        + '(.in;.near;);out tags bb;';
}

/** Step 2: the full geometry of one of them. */
export function geometryQuery({ type, id }) {
    return `[out:json][timeout:60];${type === 'relation' ? 'rel' : 'way'}(${id});out geom;`;
}

const spanOf = (bounds) => (bounds ? Math.max(bounds.maxlat - bounds.minlat, bounds.maxlon - bounds.minlon) : 0);

/**
 * The candidates from a lookup answer, best first: still water of a size worth mapping.
 * @returns {{ type: string, id: number, name: string|null, span: number }[]}
 */
export function lakeCandidates(elements) {
    return (elements ?? [])
        .filter((e) => (e.type === 'way' || e.type === 'relation') && e.tags?.natural === 'water' && STILL.has(e.tags.water))
        .map((e) => ({ type: e.type, id: e.id, name: e.tags.name ?? null, span: spanOf(e.bounds), bounds: e.bounds }))
        .filter((c) => c.span > 0.002 && c.span <= MAX_SPAN_DEG) // about 200 m: smaller is a pond
        // Bigger first: the lake itself, not a marina basin or a pond on its shore. Named beats unnamed.
        .sort((a, b) => Number(Boolean(b.name)) - Number(Boolean(a.name)) || b.span - a.span);
}

/** Whether a lookup found water too big to map (only), so the caller can say so. */
export const tooBig = (elements) => (elements ?? []).some((e) => e.tags?.natural === 'water' && spanOf(e.bounds) > MAX_SPAN_DEG);

// ----- Joining ways into rings ------------------------------------------------------------

const sameNode = (a, b) => a.lat === b.lat && a.lon === b.lon;

/** Join open lines end to end into closed rings. Lines that never close are dropped. */
export function joinRings(lines) {
    const pool = lines.filter((line) => line?.length >= 2).map((line) => line.slice());
    const rings = [];
    while (pool.length) {
        let ring = pool.pop();
        let grew = true;
        while (!sameNode(ring[0], ring[ring.length - 1]) && grew) {
            grew = false;
            const end = ring[ring.length - 1];
            for (let i = 0; i < pool.length; i += 1) {
                const line = pool[i];
                if (sameNode(line[0], end)) ring = ring.concat(line.slice(1));
                else if (sameNode(line[line.length - 1], end)) ring = ring.concat(line.slice(0, -1).reverse());
                else continue;
                pool.splice(i, 1);
                grew = true;
                break;
            }
        }
        if (sameNode(ring[0], ring[ring.length - 1]) && ring.length >= 4) rings.push(ring);
    }
    return rings;
}

// ----- Simplifying -------------------------------------------------------------------------

/** A flat projection in metres around a latitude: plenty for one lake. */
export function projector(lat0, lon0) {
    const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
    const ky = 110540;
    return {
        toXY: ([lat, lon]) => [(lon - lon0) * kx, (lat - lat0) * ky],
        toLatLon: ([x, y]) => [round(lat0 + y / ky), round(lon0 + x / kx)],
    };
}

export function ringArea(xy) {
    let sum = 0;
    for (let i = 0, j = xy.length - 1; i < xy.length; j = i, i += 1) sum += xy[j][0] * xy[i][1] - xy[i][0] * xy[j][1];
    return sum / 2; // positive: anticlockwise
}

function segmentDistance(p, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length2 = dx * dx + dy * dy;
    const t = length2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2)) : 0;
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas–Peucker on a closed ring (first point repeated at the end), in metres. */
export function simplifyRing(xy, tolerance) {
    if (xy.length <= 4) return xy;
    const keep = new Uint8Array(xy.length);
    keep[0] = 1;
    keep[xy.length - 1] = 1;
    // A closed ring has no natural ends: split it at the point farthest from the start.
    let far = 0;
    let farDistance = -1;
    for (let i = 1; i < xy.length - 1; i += 1) {
        const d = Math.hypot(xy[i][0] - xy[0][0], xy[i][1] - xy[0][1]);
        if (d > farDistance) [far, farDistance] = [i, d];
    }
    keep[far] = 1;
    const stack = [[0, far], [far, xy.length - 1]];
    while (stack.length) {
        const [from, to] = stack.pop();
        let index = -1;
        let max = tolerance;
        for (let i = from + 1; i < to; i += 1) {
            const d = segmentDistance(xy[i], xy[from], xy[to]);
            if (d > max) [index, max] = [i, d];
        }
        if (index >= 0) {
            keep[index] = 1;
            stack.push([from, index], [index, to]);
        }
    }
    return xy.filter((_, i) => keep[i]);
}

/**
 * A lake from an Overpass `out geom` answer for one way or relation.
 * Rings are [lat, lon] pairs, closed; the outer shorelines first, then islands.
 * @returns {{ id: string, name: string|null, rings: { outer: boolean, coords: number[][] }[] }|null}
 */
export function lakeFromGeometry(element) {
    if (!element) return null;
    let outer = [];
    let inner = [];
    if (element.type === 'way') {
        outer = joinRings([element.geometry ?? []]);
    } else {
        const lines = (role) => (element.members ?? [])
            .filter((m) => m.type === 'way' && (m.role || 'outer') === role && m.geometry?.every(Boolean))
            .map((m) => m.geometry);
        outer = joinRings(lines('outer'));
        inner = joinRings(lines('inner'));
    }
    return shapeLake({ id: `${element.type}/${element.id}`, name: element.tags?.name ?? null, outer, inner });
}

/**
 * Simplify a lake to a few thousand points. Rings are closed lists of { lat, lon }.
 * @returns {{ id: string, name: string|null, rings: { outer: boolean, coords: number[][] }[] }|null}
 */
export function shapeLake({ id, name, outer, inner = [] }) {
    if (!outer.length) return null;

    const all = outer.flat();
    const lat0 = all.reduce((sum, p) => sum + p.lat, 0) / all.length;
    const lon0 = all.reduce((sum, p) => sum + p.lon, 0) / all.length;
    const { toXY, toLatLon } = projector(lat0, lon0);
    const project = (ring) => ring.map((p) => toXY([p.lat, p.lon]));

    const outerXY = outer.map(project);
    const area = outerXY.reduce((sum, ring) => sum + Math.abs(ringArea(ring)), 0);
    const perimeter = outerXY.concat(inner.map(project)).reduce((sum, ring) =>
        sum + ring.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - ring[i - 1][0], p[1] - ring[i - 1][1]) : s), 0), 0);
    // Fine enough to keep the coves of a small pond, coarse enough to keep a big reservoir small.
    let tolerance = Math.max(4, Math.min(80, Math.sqrt(area) / 300, perimeter / 20000));
    const minIsland = Math.max(5000, area * 0.0002); // m²: smaller islands are dropped

    let rings;
    for (;;) {
        rings = [
            ...outerXY.map((xy) => ({ outer: true, xy })),
            ...inner.map(project).filter((xy) => Math.abs(ringArea(xy)) >= minIsland).map((xy) => ({ outer: false, xy })),
        ].map((ring) => ({ ...ring, xy: simplifyRing(ring.xy, tolerance) })).filter((ring) => ring.xy.length >= 4);
        const count = rings.reduce((sum, ring) => sum + ring.xy.length, 0);
        if (count <= MAX_POINTS || tolerance > 400) break;
        tolerance *= 1.5;
    }

    return {
        id,
        name,
        rings: rings.map((ring) => ({ outer: ring.outer, coords: ring.xy.map(toLatLon) })),
    };
}

// ----- The USGS National Hydrography Dataset ------------------------------------------------
//
// NHD maps every US lake and reservoir as a polygon and serves it from an ArcGIS map server
// that allows browsers (CORS), needs no key and can simplify an outline before sending it.
// It is the first choice; Overpass is the fallback when it fails.

export const NHD = 'https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/12/query';
const NHD_NEAR_DEG = 0.003; // about 300 m: a place on the bank still finds the lake beside it
const NHD_LAKES = new Set([390, 436]); // LakePond, Reservoir (not swamp, playa, ice or estuary)
const NHD_MAX_KM2 = 3000; // the Great Lakes are not in this layer; anything near this size is open water

/** The NHD query for the waterbodies at and right beside a point, outlines simplified to about 20 m. */
export function nhdUrl(lat, lon) {
    const d = NHD_NEAR_DEG;
    const params = new URLSearchParams({
        geometry: [lon - d, lat - d, lon + d, lat + d].map((v) => v.toFixed(5)).join(','),
        geometryType: 'esriGeometryEnvelope',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: 'objectid,gnis_name,ftype,areasqkm',
        returnGeometry: 'true',
        outSR: '4326',
        maxAllowableOffset: '0.0002',
        geometryPrecision: '5',
        f: 'json',
    });
    return `${NHD}?${params}`;
}

function pointInRing(lat, lon, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

/**
 * The lake from an NHD answer: the one the point is in, or else the biggest beside it.
 * Esri rings run clockwise around the water and anticlockwise around islands.
 * @returns {{ lake: object|null, reason?: 'none'|'too-big' }}
 */
export function lakeFromNhd(answer, lat, lon) {
    const field = (attributes, name) => attributes?.[name] ?? attributes?.[name.toUpperCase()];
    const lakes = (answer?.features ?? []).filter((f) => NHD_LAKES.has(Number(field(f.attributes, 'ftype'))) && f.geometry?.rings?.length);
    const big = lakes.filter((f) => Number(field(f.attributes, 'areasqkm')) > NHD_MAX_KM2);
    const usable = lakes.filter((f) => !big.includes(f) && Number(field(f.attributes, 'areasqkm')) >= 0.02);
    const containing = (f) => f.geometry.rings.reduce((inside, ring) => inside !== pointInRing(lat, lon, ring), false);
    const best = usable.find(containing)
        ?? usable.sort((a, b) => Number(field(b.attributes, 'areasqkm')) - Number(field(a.attributes, 'areasqkm')))[0];
    if (!best) return { lake: null, reason: big.length ? 'too-big' : 'none' };
    const outer = [];
    const inner = [];
    for (const ring of best.geometry.rings) {
        const nodes = ring.map(([x, y]) => ({ lat: y, lon: x }));
        let sum = 0;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
        (sum < 0 ? outer : inner).push(nodes);
    }
    const name = String(field(best.attributes, 'gnis_name') ?? '').trim() || null;
    const lake = shapeLake({ id: `nhd/${field(best.attributes, 'objectid')}`, name, outer, inner });
    return lake ? { lake } : { lake: null, reason: 'none' };
}

/**
 * Find and shape the lake at a point: NHD first, OpenStreetMap through Overpass if NHD fails.
 * `get(url)` and `post(query)` fetch JSON (an NHD query; an Overpass query); the proxy and the
 * browser each pass their own.
 * @returns {Promise<{ lake: object|null, reason?: 'none'|'too-big', source?: string }>}
 */
export async function findLake(lat, lon, { get, post }) {
    try {
        const answer = await get(nhdUrl(lat, lon));
        if (answer?.error) throw new Error(answer.error.message ?? 'NHD error');
        return { ...lakeFromNhd(answer, lat, lon), source: 'nhd' };
    } catch (error) {
        if (error?.name === 'AbortError') throw error;
    }
    const lookup = await post(lookupQuery(lat, lon));
    const [best] = lakeCandidates(lookup?.elements);
    if (!best) return { lake: null, reason: tooBig(lookup?.elements) ? 'too-big' : 'none', source: 'osm' };
    const shape = await post(geometryQuery(best));
    const element = (shape?.elements ?? []).find((e) => e.type === best.type && e.id === best.id);
    const lake = lakeFromGeometry(element);
    return lake ? { lake, source: 'osm' } : { lake: null, reason: 'none', source: 'osm' };
}

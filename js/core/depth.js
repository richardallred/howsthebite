// Depth contours for the lake map, where a public survey has them.
//
// No one source maps the depth of US lakes. What exists is a patchwork of public map
// services, each for its own water, that answer the same kind of question ("the contour
// lines in this box") in their own fields and units:
//
//   * state fishery agencies publish contours for the lakes they have surveyed;
//   * NOAA's electronic navigational charts carry contours for the coast, the Great Lakes,
//     tidal rivers and a handful of inland lakes (Champlain, Tahoe, Okeechobee…).
//
// Each source below says where it applies and how to read its answer; everything after that
// is shared. Most lakes have no source at all, and the map is then drawn without depth.
//
// Salt water is asked about differently: not a lake's outline but a box around the place,
// and only of the charts (`charts: true`), which is what the inshore depth chart draws.
// A source belongs here only if its licence allows a public site that earns money to show
// its data (see "Depth contours" in the README for the ones left out, and why).
//
// Used by the proxy (functions/api/depth.js) and by the browser when the proxy is not
// deployed, so nothing here touches the DOM or the network.

import { projector } from './lake-shape.js';

const M_TO_FT = 3.28084;
const MAX_SPAN_DEG = 2; // Lake Champlain, the longest lake the map draws, is 1.6 from end to end
const GRID_DEG = 0.01; // boxes are snapped outward to this, so everyone on a lake asks the same question
const MAX_POINTS = 6000; // about 100 kB: what is sent to a phone
const MAX_PAGES = 4;
const MAX_LEVELS = 12; // more depths than this is a smudge at the size the map is drawn
const MAX_SENT_LEVELS = 40; // for a box: the lake's own are chosen from these once its neighbours' are set aside
const STEPS = [2, 5, 10, 20, 25, 50, 100];

/**
 * Where depth comes from, most specific first: the first source with contours in the box wins.
 * `box` is [west, south, east, north]; `layers` are tried in order until one has contours
 * (`id` is the layer's row-id field, which pages are ordered by); `feet` turns a feature's
 * depth value into feet; `chart` marks a navigational chart, the only kind asked about salt water.
 */
export const DEPTH_SOURCES = [
    {
        id: 'mi-dnr',
        credit: 'Michigan DNR',
        link: 'https://www.arcgis.com/home/item.html?id=d49160d2e5af4123b15d48c2e9c70160',
        box: [-90.5, 41.6, -82.3, 48.4],
        // Institute for Fisheries Research: about 2,200 inland lakes, digitised from the
        // department's survey maps. MinDepth is the value of the line.
        layers: [{ url: 'https://services3.arcgis.com/Jdnp1TjADvSDxMAX/arcgis/rest/services/DNRHydrologyOPENDATA/FeatureServer/1/query', field: 'MinDepth', id: 'OBJECTID', pageSize: 2000 }],
        feet: (value) => value,
    },
    {
        id: 'noaa-enc',
        chart: true,
        credit: 'NOAA charts',
        link: 'https://nauticalcharts.noaa.gov/charts/noaa-enc.html',
        box: [-180, 17, -64, 72],
        // The harbour-scale charts are the detailed ones; a few lakes (Tahoe, Okeechobee) are
        // charted only at approach scale. Depths are in metres below the chart's low-water datum.
        layers: [
            { url: 'https://encdirect.noaa.gov/arcgis/rest/services/encdirect/enc_harbour/MapServer/104/query', field: 'VALDCO', id: 'OBJECTID', pageSize: 1000 },
            { url: 'https://encdirect.noaa.gov/arcgis/rest/services/encdirect/enc_approach/MapServer/108/query', field: 'VALDCO', id: 'APPROACH.DEPCNT.FID', pageSize: 1000 },
        ],
        feet: (value) => value * M_TO_FT,
    },
];

// ----- Boxes ---------------------------------------------------------------------------------

const fixed = (value) => Number(value.toFixed(2));
const round5 = (value) => Math.round(value * 1e5) / 1e5;

/** A box snapped outward to the grid, or null when it is not a usable box in the US. */
export function snapBox(box) {
    if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) return null;
    const [w, s, e, n] = box;
    if (!(w < e && s < n) || s < 17 || n > 72 || w < -180 || e > -64) return null;
    const snapped = [
        fixed(Math.floor(w / GRID_DEG + 1e-6) * GRID_DEG),
        fixed(Math.floor(s / GRID_DEG + 1e-6) * GRID_DEG),
        fixed(Math.ceil(e / GRID_DEG - 1e-6) * GRID_DEG),
        fixed(Math.ceil(n / GRID_DEG - 1e-6) * GRID_DEG),
    ];
    if (snapped[2] - snapped[0] > MAX_SPAN_DEG || snapped[3] - snapped[1] > MAX_SPAN_DEG) return null;
    return snapped;
}

/** The box to ask about for a lake (from core/lake-shape.js): its outline's bounds, snapped. */
export function depthBox(lake) {
    const points = (lake?.rings ?? []).filter((ring) => ring.outer).flatMap((ring) => ring.coords);
    if (!points.length) return null;
    const lats = points.map((p) => p[0]);
    const lons = points.map((p) => p[1]);
    return snapBox([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)]);
}

const CHART_HALF_LAT = 0.04; // about 4.5 km north and south of the place
const CHART_HALF_KM_EW = 6; // and 6 km east and west, whatever the latitude: the map is wider than tall
const CHART_GRID = 0.02; // the middle is snapped to this, so people fishing the same water share the answer

/**
 * The box of water to chart around a place on salt water: about 12 km by 9 km, on a grid.
 * @returns {number[]|null} [west, south, east, north]
 */
export function chartBox(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const midLat = Math.round(lat / CHART_GRID) * CHART_GRID;
    const midLon = Math.round(lon / CHART_GRID) * CHART_GRID;
    const halfLon = Math.ceil(CHART_HALF_KM_EW / (111.32 * Math.cos((midLat * Math.PI) / 180)) / GRID_DEG - 1e-6) * GRID_DEG;
    return snapBox([midLon - halfLon, midLat - CHART_HALF_LAT, midLon + halfLon, midLat + CHART_HALF_LAT]);
}

const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/**
 * The sources that cover a box, in the order to prefer them. With `charts`, only the
 * navigational charts: a state's survey of the pond behind the dunes is not the bay.
 */
export const sourcesFor = (box, { charts = false } = {}) => DEPTH_SOURCES.filter((source) => overlaps(source.box, box) && (!charts || source.chart));

// ----- Asking --------------------------------------------------------------------------------

/**
 * One page of a layer's contours in a box, as GeoJSON. The server simplifies the lines
 * before sending them (raw, one lake can be tens of megabytes), more coarsely for a bigger box.
 */
export function depthUrl(layer, box, offset = 0) {
    const span = Math.max(box[2] - box[0], box[3] - box[1]);
    const params = new URLSearchParams({
        where: '1=1',
        geometry: box.join(','),
        geometryType: 'esriGeometryEnvelope',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: layer.field,
        returnGeometry: 'true',
        outSR: '4326',
        maxAllowableOffset: Math.max(0.00003, Math.min(0.0004, span / 3000)).toFixed(5),
        geometryPrecision: '5',
        orderByFields: layer.id,
        resultOffset: String(offset),
        resultRecordCount: String(layer.pageSize),
        f: 'geojson',
    });
    return `${layer.url}?${params}`;
}

async function layerFeatures(layer, box, get) {
    const features = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
        const answer = await get(depthUrl(layer, box, page * layer.pageSize));
        if (answer?.error) throw new Error(answer.error.message ?? 'The depth service answered with an error');
        features.push(...(answer?.features ?? []));
        const more = answer?.exceededTransferLimit ?? answer?.properties?.exceededTransferLimit;
        if (!more) break;
    }
    return features;
}

// ----- Shaping -------------------------------------------------------------------------------

/** The parts of a line inside a box, with the point either side of each crossing kept. */
function clip(line, box) {
    const inside = line.map(([lat, lon]) => lon >= box[0] && lon <= box[2] && lat >= box[1] && lat <= box[3]);
    const pieces = [];
    let piece = [];
    line.forEach((point, i) => {
        if (inside[i] || inside[i - 1] || inside[i + 1]) piece.push(point);
        else if (piece.length) {
            pieces.push(piece);
            piece = [];
        }
    });
    if (piece.length) pieces.push(piece);
    return pieces.filter((p) => p.length >= 2);
}

/** Douglas–Peucker on an open line of [x, y] metres; returns the indexes kept. */
function keptIndexes(xy, tolerance) {
    const keep = new Uint8Array(xy.length);
    keep[0] = 1;
    keep[xy.length - 1] = 1;
    const stack = [[0, xy.length - 1]];
    while (stack.length) {
        const [from, to] = stack.pop();
        const [ax, ay] = xy[from];
        const dx = xy[to][0] - ax;
        const dy = xy[to][1] - ay;
        const length2 = dx * dx + dy * dy;
        let index = -1;
        let max = tolerance;
        for (let i = from + 1; i < to; i += 1) {
            const t = length2 ? Math.max(0, Math.min(1, ((xy[i][0] - ax) * dx + (xy[i][1] - ay) * dy) / length2)) : 0;
            const d = Math.hypot(xy[i][0] - (ax + t * dx), xy[i][1] - (ay + t * dy));
            if (d > max) [index, max] = [i, d];
        }
        if (index >= 0) stack.push([from, index], [index, to]);
        if (index >= 0) keep[index] = 1;
    }
    return keep;
}

/**
 * The depths to draw when a survey has more than fit: every 2nd, 5th, 10th… foot, at the
 * finest step that takes no more than two thirds of the lines there is room for. The rest
 * of the room goes to the shallows, which a coarse step would skip and where most fishing
 * is done: 2, 4, 6, 8, 10, 20, 30… as on a paper chart.
 */
export function pickLevels(levels, budget = MAX_LEVELS) {
    const sorted = [...new Set(levels)].sort((a, b) => a - b);
    if (sorted.length <= budget) return sorted;
    // A chart's low-water line is kept whatever the step (zero is a multiple of them all,
    // and would otherwise stand in for the shallows).
    if (sorted[0] === 0 && budget > 1) return [0, ...pickLevels(sorted.slice(1), budget - 1)];
    const most = budget <= 3 ? budget : Math.floor((budget * 2) / 3);
    for (const step of STEPS) {
        const kept = sorted.filter((ft) => ft % step === 0);
        if (kept.length < Math.min(3, most) || kept.length > most) continue;
        const shallows = sorted.filter((ft) => ft < kept[0]);
        const room = budget - kept.length;
        return room > 0 && shallows.length ? [...pickLevels(shallows, room), ...kept] : kept;
    }
    // Irregular depths that no step thins well: spread the choice evenly through them.
    if (budget < 2) return sorted.slice(0, budget);
    return [...new Set(Array.from({ length: budget }, (_, i) => sorted[Math.round((i * (sorted.length - 1)) / (budget - 1))]))];
}

/**
 * Contours from one source's GeoJSON features: lines grouped by depth in whole feet,
 * shallowest first, clipped to the box and thinned to what a phone should be sent. The box
 * holds every lake in it, so more depths are kept here than one map will draw: depthOnLake
 * chooses among the lake's own.
 *
 * `keepZero` keeps the zero line. On a lake it is the shore, which the outline already
 * draws. On a chart of tidal water it is the low-water line: the edge of the flats and bars
 * that are bare at the lowest tides, which is worth drawing.
 * @returns {{ ft: number, lines: number[][][] }[]}
 */
export function shapeContours(features, source, layer, box, { keepZero = false } = {}) {
    const byDepth = new Map();
    for (const feature of features ?? []) {
        const value = feature?.properties?.[layer.field];
        const ft = Math.round(source.feet(Number(value)));
        // A null or a negative (a bank that dries, or an elevation in the wrong field) is not a depth.
        if (value === null || value === undefined || !Number.isFinite(ft) || ft < 0 || ft > 2000 || (ft === 0 && !keepZero)) continue;
        const { type, coordinates } = feature.geometry ?? {};
        const parts = type === 'LineString' ? [coordinates] : type === 'MultiLineString' ? coordinates : [];
        for (const part of parts) {
            const line = (part ?? []).filter((p) => Number.isFinite(p?.[0]) && Number.isFinite(p?.[1])).map(([lon, lat]) => [round5(lat), round5(lon)]);
            const pieces = clip(line, box);
            if (pieces.length) byDepth.set(ft, (byDepth.get(ft) ?? []).concat(pieces));
        }
    }
    const levels = pickLevels([...byDepth.keys()], MAX_SENT_LEVELS);
    let contours = levels.map((ft) => ({ ft, lines: byDepth.get(ft) }));

    const count = (list) => list.reduce((sum, c) => sum + c.lines.reduce((s, line) => s + line.length, 0), 0);
    if (count(contours) > MAX_POINTS) {
        const { toXY } = projector((box[1] + box[3]) / 2, (box[0] + box[2]) / 2);
        const projected = contours.map((c) => c.lines.map((line) => line.map(toXY)));
        for (let tolerance = 6; tolerance <= 400; tolerance *= 1.6) {
            contours = levels.map((ft, i) => ({
                ft,
                lines: byDepth.get(ft)
                    .map((line, j) => {
                        const keep = keptIndexes(projected[i][j], tolerance);
                        return line.filter((_, k) => keep[k]);
                    })
                    // A line that has collapsed to a speck at this tolerance is noise, not structure.
                    .filter((line, j) => line.length > 2 || Math.hypot(
                        projected[i][j][0][0] - projected[i][j].at(-1)[0],
                        projected[i][j][0][1] - projected[i][j].at(-1)[1],
                    ) > tolerance * 4),
            })).filter((c) => c.lines.length);
            if (count(contours) <= MAX_POINTS) break;
        }
    }
    return contours;
}

/**
 * The depth contours in a box, from the first source that has any. `get(url)` fetches JSON;
 * the proxy and the browser each pass their own.
 *
 * A source that fails is skipped, but if nothing was found and one of them failed the whole
 * question fails, so that "no depth map" is never remembered on the strength of an outage.
 *
 * `charts` asks about salt water: the navigational charts only, low-water line included.
 * @returns {Promise<{ depth: { source: string, credit: string, link: string, contours: { ft: number, lines: number[][][] }[] }|null }>}
 */
export async function findDepth(box, { get, charts = false }) {
    let failure = null;
    for (const source of sourcesFor(box, { charts })) {
        try {
            for (const layer of source.layers) {
                const contours = shapeContours(await layerFeatures(layer, box, get), source, layer, box, { keepZero: charts });
                if (contours.length) return { depth: { source: source.id, credit: source.credit, link: source.link, contours } };
            }
        } catch (error) {
            if (error?.name === 'AbortError') throw error;
            failure = error;
        }
    }
    if (failure) throw failure;
    return { depth: null };
}

// ----- On the lake ---------------------------------------------------------------------------

function inRing(lat, lon, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const [yi, xi] = ring[i];
        const [yj, xj] = ring[j];
        if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

const every = (list, most) => {
    const step = Math.max(1, Math.ceil(list.length / most));
    return list.filter((_, i) => i % step === 0);
};

/**
 * How much of a lake's shore has a contour off it, 0 to 1. A surveyed lake has lines along
 * every bank, however flat its middle; a chart of the boat channel across one end does not.
 * "Off it" is within an eighth of the lake's width (its narrower dimension), at least 150 m.
 */
export function shoreCoverage(contours, lake) {
    const shores = (lake?.rings ?? []).filter((ring) => ring.outer).map((ring) => ring.coords);
    const shore = shores.flat();
    if (!shore.length || !contours.length) return 0;
    const lats = shore.map((p) => p[0]);
    const lons = shore.map((p) => p[1]);
    const { toXY } = projector((Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lons) + Math.max(...lons)) / 2);
    const xy = shore.map(toXY);
    const width = Math.max(...xy.map((p) => p[0])) - Math.min(...xy.map((p) => p[0]));
    const height = Math.max(...xy.map((p) => p[1])) - Math.min(...xy.map((p) => p[1]));
    const near = Math.max(150, Math.min(width, height) / 8);
    // About 200 places along the bank, evenly spaced: a long straight shore is drawn with
    // few points and a marina with many, and each should count for its length.
    const pairs = (line) => line.slice(1).map((b, i) => [line[i], b]);
    const length = ([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]);
    const segments = shores.flatMap((ring) => pairs(ring.map(toXY)));
    const spacing = segments.reduce((sum, segment) => sum + length(segment), 0) / 200 || 1;
    const banks = [];
    let carried = 0;
    for (const [a, b] of segments) {
        const run = length([a, b]);
        for (let at = spacing - carried; at <= run; at += spacing) banks.push([a[0] + ((b[0] - a[0]) * at) / run, a[1] + ((b[1] - a[1]) * at) / run]);
        carried = (carried + run) % spacing;
    }
    if (!banks.length) return 0;

    // Distance to the lines themselves, not their points: a straight contour has few.
    const contourSegments = contours.flatMap((c) => c.lines.flatMap((line) => pairs(line.map(toXY))));
    const within = ([x, y], [[ax, ay], [bx, by]]) => {
        if (x < Math.min(ax, bx) - near || x > Math.max(ax, bx) + near || y < Math.min(ay, by) - near || y > Math.max(ay, by) + near) return false;
        const dx = bx - ax;
        const dy = by - ay;
        const length2 = dx * dx + dy * dy;
        const t = length2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length2)) : 0;
        return Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= near;
    };
    return banks.filter((bank) => contourSegments.some((segment) => within(bank, segment))).length / banks.length;
}

const COVERAGE_MIN = 0.35; // less of the shore than this is a channel or a harbour, not a map of the lake
const COVERAGE_WHOLE = 0.75;

/**
 * The contours that lie on a lake, or null if there are none worth the name.
 *
 * A box around a lake also takes in its neighbours, and beside the coast the sea: a line
 * counts as this lake's when most of it is inside the outline (not all, because the two
 * shorelines were drawn by different hands). And a chart can stop partway: NOAA maps only
 * the canal channel at one end of Oneida Lake, and the California half of Tahoe. Lines along
 * too little of the shore are dropped rather than passed off as a depth map, and `partial`
 * says when they cover only part of the lake. What is left is thinned to the depths worth
 * drawing (pickLevels).
 */
export function depthOnLake(depth, lake) {
    const rings = (lake?.rings ?? []).map((ring) => ring.coords);
    const onWater = ([lat, lon]) => rings.reduce((inside, ring) => inside !== inRing(lat, lon, ring), false);
    const own = (depth?.contours ?? [])
        .map(({ ft, lines }) => ({
            ft,
            lines: lines.filter((line) => {
                const sample = every(line, 24);
                return sample.filter(onWater).length >= sample.length * 0.6;
            }),
        }))
        .filter((c) => c.lines.length);
    const drawn = new Set(pickLevels(own.map((c) => c.ft)));
    const contours = own.filter((c) => drawn.has(c.ft));
    const coverage = shoreCoverage(contours, lake);
    return coverage >= COVERAGE_MIN ? { ...depth, contours, partial: coverage < COVERAGE_WHOLE } : null;
}

/**
 * A chart's contours thinned to the depths worth drawing (pickLevels), or null if it has none.
 * There is no lake to hold the lines to: everything in the box is the water around the place.
 */
export function depthOnChart(depth) {
    const drawn = new Set(pickLevels((depth?.contours ?? []).map((c) => c.ft)));
    const contours = (depth?.contours ?? []).filter((c) => drawn.has(c.ft));
    return contours.length ? { ...depth, contours } : null;
}

// ----- Drawing -------------------------------------------------------------------------------

/** Depth bands for colouring the lines, shallow to deep: `upTo` in feet. */
export const DEPTH_BANDS = [
    { id: 1, upTo: 5, label: '≤5' },
    { id: 2, upTo: 10, label: '≤10' },
    { id: 3, upTo: 20, label: '≤20' },
    { id: 4, upTo: 40, label: '≤40' },
    { id: 5, upTo: 80, label: '≤80' },
    { id: 6, upTo: Infinity, label: '80+' },
];

export const depthBand = (ft) => DEPTH_BANDS.find((band) => ft <= band.upTo).id;

/** "5 to 60 ft", or "20 ft" when there is one line. */
export function depthRange(depth) {
    const levels = (depth?.contours ?? []).map((c) => c.ft);
    if (!levels.length) return '';
    const [min, max] = [Math.min(...levels), Math.max(...levels)];
    return min === max ? `${min} ft` : `${min} to ${max} ft`;
}

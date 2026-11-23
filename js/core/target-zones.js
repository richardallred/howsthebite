// Where on a lake to look: the banks, points and coves that fit the season and the wind.
//
// Without a depth map, all that can be read from a lake is its outline. That is still
// enough for the parts of the pattern that are about shape and direction:
//
//   * points: land that reaches out into the lake. Fish moving between deep and shallow
//     water pass them, and they stage on them before the spawn and again in late fall;
//   * coves and creek arms: water that reaches back into the land. Sheltered and shallow,
//     they hold spawning fish in spring, and shad (with the fish behind them) in the fall;
//   * the north shore: its banks face south, take the sun all day and warm first, which
//     matters in early spring and on cold winter afternoons;
//   * the wind-blown bank: wind piles plankton and baitfish onto the bank it blows toward,
//     and the fish follow. The longer the stretch of open water upwind, the bigger the effect.
//
// The phases come from core/season.js. What each phase looks for is a rule of thumb from
// the same guides; it is not measured. And depth, which decides where fish sit in summer and
// winter, is known only where a public survey exists (core/depth.js draws its contours on the
// map): for those phases the card points to the contours, or says there are none.

import { projector, ringArea } from './lake-shape.js';

// ----- What to look for, by phase ----------------------------------------------------------

const PLAN = {
    prespawn: ['point', 'sun', 'cove'],
    spawn: ['cove', 'sun'],
    postspawn: ['point', 'cove'],
    bluegill: ['cove', 'sun'],
    spring: ['sun', 'cove'],
    earlysummer: ['point', 'wind'],
    summer: ['point', 'wind'],
    fall: ['cove', 'point', 'wind'],
    latefall: ['point', 'sun'],
    winter: ['sun', 'point'],
};
const DEFAULT_PLAN = ['point', 'wind'];
const DEEP_PHASES = new Set(['summer', 'earlysummer', 'latefall', 'winter']);
const WIND_MIN_MPH = 8;
const WIND_MIN_WATER_F = 50; // colder than this, fish want the calm, sunny side, not the chop

const TITLES = {
    point: () => 'Points',
    cove: (phase) => (phase === 'fall' ? 'Creek arms and coves' : 'Sheltered coves'),
    sun: () => 'North shore',
    wind: (_, dir) => `Wind-blown bank${dir ? `: the ${dir} shore` : ''}`,
};

const WHY = {
    point: {
        prespawn: 'Fish stage on points on their way from deep water to the spawning flats',
        postspawn: 'Females rest on the first drop off the spawning pockets, often along the points beside them',
        latefall: 'Fish bunch up where points drop toward the deep water they will winter in',
        winter: 'The points that drop fastest into deep water hold fish all winter',
        summer: 'Main-lake points hold fish by day; work the tip and the drop beside it',
        earlysummer: 'Fish feed along points and the flats beside them',
        fall: 'Points at the mouths of the creek arms are where fish ambush the bait moving in',
        default: 'Points reach out toward deeper water, so fish moving between deep and shallow pass them',
    },
    cove: {
        spawn: 'Sheltered, shallow pockets out of the wind are where fish spawn',
        bluegill: 'Bluegill nest in colonies on firm, shallow bottoms at the backs of coves',
        postspawn: 'The spawning pockets: fry and the fish guarding them are still here',
        prespawn: 'The spawning pockets: fish move into them as the water warms',
        spring: 'Shallow backwaters warm first and hatch the first insects',
        fall: 'As the water cools, shad move up the creek arms and the fish follow them',
        default: 'Sheltered pockets with shallow water',
    },
    sun: {
        winter: 'Its banks face the sun: the warmest water on a cold day, best in the afternoon',
        latefall: 'Its banks face the sun and hold the last of the warm water on stable, sunny days',
        default: 'Its banks face south and take the sun all day, so its shallows warm first',
    },
    wind: {
        default: 'Wind pushes plankton and baitfish onto this bank and the fish follow; the chop hides you, too',
    },
};

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
export const compassName = (degrees) => COMPASS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];

/**
 * What to look for today, before any lake is known: kinds, titles and reasons.
 * `hasDepth` says the lake's map carries depth contours (core/depth.js), which changes the note.
 * @param {{ phaseId: string|null, windMph?: number|null, windFrom?: number|null, waterTempF?: number|null, hasDepth?: boolean }} c
 * @returns {{ kinds: { kind: string, title: string, why: string }[], depthNote: string|null }}
 */
export function targetPlan({ phaseId, windMph = null, windFrom = null, waterTempF = null, hasDepth = false }) {
    const kinds = [...(PLAN[phaseId] ?? DEFAULT_PLAN)];
    const windy = Number.isFinite(windMph) && windMph >= WIND_MIN_MPH && Number.isFinite(windFrom);
    const warmEnough = !Number.isFinite(waterTempF) || waterTempF >= WIND_MIN_WATER_F;
    const spawning = phaseId === 'spawn' || phaseId === 'bluegill';
    const useWind = windy && warmEnough && !spawning;
    const list = kinds.filter((kind) => kind !== 'wind' || useWind);
    if (useWind && !list.includes('wind')) list.splice(1, 0, 'wind');
    const downwind = windy ? compassName(windFrom + 180) : null;
    return {
        kinds: list.map((kind) => ({
            kind,
            title: TITLES[kind](phaseId, downwind),
            why: WHY[kind][phaseId] ?? WHY[kind].default,
        })),
        depthNote: !DEEP_PHASES.has(phaseId) ? null
            : hasDepth ? 'Fish also hold on ledges, humps and deep edges this time of year. On the map, those are where the depth lines bunch together, and the rings of deeper or shallower water out in the lake.'
                : 'Fish also hold on ledges, humps and deep edges this time of year. Those need a depth map, which this lake doesn\'t have here.',
        calmNote: windy && !warmEnough ? 'The water is cold: fish the calm, sunny side out of the wind rather than the windy bank.' : null,
    };
}

// ----- Reading the outline -------------------------------------------------------------------

/** A ring resampled at an even spacing, oriented so the water is always on the left. */
function resample(xy, spacing, anticlockwise) {
    const flip = (ringArea(xy) > 0) !== anticlockwise;
    const path = flip ? xy.slice().reverse() : xy;
    const out = [];
    let carry = 0;
    for (let i = 1; i < path.length; i += 1) {
        const [ax, ay] = path[i - 1];
        const [bx, by] = path[i];
        const length = Math.hypot(bx - ax, by - ay);
        let at = carry;
        while (at < length) {
            out.push([ax + ((bx - ax) * at) / length, ay + ((by - ay) * at) / length]);
            at += spacing;
        }
        carry = at - length;
    }
    return out;
}

const wrap = (i, n) => ((i % n) + n) % n;
const bearingOf = (dx, dy) => (((Math.atan2(dx, dy) * 180) / Math.PI) + 360) % 360;
const angleBetween = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/** Distance from a point across the water to the first shore in a direction, or Infinity. */
function rayToShore(origin, dir, rings, skip = 0.5) {
    let best = Infinity;
    for (const ring of rings) {
        const n = ring.length;
        for (let i = 0; i < n; i += 1) {
            const a = ring[i];
            const b = ring[(i + 1) % n];
            const ex = b[0] - a[0];
            const ey = b[1] - a[1];
            const denom = dir[0] * ey - dir[1] * ex;
            if (Math.abs(denom) < 1e-9) continue;
            const wx = a[0] - origin[0];
            const wy = a[1] - origin[1];
            const t = (wx * ey - wy * ex) / denom;
            const u = (wx * dir[1] - wy * dir[0]) / denom;
            if (t > skip && u >= 0 && u <= 1 && t < best) best = t;
        }
    }
    return best;
}

/** Even-odd test against every ring: inside the outer shore and outside the islands. */
function inWater([x, y], polys) {
    let inside = false;
    for (const ring of polys) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
            const [xi, yi] = ring[i];
            const [xj, yj] = ring[j];
            if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        }
    }
    return inside;
}

/**
 * How far open water reaches from a bank in a direction. The ray starts a few metres out
 * from the bank, and a start that is not in the water (where simplifying has pinched a
 * narrow channel shut) counts as no open water at all.
 */
function reachFrom(shore, ring, i, dir, cap) {
    const [nx, ny] = ring.normal[i];
    const step = Math.min(shore.spacing * 0.3, 15);
    const origin = [ring.pts[i][0] - nx * step, ring.pts[i][1] - ny * step];
    if (!inWater(origin, shore.polys)) return 0;
    return Math.min(rayToShore(origin, dir, shore.polys, 0.01), cap);
}

function shoreline(lake) {
    const all = lake.rings.flatMap((ring) => ring.coords);
    const lat0 = all.reduce((sum, p) => sum + p[0], 0) / all.length;
    const lon0 = all.reduce((sum, p) => sum + p[1], 0) / all.length;
    const proj = projector(lat0, lon0);
    const rings = lake.rings.map((ring) => ({ outer: ring.outer, xy: ring.coords.map(proj.toXY) }));
    const area = rings.reduce((sum, ring) => sum + (ring.outer ? 1 : -1) * Math.abs(ringArea(ring.xy)), 0);
    const perimeter = rings.reduce((sum, ring) =>
        sum + ring.xy.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - ring.xy[i - 1][0], p[1] - ring.xy[i - 1][1]) : s), 0), 0);
    const spacing = Math.max(10, perimeter / 4000);
    // Outer shores anticlockwise and islands clockwise: either way the water is on the left.
    const samples = rings.map((ring) => ({
        outer: ring.outer,
        pts: resample(ring.xy, spacing, ring.outer),
    })).filter((ring) => ring.pts.length >= 8);
    for (const ring of samples) {
        const n = ring.pts.length;
        ring.normal = ring.pts.map((_, i) => {
            const a = ring.pts[wrap(i - 1, n)];
            const b = ring.pts[wrap(i + 1, n)];
            const tx = b[0] - a[0];
            const ty = b[1] - a[1];
            const length = Math.hypot(tx, ty) || 1;
            return [ty / length, -tx / length]; // to the right of travel: toward the land
        });
    }
    return { proj, samples, spacing, scale: Math.sqrt(Math.max(area, 1)), polys: samples.map((ring) => ring.pts) };
}

/**
 * Bulges of the shoreline: + into the water (points), − into the land (coves). Each is
 * measured at several sizes, against the chord between the shore a set distance either side:
 * how far the shore stands off that chord (depth), and how narrow it is for that depth
 * (depth / chord). A square corner is 0.5 at every size; a long creek arm or a thin point
 * is far more, so the sharpness keeps a lake's corners from passing for coves.
 */
function bulges(shore, fractions, sign, minSharpness) {
    const found = [];
    for (const fraction of fractions) {
        const reach = Math.max(4 * shore.spacing, shore.scale * fraction);
        const k = Math.max(3, Math.round(reach / shore.spacing));
        shore.samples.forEach((ring, r) => {
            const n = ring.pts.length;
            if (n < 2 * k + 2 || (sign < 0 && !ring.outer)) return; // islands have no coves
            const chords = [];
            const depth = ring.pts.map((p, i) => {
                const a = ring.pts[wrap(i - k, n)];
                const b = ring.pts[wrap(i + k, n)];
                const cx = b[0] - a[0];
                const cy = b[1] - a[1];
                const chord = Math.hypot(cx, cy) || 1;
                chords.push(chord);
                return (sign * (cx * (p[1] - a[1]) - cy * (p[0] - a[0]))) / chord; // left of the chord is the water
            });
            for (let i = 0; i < n; i += 1) {
                const d = depth[i];
                if (d < reach * 0.3 || d / chords[i] < minSharpness) continue;
                let peak = true;
                for (let j = 1; j <= k && peak; j += 1) peak = depth[wrap(i - j, n)] <= d && depth[wrap(i + j, n)] < d;
                if (peak) found.push({ ring: r, i, k, reach, depth: d, sharpness: d / chords[i] });
            }
        });
    }
    return found;
}

/** The best candidates, each kept clear of the ones already picked by a multiple of its own size. */
function spread(candidates, shore, gap, limit, score) {
    const picked = [];
    for (const c of candidates.sort((a, b) => score(b) - score(a))) {
        const p = shore.samples[c.ring].pts[c.i];
        if (picked.some((q) => Math.hypot(p[0] - q.p[0], p[1] - q.p[1]) < gap * Math.max(c.reach, q.reach))) continue;
        picked.push({ ...c, p });
        if (picked.length >= limit) break;
    }
    return picked;
}

/** The shoreline from sample i−k to i+k as [lat, lon] pairs. */
function stretch(shore, ring, from, to) {
    const pts = shore.samples[ring].pts;
    const n = pts.length;
    const out = [];
    for (let i = from; i <= to; i += 1) out.push(shore.proj.toLatLon(pts[wrap(i, n)]));
    return out;
}

/** Runs of consecutive shoreline samples that pass a test, longest (by weight) first. */
function runs(shore, test, weight = () => 1) {
    const found = [];
    shore.samples.forEach((ring, r) => {
        const n = ring.pts.length;
        const ok = ring.pts.map((_, i) => test(ring, i));
        if (ok.every(Boolean)) {
            found.push({ ring: r, from: 0, to: n - 1, length: n, weight: ring.pts.reduce((s, _, i) => s + weight(ring, i), 0) });
            return;
        }
        const start = ok.findIndex((v) => !v); // begin just after a gap so no run wraps in two pieces
        let run = null;
        for (let step = 1; step <= n; step += 1) {
            const i = start + step;
            if (ok[wrap(i, n)]) {
                run ??= { ring: r, from: i, to: i, length: 0, weight: 0 };
                run.to = i;
                run.length += 1;
                run.weight += weight(ring, wrap(i, n));
            } else if (run) {
                found.push(run);
                run = null;
            }
        }
        if (run) found.push(run);
    });
    return found.sort((a, b) => b.weight - a.weight);
}

function findPoints(shore) {
    const candidates = bulges(shore, [0.03, 0.06, 0.12], 1, 0.6).map((c) => {
        const ring = shore.samples[c.ring];
        const [nx, ny] = ring.normal[c.i];
        const open = reachFrom(shore, ring, c.i, [-nx, -ny], c.reach * 6);
        return { ...c, open };
    }).filter((c) => c.open > c.reach); // a point should face open water
    return spread(candidates, shore, 3, 5, (c) => c.depth * Math.sqrt(c.open)).map((c) => ({
        line: stretch(shore, c.ring, c.i - Math.ceil(c.k / 2), c.i + Math.ceil(c.k / 2)),
        at: shore.proj.toLatLon(c.p),
    }));
}

function findCoves(shore) {
    // In spring the coves on the north side warm first and are out of the cold north wind.
    const candidates = bulges(shore, [0.06, 0.12, 0.25], -1, 0.8).map((c) => {
        const ring = shore.samples[c.ring].pts;
        const n = ring.length;
        const a = ring[wrap(c.i - c.k, n)];
        const b = ring[wrap(c.i + c.k, n)];
        const axis = bearingOf(ring[c.i][0] - (a[0] + b[0]) / 2, ring[c.i][1] - (a[1] + b[1]) / 2);
        return { ...c, axis };
    });
    return spread(candidates, shore, 2, 4, (c) => c.depth * (angleBetween(c.axis, 0) < 90 ? 1.3 : 1)).map((c) => ({
        line: stretch(shore, c.ring, c.i - c.k, c.i + c.k),
        at: shore.proj.toLatLon(c.p),
    }));
}

function findBanks(shore, facing, { within = 50, limit = 3, weight, keep = () => true } = {}) {
    const minLength = Math.max(3, Math.round(shore.scale * 0.04 / shore.spacing));
    return runs(shore, (ring, i) => angleBetween(bearingOf(...ring.normal[i]), facing) <= within, weight)
        .filter((run) => run.length >= minLength && keep(run))
        .slice(0, limit)
        .map((run) => {
            const line = stretch(shore, run.ring, run.from, run.to);
            return { line, at: line[Math.floor(line.length / 2)] };
        });
}

function findWindBanks(shore, windFrom) {
    const downwind = (windFrom + 180) % 360;
    const rad = (windFrom * Math.PI) / 180;
    const upwind = [Math.sin(rad), Math.cos(rad)];
    const fetch = new Map();
    const fetchAt = (ring, i) => {
        const key = `${shore.samples.indexOf(ring)}:${i}`;
        if (!fetch.has(key)) fetch.set(key, reachFrom(shore, ring, i, upwind, shore.scale * 3));
        return fetch.get(key);
    };
    // Only banks with a real reach of open water upwind: in the lee of an island or the far
    // side of a narrow cove, the wind has nothing to push.
    const minFetch = Math.max(300, shore.scale * 0.2);
    return findBanks(shore, downwind, {
        within: 55,
        limit: 3,
        weight: (ring, i) => fetchAt(ring, i),
        keep: (run) => run.weight / run.length >= minFetch,
    });
}

/**
 * The zones to draw on a lake. Each has a kind, the shoreline to mark and a spot for its label.
 * @param {{ rings: { outer: boolean, coords: number[][] }[] }} lake
 * @param {ReturnType<typeof targetPlan>} plan
 * @param {{ windFrom?: number|null }} [wind]
 */
export function locateZones(lake, plan, { windFrom = null } = {}) {
    if (!lake?.rings?.length) return [];
    const shore = shoreline(lake);
    if (!shore.samples.length) return [];
    const zones = [];
    for (const entry of plan.kinds) {
        let found = [];
        if (entry.kind === 'point') found = findPoints(shore);
        else if (entry.kind === 'cove') found = findCoves(shore);
        else if (entry.kind === 'sun') found = findBanks(shore, 0, { within: 45 });
        else if (entry.kind === 'wind' && Number.isFinite(windFrom)) found = findWindBanks(shore, windFrom);
        for (const place of found) zones.push({ kind: entry.kind, line: place.line, at: place.at });
    }
    return zones;
}

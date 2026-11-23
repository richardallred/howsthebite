// Fishing score: how favourable conditions are right now, 0–100.
//
// The weights follow what has actually been measured about angler catch rates
// rather than fishing folklore (sources and reasoning are in the README):
//
//   Water temperature   35   strongest biological basis; the right range depends on the species.
//                             The last week or two of trend moves it: warming toward the range helps,
//                             cooling away from it or a cold snap hurts
//   Light               28   dusk > dawn > overcast day > bright midday > night
//   Wind                 8   no measured effect on bass or walleye; costs points mainly for boat
//                             control and safety, and a gale sets a ceiling (see LIMITING) anyway
//   River flow           9   only when a river gauge with a long record is in play
//   Season               8   where the fish are in their year (pre-spawn, spawn, fall feed…);
//                             rules of thumb rather than catch data, so kept below the measured factors
//   Moon                 7   real but small and inconsistent
//   Barometric pressure  5   no measured effect on catch rates; kept small, for the trend and for
//                             fronts on the way or just through (see scorePressure for the evidence)
//
// Salt water is scored on different factors (see FACTOR_WEIGHTS and the README): there is
// no river flow, the tide matters, and for surf fishing so does the height of the waves.
//
// A factor that does not apply (river flow on a lake) is left out, and the score is the
// share of the points that were available. Two things can then hold it down:
//   * a limiting factor: water far outside the fish's range, a river in flood or a gale
//     spoils the fishing however good the light is, so the worst of those three sets a ceiling;
//   * a hazard: thunderstorms or a dangerous-weather warning cap the score outright.
//
// Everything here is a pure function of its inputs so it can be unit tested
// (see tests/scoring.test.js) and reused to score the hours ahead.

import { BITE_PHRASES, SCORE_BANDS } from '../config.js';
import { moonInfo, moonTransit } from './moon.js';
import { seasonalPhase } from './season.js';
import { sunAltitude, sunTimes } from './sun.js';
import { tideAt } from './tides.js';
import { classifyTrend, mean } from './trend.js';
import { clamp, isNum } from './util.js';

/**
 * Points each factor can earn, by style of fishing. Each row adds up to 100.
 *   fresh    lakes and rivers
 *   inshore  bays, estuaries, flats, marsh, jetties and piers
 *   surf     casting from an ocean beach
 */
export const FACTOR_WEIGHTS = {
    fresh: { water: 35, light: 28, season: 8, wind: 8, flow: 9, moon: 7, pressure: 5 },
    inshore: { water: 32, tide: 25, light: 17, season: 8, wind: 15, pressure: 3 },
    surf: { water: 27, waves: 21, tide: 14, light: 14, season: 8, wind: 13, pressure: 3 },
};
export const FACTOR_MAX = FACTOR_WEIGHTS.fresh;

/** Score ceiling while thunderstorms or a dangerous-weather warning are in effect. */
export const HAZARD_CAP = 15;

const signed = (value, digits) => `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(digits)}`;

/** Linear interpolation through [x, y] knots sorted by x; flat beyond either end. */
function curve(knots, x) {
    if (x <= knots[0][0]) return knots[0][1];
    for (let i = 1; i < knots.length; i++) {
        const [x1, y1] = knots[i];
        if (x <= x1) {
            const [x0, y0] = knots[i - 1];
            return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
        }
    }
    return knots[knots.length - 1][1];
}

/** A factor's result: `share` is the unrounded 0–1 fraction of full marks. */
const graded = (share, max, rest) => ({ points: clamp(Math.round(share * max), 0, max), share: clamp(share, 0, 1), ...rest });

function ratingFor(points, max) {
    const share = points / max;
    if (share >= 0.8) return 'excellent';
    if (share >= 0.6) return 'good';
    if (share >= 0.35) return 'fair';
    return 'poor';
}

function trendText(trend, { unit, digits, period }) {
    if (trend.direction === 'unknown') return null;
    if (trend.direction === 'steady') return `Steady over ${period}`;
    const word = trend.direction === 'rising' ? 'Rising' : 'Falling';
    return `${word}${trend.rapid ? ' fast' : ''} · ${signed(trend.delta, digits)}${unit} in ${period}`;
}

// ---------------------------------------------------------------------------
// Water temperature
// ---------------------------------------------------------------------------

// Share of full marks by water temperature (°F) for each group of species.
//   warm: largemouth catch per outing by temperature band (49–58°F ≈ 40% of the 69–78°F peak,
//         59–68°F ≈ 80%, 79–88°F ≈ 70%) and EPA growth/survival limits (90 / 93°F).
//   cool: walleye optimum about 64–72°F, pike 60–65°F; activity drops off above the mid 70s.
//   cold: trout catch rates were 77% lower above 73°F than below 66°F, and released fish
//         died far more often; agencies restrict trout fishing at about 73°F.
//   catfish: channel catfish grow best at 79–84°F and poorly below 70°F (the US Fish and
//         Wildlife Service habitat model), so their prime runs warmer than the bass's and
//         holds further into the heat; blue catfish keep feeding in cold water, so the cold
//         side never quite reaches nothing.
//   any:  a compromise for people who have not said what they are after.
export const SPECIES_GROUPS = {
    any: {
        label: 'All species',
        prime: 'Prime range for most species',
        curve: [[33, 0.05], [40, 0.15], [50, 0.5], [58, 0.85], [62, 1], [76, 1], [82, 0.8], [88, 0.45], [93, 0.15], [97, 0]],
        oxygen: [[3, 0.2], [3.5, 0.5], [4, 0.75], [5, 1]],
    },
    warm: {
        label: 'Bass & panfish',
        prime: 'Prime range for bass and panfish',
        curve: [[33, 0.05], [45, 0.2], [54, 0.4], [64, 0.8], [69, 1], [80, 1], [85, 0.75], [90, 0.45], [95, 0.15], [98, 0]],
        oxygen: [[3, 0.2], [3.5, 0.5], [4, 0.75], [5, 1]],
    },
    catfish: {
        label: 'Catfish',
        prime: 'Prime range for catfish',
        curve: [[33, 0.1], [45, 0.25], [55, 0.45], [65, 0.75], [72, 1], [86, 1], [90, 0.8], [94, 0.45], [98, 0.1], [100, 0]],
        oxygen: [[3, 0.2], [3.5, 0.5], [4, 0.75], [5, 1]],
        light: 'catfish',
        flow: 'catfish',
    },
    cool: {
        label: 'Walleye & pike',
        prime: 'Prime range for walleye, pike and smallmouth',
        curve: [[33, 0.1], [40, 0.3], [50, 0.65], [58, 0.95], [62, 1], [72, 1], [76, 0.75], [80, 0.45], [85, 0.15], [88, 0]],
        oxygen: [[3, 0.2], [3.5, 0.5], [4, 0.75], [5, 1]],
    },
    cold: {
        label: 'Trout & salmon',
        prime: 'Prime range for trout',
        curve: [[33, 0.15], [38, 0.4], [44, 0.75], [50, 1], [64, 1], [66, 0.85], [68, 0.55], [70, 0.3], [73, 0.05], [75, 0]],
        // Salmonids need more oxygen: EPA puts slight impairment at 6 mg/L and severe at 4.
        oxygen: [[3, 0.2], [4, 0.5], [5, 0.75], [6, 1]],
    },
};

// Salt-water groups. The curves are drawn from measured thresholds where they exist (snook stop
// feeding near 58°F and die near 54°F; pompano avoid water under 68°F; spotted seatrout are
// cold-stunned under 45°F; red drum feed poorly under 60°F; large striped bass avoid water over
// 77°F; Chinook salmon keep to 46–54°F) and from long-standing guides' tables in between.
Object.assign(SPECIES_GROUPS, {
    tropical: {
        label: 'Snook & tarpon',
        prime: 'Prime range for snook, tarpon and pompano',
        curve: [[48, 0], [55, 0.05], [60, 0.2], [68, 0.6], [74, 1], [86, 1], [90, 0.65], [94, 0.3], [98, 0]],
        oxygen: [[2, 0.2], [3, 0.5], [4, 0.8], [5, 1]],
        stun: [58, 'Cold enough to shut snook down; a longer cold snap can kill them'],
    },
    warmsalt: {
        label: 'Redfish & seatrout',
        prime: 'Prime range for redfish, seatrout and flounder',
        curve: [[40, 0], [45, 0.1], [50, 0.25], [58, 0.6], [65, 1], [82, 1], [88, 0.6], [92, 0.3], [96, 0]],
        oxygen: [[2, 0.2], [3, 0.5], [4, 0.8], [5, 1]],
        stun: [45, 'Cold-stun range for seatrout; fish are barely feeding'],
    },
    coolsalt: {
        label: 'Striped bass & bluefish',
        prime: 'Prime range for striped bass, bluefish and fluke',
        curve: [[36, 0], [42, 0.2], [48, 0.6], [55, 1], [70, 1], [74, 0.65], [78, 0.3], [82, 0.05], [85, 0]],
        oxygen: [[2, 0.2], [3, 0.5], [4, 0.8], [5, 1]],
    },
    pacwarm: {
        label: 'Halibut & surfperch',
        prime: 'Prime range for halibut, corbina, croaker and bay bass',
        // Barred surfperch bite all year, so the cold side falls away slowly.
        curve: [[44, 0.2], [50, 0.5], [55, 0.75], [60, 1], [72, 1], [76, 0.7], [80, 0.4], [86, 0.1]],
        oxygen: [[2, 0.2], [3, 0.5], [4, 0.8], [5, 1]],
    },
    paccold: {
        label: 'Salmon & surfperch',
        prime: 'Prime range for salmon, surfperch and rockfish',
        curve: [[36, 0.3], [42, 0.6], [46, 0.9], [48, 1], [58, 1], [62, 0.7], [66, 0.35], [70, 0.1], [74, 0]],
        oxygen: [[3, 0.2], [4, 0.5], [5, 0.75], [6, 1]],
    },
});

function waterNote(tempF, share, groupId, label) {
    const group = SPECIES_GROUPS[groupId];
    // `label` names the fish actually found in the region ("Smallmouth & perch"), when known.
    if (share >= 0.95) return label && groupId !== 'any' ? `Prime range for ${label.toLowerCase()}` : group.prime;
    const coldSide = tempF < group.curve.find(([, y]) => y === 1)[0];
    if (group.stun && tempF <= group.stun[0]) return group.stun[1];
    if (coldSide) {
        if (share >= 0.7) return 'A little cool — fish active, just short of their best';
        if (share >= 0.4) return 'Cool — fish feeding less, slow your presentation';
        if (share >= 0.15) return 'Cold — fish sluggish';
        return 'Near freezing — fish barely feeding';
    }
    if (groupId === 'cold') {
        if (tempF >= 73) return 'Too warm for trout — give them a rest';
        if (tempF >= 68) return 'Warm for trout — they are stressed; fish early and land them fast';
        return 'Getting warm for trout — best early in the day';
    }
    if (share >= 0.7) return 'A little warm — fish early and late';
    if (share >= 0.4) return 'Warm — fish holding deeper';
    if (share >= 0.15) return 'Hot — fish stressed';
    return 'Dangerously hot for fish';
}

/**
 * Where a water temperature sits relative to a species group's own range (fresh or salt):
 * 'prime', or 'cool' / 'cold' below it, or 'warm' / 'hot' above it.
 */
export function temperatureZone(tempF, group = 'any') {
    const knots = (SPECIES_GROUPS[group] ?? SPECIES_GROUPS.any).curve;
    const share = curve(knots, tempF);
    if (share >= 0.95) return 'prime';
    const below = tempF < knots.find(([, y]) => y === 1)[0];
    if (below) return share >= 0.5 ? 'cool' : 'cold';
    return share >= 0.5 ? 'warm' : 'hot';
}

// Which way the water has been heading over the last week or two, relative to the fish's range.
// Water warming toward the range (the spring warm-up) or cooling toward it from the heat helps;
// water cooling away from it (late fall, a cold front) hurts, and a sudden drop hurts most.
// Like the pressure trend this rests on near-universal anglers' testimony and on how cold-blooded
// fish respond to temperature, not on catch-rate studies, so it adjusts the water factor rather
// than standing as a factor of its own. The rate is °F per week, signed so that positive is
// toward the prime range.
const TOWARD_BONUS = [[0, 0], [2, 0.12], [4, 0.25]]; // share of the remaining gap closed
const AWAY_FACTOR = [[0, 1], [2, 0.88], [4, 0.75], [7, 0.62]]; // multiplier
const COLD_SNAP_FACTOR = 0.6;
const PRIME_SWING_FACTOR = [[3, 1], [6, 0.9]]; // a fast change even inside the range unsettles fish

/**
 * How the recent water trend (water-trend.js) moves the water factor's share.
 * @returns {{ share: number, note: string|null }}  note is set only when the trend is the story
 */
function applyWaterTrend(share, tempF, groupId, trend) {
    const weekly = trend?.perWeek ?? trend?.change7;
    if (!trend || !isNum(weekly)) return { share, note: null };
    const zone = temperatureZone(tempF, groupId);
    const below = zone === 'cool' || zone === 'cold';
    const perWeek = `${Math.abs(weekly).toFixed(1)}°F a week`;

    if (trend.swing === 'cold-snap' && zone !== 'hot') {
        return {
            share: share * COLD_SNAP_FACTOR,
            note: `Cold snap — down ${Math.abs(trend.change3).toFixed(1)}°F in 3 days; fish need a few days to adjust`,
        };
    }
    if (zone === 'prime') {
        return { share: share * curve(PRIME_SWING_FACTOR, Math.abs(weekly)), note: null };
    }
    const toward = below ? weekly : -weekly;
    if (trend.direction === 'steady' || Math.abs(toward) < 1) return { share, note: null };
    if (toward > 0) {
        return {
            share: share + (1 - share) * curve(TOWARD_BONUS, toward),
            note: below ? `Warming ${perWeek} — fish waking up and moving shallow` : `Cooling ${perWeek} — relief from the heat`,
        };
    }
    return {
        share: share * curve(AWAY_FACTOR, -toward),
        note: below ? `Cooling ${perWeek} — fish slowing down with it` : `Warming ${perWeek} — heat stress building`,
    };
}

/**
 * @param {number} tempF
 * @param {object} [options]
 * @param {'any'|'warm'|'catfish'|'cool'|'cold'} [options.group]
 * @param {string|null} [options.label]   what the group is called in this region, for the note
 * @param {boolean} [options.estimated]   no sensor nearby: the temperature is a guess from air temperature
 * @param {number|null} [options.change24h]  shown, but not scored: a day's change is mostly noise
 * @param {object|null} [options.trend]  the last weeks of water temperature (water-trend.js), which is scored
 * @param {number|null} [options.oxygenMgL]  dissolved oxygen, when the station reports it
 */
export function scoreWaterTemp(tempF, { group = 'any', label = null, estimated = false, change24h = null, trend: weeks = null, oxygenMgL = null } = {}) {
    const groupId = group in SPECIES_GROUPS ? group : 'any';
    let share = curve(SPECIES_GROUPS[groupId].curve, tempF);
    let note = waterNote(tempF, share, groupId, label);

    if (!estimated) {
        const adjusted = applyWaterTrend(share, tempF, groupId, weeks);
        share = adjusted.share;
        // The temperature itself stays the headline when it is the bigger story (dangerously hot, prime).
        if (adjusted.note && share < 0.95 && !(groupId === 'cold' && tempF >= 68)) note = adjusted.note;
    }

    if (estimated) {
        // A guess should not swing the score as far as a measurement: pull it toward the middle.
        share = 0.5 + (share - 0.5) * 0.6;
        note += ' (estimated)';
    }
    if (isNum(oxygenMgL)) {
        const oxygenShare = curve(SPECIES_GROUPS[groupId].oxygen, oxygenMgL);
        if (oxygenShare < 1) {
            share *= oxygenShare;
            note = `Low oxygen (${oxygenMgL.toFixed(1)} mg/L) — fish feed poorly`;
        }
    }

    const trend = classifyTrend(estimated ? null : change24h, { steadyBelow: 1, rapidAbove: 4 });
    return graded(share, FACTOR_MAX.water, { note, trend: trendText(trend, { unit: '°F', digits: 1, period: '24 hr' }) });
}

// ---------------------------------------------------------------------------
// Light: time of day and cloud
// ---------------------------------------------------------------------------

// Measured trip success and catch rates run dusk > dawn > daytime, and higher under
// low light than bright sun (walleye success 0.47 at dusk, 0.34 at dawn, 0.26 by day;
// bass 1.62/h at dusk, 1.14/h at dawn, 0.87/h by day, 0.52/h at night).
//
// Catfish are the exception in fresh water. Nobody has compared their catch rate by day and by
// night, but in a 24-hour creel survey of two Ohio reservoirs over half the channel catfish
// harvest, and of the effort spent on them, came after dark, and agencies' guides agree they
// feed most at night and in low light. So night is not marked down for them, and bright sun is.
//
// In salt water the pattern is flatter. Fish are most active around dawn and dusk there too,
// but the one creel survey that compared day with night (1,862 shore anglers in Mississippi)
// found no real difference, so night is not marked down and daytime only a little.
const LIGHT_PROFILES = {
    fresh: {
        dusk: 1,
        dawn: 0.75,
        night: 0.35,
        day: { clear: 0.45, partly: 0.55, overcast: 0.68, 'light-precip': 0.68, precip: 0.6, storm: 0.6, unknown: 0.55 },
        nightNote: 'After dark — slower for most species, walleye and catfish excepted',
        duskNote: 'Evening low light — usually the best bite of the day',
        dawnNote: 'Early-morning low light — a strong window',
    },
    catfish: {
        dusk: 1,
        dawn: 0.8,
        night: 0.85,
        day: { clear: 0.4, partly: 0.5, overcast: 0.65, 'light-precip': 0.68, precip: 0.62, storm: 0.6, unknown: 0.5 },
        nightNote: 'After dark — prime time for catfish',
        duskNote: 'Evening low light — catfish move up to feed',
        dawnNote: 'Early-morning low light — still a good catfish window',
        dayNotes: {
            clear: 'Bright sun — catfish hold deep or in cover; fish holes and current',
        },
    },
    salt: {
        dusk: 1,
        dawn: 1,
        night: 0.65,
        day: { clear: 0.6, partly: 0.68, overcast: 0.78, 'light-precip': 0.78, precip: 0.7, storm: 0.7, unknown: 0.68 },
        nightNote: 'After dark — about as good as daytime; snook and striped bass feed well at night',
        duskNote: 'Evening low light — a prime feeding window',
        dawnNote: 'First light — a prime feeding window',
        dayNotes: {
            clear: 'Bright sun — try deeper edges, channels and shade',
            partly: 'Broken cloud — fair light',
            overcast: 'Overcast — good low light all day',
        },
    },
};
const LOW_SUN_DEGREES = 12; // roughly the first and last hour of sunlight
const HIGH_SUN_DEGREES = 25;
const CIVIL_TWILIGHT_DEGREES = -6;
const DARK_DEGREES = -12;

const DAY_NOTES = {
    clear: 'Bright sun — fish hold deeper or tight to cover',
    partly: 'Broken cloud — fair light',
    overcast: 'Overcast — low light keeps fish shallower and active',
    'light-precip': 'Grey and damp — good low light',
    precip: 'Rain — low light, harder fishing',
    storm: 'Storms — stay off the water',
    unknown: 'Daylight',
};

/**
 * @param {object} c
 * @param {number} c.time  epoch ms
 * @param {number} [c.lat]
 * @param {number} [c.lon]
 * @param {string} [c.sky]  sky class from sky.js
 * @param {'fresh'|'salt'} [c.water]
 * @param {string|null} [c.species]  a fresh-water species group with its own light profile (catfish)
 * @returns {{ points, note, trend, phase: 'dawn'|'dusk'|'day'|'night' }}
 */
export function scoreLight({ time, lat, lon, sky = 'unknown', water = 'fresh', species = null }) {
    const own = water === 'fresh' ? SPECIES_GROUPS[species]?.light : null;
    const profile = LIGHT_PROFILES[own ?? water] ?? LIGHT_PROFILES.fresh;
    const { dawn: DAWN_LIGHT, dusk: DUSK_LIGHT, night: NIGHT_LIGHT } = profile;
    const dayShare = profile.day[sky] ?? profile.day.unknown;
    const dayNote = profile.dayNotes?.[sky] ?? DAY_NOTES[sky] ?? DAY_NOTES.unknown;
    if (!isNum(lat) || !isNum(lon) || !isNum(time)) {
        return graded(dayShare, FACTOR_MAX.light, { note: dayNote, trend: null, phase: 'day' });
    }

    const altitude = sunAltitude(time, lat, lon);
    // Degrees the sun climbs in ten minutes: positive in the morning, negative after solar noon.
    const climb = sunAltitude(time + 10 * 60 * 1000, lat, lon) - altitude;
    const morning = climb > 0;
    // Dawn and dusk values meet smoothly where the sun is barely moving (a far-northern
    // winter noon, or the midnight sun), so the score never jumps at the turn.
    const afternoon = clamp(0.5 - climb, 0, 1);
    const lowSunShare = DAWN_LIGHT + (DUSK_LIGHT - DAWN_LIGHT) * afternoon;

    let share;
    let phase;
    if (altitude >= HIGH_SUN_DEGREES) {
        [share, phase] = [dayShare, 'day'];
    } else if (altitude >= LOW_SUN_DEGREES) {
        const blend = (altitude - LOW_SUN_DEGREES) / (HIGH_SUN_DEGREES - LOW_SUN_DEGREES);
        // Low sun never scores below the daytime value (an overcast winter noon is still overcast).
        share = Math.max(dayShare, lowSunShare + (dayShare - lowSunShare) * blend);
        phase = blend < 0.5 ? (morning ? 'dawn' : 'dusk') : 'day';
    } else if (altitude >= CIVIL_TWILIGHT_DEGREES) {
        [share, phase] = [lowSunShare, morning ? 'dawn' : 'dusk'];
    } else if (altitude >= DARK_DEGREES) {
        const blend = (CIVIL_TWILIGHT_DEGREES - altitude) / (CIVIL_TWILIGHT_DEGREES - DARK_DEGREES);
        share = lowSunShare + (NIGHT_LIGHT - lowSunShare) * blend;
        phase = blend < 0.5 ? (morning ? 'dawn' : 'dusk') : 'night';
    } else {
        [share, phase] = [NIGHT_LIGHT, 'night'];
    }

    let note = dayNote;
    if (sky !== 'storm') {
        if (phase === 'dusk') note = profile.duskNote;
        else if (phase === 'dawn') note = profile.dawnNote;
        else if (phase === 'night') note = profile.nightNote;
    }
    return graded(share, FACTOR_MAX.light, { note, trend: null, phase });
}

// ---------------------------------------------------------------------------
// Wind
// ---------------------------------------------------------------------------

// Wind showed little consistent effect on catch rates (none for walleye or bass, about 40%
// fewer muskie at 20 mph than in calm). What it reliably changes is boat control, casting
// and safety, so only strong wind costs many points.
const WIND_CURVE = [[0, 0.75], [3, 0.9], [5, 1], [12, 1], [15, 0.85], [20, 0.5], [25, 0.2], [30, 0]];

export function scoreWind(mph, { gustMph = null } = {}) {
    const effective = Math.max(mph, isNum(gustMph) ? gustMph * 0.7 : 0);
    let note;
    if (effective > 25) note = 'Too windy — unsafe on open water';
    else if (effective > 20) note = 'Strong wind — hard going, risky on open water';
    else if (effective > 15) note = 'Windy — tough boat control and casting';
    else if (effective > 12) note = 'Breezy — manageable';
    else if (effective >= 5) note = 'Light chop — ideal';
    else if (effective >= 1) note = 'Light air — easy fishing, clear water shows your line';
    else note = 'Calm — glassy water, fish can be wary';
    return graded(curve(WIND_CURVE, effective), FACTOR_MAX.wind, { note, trend: null });
}

// ---------------------------------------------------------------------------
// River flow against the normal for the date
// ---------------------------------------------------------------------------

const PERCENTILE_KEYS = [5, 10, 25, 50, 75, 90, 95];
// High water lowered catch rates where it was measured; low water mostly did not.
// Catfish find food by smell and agencies' guides send anglers out on rising, stained water
// after rain, so for them water somewhat above normal costs nothing (an unmeasured rule of
// thumb); a river in flood is still poor fishing and unsafe.
const FLOW_CURVES = {
    fresh: [[0, 0.6], [10, 0.75], [25, 0.95], [35, 1], [70, 1], [80, 0.8], [90, 0.45], [95, 0.2], [100, 0]],
    catfish: [[0, 0.6], [10, 0.75], [25, 0.95], [35, 1], [85, 1], [90, 0.75], [95, 0.35], [100, 0]],
};

/** Where `cfs` falls in the station's record for this day of the year, 0–100. Null if the record is unusable. */
export function flowPercentile(cfs, percentiles) {
    if (!isNum(cfs) || !percentiles) return null;
    const knots = PERCENTILE_KEYS.map((key) => [Number(percentiles[key]), key]);
    if (knots.some(([value]) => !isNum(value))) return null;
    for (let i = 1; i < knots.length; i++) if (knots[i][0] < knots[i - 1][0]) return null;
    if (cfs <= knots[0][0]) return knots[0][0] > 0 ? Math.max(0, (5 * cfs) / knots[0][0]) : 0;
    const top = knots[knots.length - 1][0];
    if (cfs >= top) return top > 0 ? Math.min(100, 95 + (5 * (cfs - top)) / top) : 100;
    for (let i = 1; i < knots.length; i++) {
        const [value, key] = knots[i];
        const [previousValue, previousKey] = knots[i - 1];
        if (cfs <= value) {
            return value === previousValue ? key : previousKey + ((key - previousKey) * (cfs - previousValue)) / (value - previousValue);
        }
    }
    return 100;
}

/**
 * @param {{ cfs: number, percentiles: Record<number, number> } | null} flow
 * @param {object} [options]
 * @param {string|null} [options.species]  a species group with its own tolerance of high water (catfish)
 * @returns factor result, or null when flow does not apply or has no usable record
 */
export function scoreFlow(flow, { species = null } = {}) {
    const percentile = flowPercentile(flow?.cfs, flow?.percentiles);
    if (percentile === null) return null;
    const curveId = SPECIES_GROUPS[species]?.flow ?? 'fresh';
    let note;
    if (percentile > 95) note = 'Very high for the date — likely blown out';
    else if (percentile > 90) note = 'High for the date — fast and probably muddy';
    else if (percentile > 75) note = curveId === 'catfish' ? 'Above normal — stained water and fresh food suit catfish' : 'Above normal — pushy, may be off-colour';
    else if (percentile >= 25) note = 'Normal for the date';
    else if (percentile >= 10) note = 'Below normal — lower, clearer water';
    else note = 'Very low for the date — skinny, clear water';

    const median = Number(flow.percentiles[50]);
    const trend = median > 0 ? `${Math.round((flow.cfs / median) * 100)}% of the median for today` : null;
    return graded(curve(FLOW_CURVES[curveId], percentile), FACTOR_MAX.flow, { note, trend, percentile });
}

// ---------------------------------------------------------------------------
// Tide and surf (salt water)
// ---------------------------------------------------------------------------

// Telemetry and netting studies agree that inshore fish feed while the water is moving and
// pause around slack, but which direction is better depends on the species and the spot
// (red drum push onto flooded marsh on the rise; striped bass are logged more on the ebb).
// So movement is scored and direction is only reported.
const SLACK_SHARE = 0.4;

/**
 * @param {import('./tides.js').TideExtreme[]|null} extremes  predicted highs and lows
 * @param {number} time  epoch ms
 * @returns factor result with `state` (see tideAt), or null without predictions for that time
 */
export function scoreTide(extremes, time) {
    const state = tideAt(extremes, time);
    if (!state) return null;
    let note;
    if (state.slack) {
        const top = (state.movement < 0.3 && time - state.previous.t < state.next.t - time ? state.previous : state.next).type === 'H';
        note = top ? 'Slack water at high tide — the bite often pauses until it moves' : 'Slack water at low tide — the bite often pauses until it moves';
    } else if (state.direction === 'rising') {
        note = state.movement > 0.8 ? 'Incoming tide at full flow' : 'Incoming tide — water moving';
    } else {
        note = state.movement > 0.8 ? 'Outgoing tide at full flow' : 'Outgoing tide — water moving';
    }
    return graded(SLACK_SHARE + (1 - SLACK_SHARE) * state.movement, FACTOR_WEIGHTS.inshore.tide, { note, trend: null, state });
}

// The only catch data on waves (8,815 small-boat sea bass trips in the UK) showed landings
// falling as wave height rose. Nothing supports the saying that flat surf fishes badly,
// so calm water loses almost nothing; big surf loses a lot, for the fishing and the angler.
const WAVE_CURVE = [[0, 0.9], [1, 1], [3, 1], [4, 0.8], [5, 0.55], [6, 0.35], [8, 0.1], [10, 0]];

/** @param {number|null} heightFt  significant wave height at the beach, or null when unknown */
export function scoreWaves(heightFt) {
    if (!isNum(heightFt)) return null;
    let note;
    if (heightFt > 8) note = 'Dangerous surf — stay off the beach edge';
    else if (heightFt > 6) note = 'Heavy surf — hard to hold bottom, risky wading';
    else if (heightFt > 4) note = 'Rough surf — heavier sinkers, shorter fishing';
    else if (heightFt >= 1) note = 'Fishable surf with some white water';
    else note = 'Nearly flat — easy fishing, longer casts to reach fish';
    return graded(curve(WAVE_CURVE, heightFt), FACTOR_WEIGHTS.surf.waves, { note, trend: null });
}

// ---------------------------------------------------------------------------
// Moon
// ---------------------------------------------------------------------------

// The measured lunar effect is small (about 5% overall on 340,000 muskie records, 10–25% in
// the datasets where it showed at all, none for trout) and partly reflects when anglers
// choose to fish. Moon overhead/underfoot did raise trip success in the one creel study
// that tested it, so both phase and position earn a little.
const MAJOR_PERIOD_FULL_DEGREES = 15; // within about an hour of the moon crossing overhead or underfoot
const MAJOR_PERIOD_ZERO_DEGREES = 30;

export function scoreMoon(date = new Date(), lon = null) {
    const moon = moonInfo(date);
    const pull = moon.syzygy ** 2; // concentrated in the few days around new and full moon
    const transit = isNum(lon) ? moonTransit(date.getTime(), lon) : null;
    const position = transit
        ? clamp((MAJOR_PERIOD_ZERO_DEGREES - transit.degreesAway) / (MAJOR_PERIOD_ZERO_DEGREES - MAJOR_PERIOD_FULL_DEGREES), 0, 1)
        : 0;

    let note;
    if (position >= 0.5) note = `Moon ${transit.position} — a solunar feeding window`;
    else if (pull > 0.75) note = moon.fraction > 0.25 && moon.fraction < 0.75 ? 'Around the full moon' : 'Around the new moon';
    else if (pull > 0.35) note = 'Between phases';
    else note = 'Quarter moon — the weakest phase';

    return graded(0.35 + 0.3 * pull + 0.35 * position, FACTOR_MAX.moon, {
        note, trend: `${Math.round(moon.illumination * 100)}% illuminated`,
    });
}

// ---------------------------------------------------------------------------
// Season
// ---------------------------------------------------------------------------

const capitalised = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Where the fish are in their year (season.js): the pre-spawn and fall feeds score high, a
 * spawn when they stop feeding, a closed season or the dead of summer low. With several
 * fish (all species), it leans toward whichever is in its best season, since someone
 * fishing for anything can fish for that.
 *
 * @param {object} c
 * @param {string[]} c.targets  the fish being fished for ('bass', 'walleye'…)
 * @param {Date} c.date
 * @param {number} c.waterTempF
 * @param {object|null} [c.trend]  the last weeks of water temperature (water-trend.js), which settles spring or fall near the turns
 * @param {boolean} [c.estimated]  the water temperature is a guess, so the phase is too
 * @returns {object|null}  null when none of the fish has known seasons
 */
export function scoreSeason({ targets = [], date, waterTempF, trend = null, estimated = false }) {
    const fish = [...new Set(targets)]
        .map((target) => ({ target, phase: seasonalPhase(target, { date, waterTempF, trend }) }))
        .filter((entry) => entry.phase);
    if (!fish.length) return null;
    const best = fish.reduce((top, entry) => (entry.phase.bite > top.phase.bite ? entry : top));
    const average = fish.reduce((sum, entry) => sum + entry.phase.bite, 0) / fish.length;
    let share = (average + best.phase.bite) / 2;
    if (estimated) share = 0.5 + (share - 0.5) * 0.6; // a guessed temperature, a guessed phase

    const quality = best.phase.bite >= 0.85 ? 'one of the best times of year'
        : best.phase.bite >= 0.6 ? 'a good time of year'
            : best.phase.bite >= 0.4 ? 'an in-between time of year' : 'a slow time of year';
    const who = fish.length > 1 ? `For ${best.target}, ${quality}` : capitalised(quality);
    return graded(share, FACTOR_MAX.season, {
        note: `${who}. ${best.phase.pattern}`,
        phase: best.phase,
        fish: fish.map(({ target, phase }) => ({ target, label: phase.label, bite: phase.bite })),
    });
}

// ---------------------------------------------------------------------------
// Barometric pressure
// ---------------------------------------------------------------------------

// Every angling dataset that tested pressure found no effect on catch rates, so the level
// earns nothing. The few points here are for weather on the move, and the evidence sets how few:
//
//   * In 13 years of compulsory creel records on Escanaba Lake (Shaw, Renik & Sass 2021) neither
//     the day's change in barometric pressure nor rain was a significant predictor of walleye or
//     muskellunge catch, and no weather variable had more than a very small effect.
//   * The one angling test of a cold front itself (Lang 2023, an undergraduate thesis) found
//     largemouth bass fed significantly less just after one. Tracked bass in Lake Travis struck
//     lures more often on a falling barometer than a rising one (Manns), in a small sample the
//     author calls confounded with cloud.
//   * What a front brings that is measured is scored where it is measured: cloud in the light,
//     wind in the wind, colder water in the water trend, lightning and floods as ceilings.
//
// What is left for the front itself is, at most, about what the moon is worth, so it keeps
// five points in a hundred: full marks ahead of a front, none under the clear "bluebird" sky
// behind a cold one. A front comes from the barometer and air temperature of the last two
// days (trend.js frontState) or from the hour-by-hour forecast (fronts.js), which also says
// what kind it is and so is known for the hours ahead. A warm front costs nothing once it is
// through: nobody reports a slump behind one.
export function scorePressure(inHg, { change3h = null, front = null, frontKind = null, sky = 'unknown' } = {}) {
    const result = (points, note, trend, rest = {}) => graded(points / FACTOR_MAX.pressure, FACTOR_MAX.pressure, { note, trend, ...rest });
    const known = isNum(inHg);
    const trend = classifyTrend(known ? change3h : null, { steadyBelow: 0.02, rapidAbove: 0.06 });
    const trendLine = trendText(trend, { unit: ' inHg', digits: 2, period: '3 hr' });
    const moving = { front: front ? { state: front, kind: frontKind } : null };
    if (front === 'passed' && frontKind === 'warm') return result(4, 'Warmer air has moved in behind a warm front — no slump to wait out', trendLine, moving);
    if (front === 'passed') {
        return sky === 'clear' || sky === 'partly'
            ? result(0, 'Bluebird sky behind a cold front — usually a tough bite', trendLine, moving)
            : result(1, 'Just behind a cold front — fish often slow for a day or two', trendLine, moving);
    }
    if (front === 'approaching') {
        const name = frontKind === 'cold' ? 'Cold front' : frontKind === 'warm' ? 'Warm front' : 'Front';
        return result(5, `${name} on its way — fish often feed ahead of it`, trendLine, moving);
    }
    if (!known) return result(3, 'No barometer reporting nearby', null);
    let points;
    let note;
    if (trend.direction === 'unknown') [points, note] = [3, 'Trend not known yet'];
    else if (trend.direction === 'steady') [points, note] = [4, 'Steady — settled weather'];
    else if (trend.direction === 'falling') {
        [points, note] = trend.rapid ? [4, 'Falling fast — a front is moving in'] : [5, 'Falling slowly — weather on the change'];
    } else {
        [points, note] = trend.rapid ? [1, 'Rising fast — just behind a front, often slow'] : [3, 'Rising — weather clearing'];
    }
    return result(points, note, trendLine);
}

// ---------------------------------------------------------------------------
// Overall score
// ---------------------------------------------------------------------------

/**
 * Rough water temperature when no sensor is nearby. Water lags air, so use the
 * average air temperature of the last few days rather than the current reading.
 */
export function estimateWaterTemp(recentAirTempsF, currentAirTempF) {
    const average = mean(recentAirTempsF ?? []);
    const estimate = isNum(average) ? average : currentAirTempF - 5;
    return Math.max(33, estimate);
}

export function bandFor(score) {
    return SCORE_BANDS.find((band) => score >= band.min) ?? SCORE_BANDS[SCORE_BANDS.length - 1];
}

/** Same score on the same day always yields the same phrase (no flicker on re-render). */
export function bitePhrase(score, date = new Date()) {
    const band = bandFor(score);
    const phrases = BITE_PHRASES[band.key];
    const day = Math.floor(date.getTime() / 86400000);
    return phrases[(day * 7 + score) % phrases.length];
}

// Factors that can spoil the fishing on their own, and the ceiling one of them sets:
// no ceiling at half marks or better, falling to 10 when the factor scores nothing.
const LIMITING = { water: 'water temperature', flow: 'river flow', wind: 'wind', waves: 'surf' };
const limitFor = (share) => Math.round(100 * clamp(0.1 + 1.8 * share, 0, 1));

/**
 * @param {object} c
 * @param {number} c.waterTempF
 * @param {boolean} [c.waterEstimated]
 * @param {number|null} [c.waterChange24h]
 * @param {number|null} [c.oxygenMgL]
 * @param {'any'|'warm'|'catfish'|'cool'|'cold'} [c.speciesGroup]
 * @param {string|null} [c.speciesLabel]  the group's name in this region, e.g. 'Smallmouth & perch'
 * @param {number|null} c.pressureInHg
 * @param {number|null} [c.pressureChange3h]
 * @param {number} c.windMph
 * @param {number|null} [c.gustMph]
 * @param {string} c.sky  sky class: 'clear' | 'partly' | 'overcast' | 'light-precip' | 'precip' | 'storm' | 'unknown'
 * @param {{ cfs: number, percentiles: object }|null} [c.flow]  river flow and its day-of-year percentiles
 * @param {string|null} [c.hazard]  a dangerous-weather warning in effect (its name), which caps the score
 * @param {'fresh'|'inshore'|'surf'} [c.mode]  style of fishing; decides which factors count and how much
 * @param {Array|null} [c.tides]  predicted highs and lows (salt water)
 * @param {number|null} [c.waveFt]  wave height at the beach (surf)
 * @param {number} [c.lat]
 * @param {number} [c.lon]
 * @param {Date} [c.date]
 * @param {string[]} [c.targets]  the fish being fished for, for the Season factor
 * @param {object|null} [c.waterTrend]  the last weeks of water temperature (water-trend.js)
 * @param {'approaching'|'passed'|null} [c.front]  a weather front on its way or just through (trend.js frontState, fronts.js frontAt)
 * @param {'cold'|'warm'|null} [c.frontKind]  which kind, when the forecast says; a front of unknown kind is taken for a cold one
 */
export function scoreConditions(c) {
    const date = c.date ?? new Date();
    const mode = c.mode in FACTOR_WEIGHTS ? c.mode : 'fresh';
    const weights = FACTOR_WEIGHTS[mode];
    const salt = mode !== 'fresh';
    const group = c.speciesGroup ?? (salt ? 'warmsalt' : 'any');
    const every = {
        water: () => scoreWaterTemp(c.waterTempF, {
            group, label: c.speciesLabel, estimated: c.waterEstimated,
            change24h: c.waterChange24h, trend: c.waterTrend ?? null, oxygenMgL: c.oxygenMgL,
        }),
        waves: () => scoreWaves(c.waveFt),
        tide: () => scoreTide(c.tides, date.getTime()),
        light: () => scoreLight({ time: date.getTime(), lat: c.lat, lon: c.lon, sky: c.sky, water: salt ? 'salt' : 'fresh', species: group }),
        wind: () => scoreWind(c.windMph, { gustMph: c.gustMph }),
        flow: () => scoreFlow(c.flow, { species: group }),
        moon: () => scoreMoon(date, c.lon),
        season: () => (c.targets?.length ? scoreSeason({
            targets: c.targets, date, waterTempF: c.waterTempF, trend: c.waterTrend ?? null, estimated: c.waterEstimated,
        }) : null),
        pressure: () => scorePressure(c.pressureInHg, { change3h: c.pressureChange3h, front: c.front ?? null, frontKind: c.frontKind ?? null, sky: c.sky }),
    };

    // Each factor is worked out as a share of full marks, then worth what this style of fishing gives it.
    const factors = Object.keys(weights)
        .map((id) => [id, every[id]()])
        .filter(([, result]) => result)
        .map(([id, result]) => {
            const points = clamp(Math.round(result.share * weights[id]), 0, weights[id]);
            return { id, max: weights[id], rating: ratingFor(points, weights[id]), ...result, points };
        });

    const earned = factors.reduce((sum, factor) => sum + factor.points, 0);
    const available = factors.reduce((sum, factor) => sum + factor.max, 0);
    const uncapped = clamp(Math.round((100 * earned) / available), 0, 100);

    // The lowest ceiling that actually bites, if any, is reported with its reason.
    const ceilings = [];
    if (c.hazard) ceilings.push({ limit: HAZARD_CAP, reason: `${c.hazard} in effect` });
    else if (c.sky === 'storm') ceilings.push({ limit: HAZARD_CAP, reason: 'Thunderstorms in the area' });
    const weakest = factors.filter((factor) => factor.id in LIMITING).sort((a, b) => a.share - b.share)[0];
    if (weakest) ceilings.push({ limit: limitFor(weakest.share), reason: `Held down by the ${LIMITING[weakest.id]}` });
    const cap = ceilings.filter((ceiling) => ceiling.limit < uncapped).sort((a, b) => a.limit - b.limit)[0] ?? null;
    const score = cap ? cap.limit : uncapped;

    return { score, band: bandFor(score), phrase: bitePhrase(score, date), factors, earned, available, cap };
}

// ---------------------------------------------------------------------------
// The hours ahead
// ---------------------------------------------------------------------------

/**
 * The best stretches of the coming hours, earliest first.
 *
 * `base` is the same object scoreConditions takes; `at(time)` returns whatever is
 * forecast to differ at that time ({ sky, windMph, gustMph }) or null.
 * Water, flow and moon phase are assumed to hold; the pressure trend is unknown ahead.
 *
 * Each half-day (solar midnight to noon, noon to midnight) offers one candidate: the
 * stretch around its best moment that stays within 4 points of it. Half-days whose
 * best is well short of the overall best are dropped. Returns nothing when the score
 * barely moves over the whole period.
 *
 * @returns {Array<{ start: number, end: number, peak: number }>} epoch-ms ranges and their best score
 */
const MIN_SPREAD_FOR_WINDOWS = 5;

/**
 * The score at regular steps from `start` to `end`: [{ t, score, band, cap }].
 *
 * `base` is the same object scoreConditions takes; `at(time)` returns whatever is forecast
 * to differ at that time ({ sky, windMph, waveFt, front, frontKind }) or null. The first
 * sample is the score right now, exactly as shown. Ahead of now the water temperature, river
 * flow and moon phase are assumed to hold, the pressure trend is unknown (a front is known
 * only where `at` gives one), and current alerts are not carried forward. Sun, moon and tide
 * are worked out for each time.
 * Samples after the first fall on the clock's own grid (:00, :20, :40).
 */
export function scoreSeries(base, { start, end, stepMinutes = 20, at = () => null } = {}) {
    const step = stepMinutes * 60 * 1000;
    const times = [start];
    for (let t = Math.floor(start / step) * step + step; t <= end; t += step) times.push(t);
    return times.map((t) => {
        const conditions = t === start
            ? { ...base, date: new Date(t) }
            : { ...base, pressureChange3h: null, front: null, frontKind: null, gustMph: null, hazard: null, ...(at(t) ?? {}), date: new Date(t) };
        const result = scoreConditions(conditions);
        return { t, score: result.score, band: result.band, cap: result.cap?.reason ?? null };
    });
}

export function bestWindows(base, { start, hours = 36, stepMinutes = 20, at = () => null, limit = 3 } = {}) {
    const HALF_DAY = 12 * 3600 * 1000;
    const step = stepMinutes * 60 * 1000;
    const solarNoon = isNum(base.lat) && isNum(base.lon) ? sunTimes(start, base.lat, base.lon).noon : start;

    const halfDays = new Map();
    let lowest = Infinity;
    let highest = -Infinity;
    for (const { t, score } of scoreSeries(base, { start, end: start + hours * 3600 * 1000, stepMinutes, at })) {
        lowest = Math.min(lowest, score);
        highest = Math.max(highest, score);
        const key = Math.floor((t - solarNoon) / HALF_DAY);
        if (!halfDays.has(key)) halfDays.set(key, []);
        halfDays.get(key).push({ t, score });
    }
    // When something holds the score flat the whole time (frozen water, a river in flood),
    // no hour is better than another and there is nothing to recommend.
    if (highest - lowest < MIN_SPREAD_FOR_WINDOWS) return [];

    const horizon = start + hours * 3600 * 1000;
    const candidates = [...halfDays.values()].map((samples) => {
        const peak = Math.max(...samples.map((sample) => sample.score));
        let first = samples.findIndex((sample) => sample.score === peak);
        let last = first;
        while (first > 0 && samples[first - 1].score >= peak - 4) first--;
        while (last + 1 < samples.length && samples[last + 1].score >= peak - 4) last++;
        // Still climbing when the look-ahead runs out: the real window lies beyond it.
        if (samples[first].t > start && samples[last].t + step > horizon && samples[samples.length - 1].score === peak) return null;
        return { start: samples[first].t, end: samples[last].t + step, peak };
    }).filter(Boolean);
    if (!candidates.length) return [];

    const best = Math.max(...candidates.map((candidate) => candidate.peak));
    return candidates.filter((candidate) => candidate.peak >= best - 10).slice(0, limit);
}

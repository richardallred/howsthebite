// Fishing score: how favourable conditions are right now, 0–100.
//
// The weights follow what has actually been measured about angler catch rates
// rather than fishing folklore (sources and reasoning are in the README):
//
//   Water temperature   35   strongest biological basis; the right range depends on the species
//   Light               30   dusk > dawn > overcast day > bright midday > night
//   Wind                12   small effect on fish; a real one on whether you can fish well and safely
//   River flow          10   only when a river gauge with a long record is in play
//   Moon                 8   real but small and inconsistent
//   Barometric pressure  5   no measured effect on catch rates; kept small, trend only
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
import { sunAltitude, sunTimes } from './sun.js';
import { classifyTrend, mean } from './trend.js';
import { clamp, isNum } from './util.js';

export const FACTOR_MAX = { water: 35, light: 30, wind: 12, flow: 10, moon: 8, pressure: 5 };

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
        prime: 'Prime range for bass, panfish and catfish',
        curve: [[33, 0.05], [45, 0.2], [54, 0.4], [64, 0.8], [69, 1], [80, 1], [85, 0.75], [90, 0.45], [95, 0.15], [98, 0]],
        oxygen: [[3, 0.2], [3.5, 0.5], [4, 0.75], [5, 1]],
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

function waterNote(tempF, share, groupId, label) {
    const group = SPECIES_GROUPS[groupId];
    // `label` names the fish actually found in the region ("Smallmouth & perch"), when known.
    if (share >= 0.95) return label && groupId !== 'any' ? `Prime range for ${label.toLowerCase()}` : group.prime;
    const coldSide = tempF < group.curve.find(([, y]) => y === 1)[0];
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
 * @param {number} tempF
 * @param {object} [options]
 * @param {'any'|'warm'|'cool'|'cold'} [options.group]
 * @param {string|null} [options.label]   what the group is called in this region, for the note
 * @param {boolean} [options.estimated]   no sensor nearby: the temperature is a guess from air temperature
 * @param {number|null} [options.change24h]  shown, but not scored: its effect on catch rates is unmeasured
 * @param {number|null} [options.oxygenMgL]  dissolved oxygen, when the station reports it
 */
export function scoreWaterTemp(tempF, { group = 'any', label = null, estimated = false, change24h = null, oxygenMgL = null } = {}) {
    const groupId = group in SPECIES_GROUPS ? group : 'any';
    let share = curve(SPECIES_GROUPS[groupId].curve, tempF);
    let note = waterNote(tempF, share, groupId, label);

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
const DUSK_LIGHT = 1;
const DAWN_LIGHT = 0.75;
const NIGHT_LIGHT = 0.35;
const DAY_LIGHT = {
    clear: 0.45, partly: 0.55, overcast: 0.68, 'light-precip': 0.68, precip: 0.6, storm: 0.6, unknown: 0.55,
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
 * @returns {{ points, note, trend, phase: 'dawn'|'dusk'|'day'|'night' }}
 */
export function scoreLight({ time, lat, lon, sky = 'unknown' }) {
    const dayShare = DAY_LIGHT[sky] ?? DAY_LIGHT.unknown;
    const dayNote = DAY_NOTES[sky] ?? DAY_NOTES.unknown;
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
        if (phase === 'dusk') note = 'Evening low light — usually the best bite of the day';
        else if (phase === 'dawn') note = 'Early-morning low light — a strong window';
        else if (phase === 'night') note = 'After dark — slower for most species, walleye and catfish excepted';
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
const FLOW_CURVE = [[0, 0.6], [10, 0.75], [25, 0.95], [35, 1], [70, 1], [80, 0.8], [90, 0.45], [95, 0.2], [100, 0]];

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
 * @returns factor result, or null when flow does not apply or has no usable record
 */
export function scoreFlow(flow) {
    const percentile = flowPercentile(flow?.cfs, flow?.percentiles);
    if (percentile === null) return null;
    let note;
    if (percentile > 95) note = 'Very high for the date — likely blown out';
    else if (percentile > 90) note = 'High for the date — fast and probably muddy';
    else if (percentile > 75) note = 'Above normal — pushy, may be off-colour';
    else if (percentile >= 25) note = 'Normal for the date';
    else if (percentile >= 10) note = 'Below normal — lower, clearer water';
    else note = 'Very low for the date — skinny, clear water';

    const median = Number(flow.percentiles[50]);
    const trend = median > 0 ? `${Math.round((flow.cfs / median) * 100)}% of the median for today` : null;
    return graded(curve(FLOW_CURVE, percentile), FACTOR_MAX.flow, { note, trend, percentile });
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
// Barometric pressure
// ---------------------------------------------------------------------------

// Every angling dataset that tested pressure found no effect on catch rates, so the level
// earns nothing. The trend keeps a few points as a marker of weather on the move: the
// slow bite behind a cold front is near-universal testimony, though barely measured.
export function scorePressure(inHg, { change3h = null } = {}) {
    const result = (points, note, trend) => graded(points / FACTOR_MAX.pressure, FACTOR_MAX.pressure, { note, trend });
    if (!isNum(inHg)) return result(3, 'No barometer reporting nearby', null);
    const trend = classifyTrend(change3h, { steadyBelow: 0.02, rapidAbove: 0.06 });
    let points;
    let note;
    if (trend.direction === 'unknown') [points, note] = [3, 'Trend not known yet'];
    else if (trend.direction === 'steady') [points, note] = [4, 'Steady — settled weather'];
    else if (trend.direction === 'falling') {
        [points, note] = trend.rapid ? [4, 'Falling fast — a front is moving in'] : [5, 'Falling slowly — weather on the change'];
    } else {
        [points, note] = trend.rapid ? [1, 'Rising fast — just behind a front, often slow'] : [3, 'Rising — weather clearing'];
    }
    return result(points, note, trendText(trend, { unit: ' inHg', digits: 2, period: '3 hr' }));
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
    return `The bite is ${phrases[(day * 7 + score) % phrases.length]}`;
}

// Factors that can spoil the fishing on their own, and the ceiling one of them sets:
// no ceiling at half marks or better, falling to 10 when the factor scores nothing.
const LIMITING = { water: 'water temperature', flow: 'river flow', wind: 'wind' };
const limitFor = (share) => Math.round(100 * clamp(0.1 + 1.8 * share, 0, 1));

/**
 * @param {object} c
 * @param {number} c.waterTempF
 * @param {boolean} [c.waterEstimated]
 * @param {number|null} [c.waterChange24h]
 * @param {number|null} [c.oxygenMgL]
 * @param {'any'|'warm'|'cool'|'cold'} [c.speciesGroup]
 * @param {string|null} [c.speciesLabel]  the group's name in this region, e.g. 'Smallmouth & perch'
 * @param {number|null} c.pressureInHg
 * @param {number|null} [c.pressureChange3h]
 * @param {number} c.windMph
 * @param {number|null} [c.gustMph]
 * @param {string} c.sky  sky class: 'clear' | 'partly' | 'overcast' | 'light-precip' | 'precip' | 'storm' | 'unknown'
 * @param {{ cfs: number, percentiles: object }|null} [c.flow]  river flow and its day-of-year percentiles
 * @param {string|null} [c.hazard]  a dangerous-weather warning in effect (its name), which caps the score
 * @param {number} [c.lat]
 * @param {number} [c.lon]
 * @param {Date} [c.date]
 */
export function scoreConditions(c) {
    const date = c.date ?? new Date();
    const results = {
        water: scoreWaterTemp(c.waterTempF, {
            group: c.speciesGroup, label: c.speciesLabel, estimated: c.waterEstimated, change24h: c.waterChange24h,
            oxygenMgL: c.oxygenMgL,
        }),
        light: scoreLight({ time: date.getTime(), lat: c.lat, lon: c.lon, sky: c.sky }),
        wind: scoreWind(c.windMph, { gustMph: c.gustMph }),
        flow: scoreFlow(c.flow),
        moon: scoreMoon(date, c.lon),
        pressure: scorePressure(c.pressureInHg, { change3h: c.pressureChange3h }),
    };

    const factors = Object.entries(results)
        .filter(([, result]) => result)
        .map(([id, result]) => ({ id, max: FACTOR_MAX[id], rating: ratingFor(result.points, FACTOR_MAX[id]), ...result }));

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

export function bestWindows(base, { start, hours = 36, stepMinutes = 20, at = () => null, limit = 3 } = {}) {
    const HALF_DAY = 12 * 3600 * 1000;
    const step = stepMinutes * 60 * 1000;
    const solarNoon = isNum(base.lat) && isNum(base.lon) ? sunTimes(start, base.lat, base.lon).noon : start;

    // Sample now, then on the clock's own grid, so windows start and end on round times.
    const times = [start];
    for (let t = Math.floor(start / step) * step + step; t <= start + hours * 3600 * 1000; t += step) times.push(t);

    const halfDays = new Map();
    let lowest = Infinity;
    let highest = -Infinity;
    for (const t of times) {
        const { score } = scoreConditions({
            ...base, pressureChange3h: null, gustMph: null, hazard: null, ...(at(t) ?? {}), date: new Date(t),
        });
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

// Fishing score: six factors that add up to 100 points.
//
//   Water temperature   20   the main driver of fish activity
//   Barometric pressure 18   level (10) + 3-hour trend (8)
//   Wind                17   a light chop beats both glass and whitecaps
//   Air temperature     15
//   Sky                 15
//   Moon phase          15   new/full best, quarters weakest
//
// Everything here is a pure function of its inputs so it can be unit tested
// (see tests/scoring.test.js) and reused for forecast scoring later.

import { BITE_PHRASES, SCORE_BANDS } from '../config.js';
import { moonInfo } from './moon.js';
import { classifyTrend, mean } from './trend.js';
import { clamp, isNum } from './util.js';

export const FACTOR_MAX = { water: 20, pressure: 18, wind: 17, air: 15, sky: 15, moon: 15 };

const between = (value, min, max) => value >= min && value <= max;
const signed = (value, digits) => `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(digits)}`;

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

export function scoreWaterTemp(tempF, { estimated = false, change24h = null } = {}) {
    let points;
    let note;
    if (between(tempF, 65, 75)) [points, note] = [20, 'Prime range — fish feeding actively'];
    else if (between(tempF, 58, 78)) [points, note] = [16, 'Very good for most species'];
    else if (between(tempF, 50, 85)) [points, note] = [12, 'Good range — fish active'];
    else if (between(tempF, 45, 90)) [points, note] = [6, tempF < 60 ? 'Cool — fish slowing down' : 'Hot — fish holding deep'];
    else if (between(tempF, 40, 95)) [points, note] = [2, tempF < 60 ? 'Cold — fish sluggish' : 'Very hot — fish stressed'];
    else [points, note] = [0, tempF < 60 ? 'Near freezing — fish barely moving' : 'Dangerously hot for fish'];

    const trend = classifyTrend(estimated ? null : change24h, { steadyBelow: 1, rapidAbove: 4 });
    if (trend.direction === 'steady') points += 2;
    else if (trend.direction === 'rising' && tempF < 65) points += 3;
    else if (trend.direction === 'falling' && tempF > 75) points += 3;
    else if (trend.rapid) points -= 2;

    return {
        points: clamp(points, 0, FACTOR_MAX.water),
        note: estimated ? `${note} (estimated)` : note,
        trend: trendText(trend, { unit: '°F', digits: 1, period: '24 hr' }),
    };
}

export function scoreAirTemp(tempF, { change24h = null } = {}) {
    let points;
    let note;
    if (between(tempF, 65, 75)) [points, note] = [15, 'Ideal comfort range'];
    else if (between(tempF, 60, 80)) [points, note] = [12, 'Very comfortable'];
    else if (between(tempF, 55, 85)) [points, note] = [8, 'Good fishing weather'];
    else if (between(tempF, 45, 95)) [points, note] = [4, tempF < 60 ? 'Chilly but manageable' : 'Hot but manageable'];
    else [points, note] = [0, tempF < 60 ? 'Cold — dress for it' : 'Extreme heat'];

    const trend = classifyTrend(change24h, { steadyBelow: 3, rapidAbove: 12 });
    if (trend.direction === 'steady') points += 1;
    else if (trend.direction === 'rising' && tempF < 70) points += 2;
    else if (trend.direction === 'falling' && tempF > 75) points += 2;
    else if (trend.rapid) points -= 2;

    return {
        points: clamp(points, 0, FACTOR_MAX.air),
        note,
        trend: trendText(trend, { unit: '°F', digits: 0, period: '24 hr' }),
    };
}

export function scorePressure(inHg, { change3h = null } = {}) {
    if (!isNum(inHg)) {
        // No barometer in reach: score it as neutral rather than guessing.
        return { points: Math.round(FACTOR_MAX.pressure / 2), note: 'No barometer reporting nearby', trend: null };
    }
    let level;
    let note;
    if (between(inHg, 30.0, 30.2)) [level, note] = [10, 'Settled, normal pressure'];
    else if (between(inHg, 29.9, 30.3)) [level, note] = [8, 'Near-normal pressure'];
    else if (between(inHg, 29.8, 30.4)) [level, note] = [6, inHg < 30.1 ? 'Slightly low pressure' : 'Slightly high pressure'];
    else if (between(inHg, 29.5, 30.7)) [level, note] = [3, inHg < 30.1 ? 'Low pressure' : 'High pressure'];
    else [level, note] = [1, inHg < 30.1 ? 'Very low pressure' : 'Very high pressure'];

    const trend = classifyTrend(change3h, { steadyBelow: 0.02, rapidAbove: 0.06 });
    let trendPoints;
    if (trend.direction === 'unknown') trendPoints = 4;
    else if (trend.direction === 'steady') trendPoints = 5;
    else if (trend.direction === 'falling') trendPoints = trend.rapid ? 6 : 8; // pre-front feeding window
    else trendPoints = trend.rapid ? 0 : 2; // post-front lockjaw

    if (trend.direction === 'falling') note += trend.rapid ? ' — front moving in' : ' — falling, often a feeding trigger';
    else if (trend.direction === 'rising') note += trend.rapid ? ' — rising fast, fish often shut down' : ' — rising';

    return {
        points: clamp(level + trendPoints, 0, FACTOR_MAX.pressure),
        note,
        trend: trendText(trend, { unit: ' inHg', digits: 2, period: '3 hr' }),
    };
}

export function scoreWind(mph) {
    let points;
    let note;
    if (between(mph, 8, 12)) [points, note] = [17, 'Perfect — good surface chop'];
    else if (between(mph, 5, 15)) [points, note] = [13, 'Good — some surface movement'];
    else if (between(mph, 3, 20)) [points, note] = [8, mph < 8 ? 'Light breeze' : 'Breezy — manageable'];
    else if (mph < 3 && mph >= 1) [points, note] = [4, 'Nearly calm — fish can see your line'];
    else if (mph > 20 && mph <= 25) [points, note] = [4, 'Strong — tough casting'];
    else if (mph < 1) [points, note] = [0, 'Dead calm — spooky fish'];
    else [points, note] = [0, 'Too windy — unsafe on open water'];
    return { points, note, trend: null };
}

const SKY_SCORES = {
    clear: [15, 'Stable, settled weather'],
    partly: [12, 'Broken cloud — good light'],
    overcast: [8, 'Flat, low light'],
    'light-precip': [4, 'Light precipitation'],
    precip: [2, 'Steady precipitation'],
    storm: [0, 'Storms — stay off the water'],
    unknown: [8, 'Conditions unknown'],
};

/** @param {string} skyClass one of SKY_CLASSES in sky.js ('clear', 'partly', 'overcast', …) */
export function scoreSky(skyClass) {
    const [points, note] = SKY_SCORES[skyClass] ?? SKY_SCORES.unknown;
    return { points, note, trend: null };
}

export function scoreMoon(date = new Date()) {
    const moon = moonInfo(date);
    // Squared so the bonus is concentrated in the few days around new and full moon.
    const pull = moon.syzygy ** 2;
    const points = Math.round(5 + 10 * pull);
    const note = pull > 0.75
        ? 'Strong solunar pull'
        : pull > 0.35 ? 'Moderate solunar pull' : 'Weak solunar pull';
    return { points: clamp(points, 0, FACTOR_MAX.moon), note, trend: `${Math.round(moon.illumination * 100)}% illuminated` };
}

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

/**
 * @param {object} c
 * @param {number} c.airTempF
 * @param {number} c.waterTempF
 * @param {boolean} [c.waterEstimated]
 * @param {number} c.pressureInHg
 * @param {number} c.windMph
 * @param {string} c.sky  sky class: 'clear' | 'partly' | 'overcast' | 'light-precip' | 'precip' | 'storm' | 'unknown'
 * @param {number|null} [c.airChange24h]
 * @param {number|null} [c.waterChange24h]
 * @param {number|null} [c.pressureChange3h]
 * @param {Date} [c.date]
 */
export function scoreConditions(c) {
    const date = c.date ?? new Date();
    const results = {
        water: scoreWaterTemp(c.waterTempF, { estimated: c.waterEstimated, change24h: c.waterChange24h }),
        pressure: scorePressure(c.pressureInHg, { change3h: c.pressureChange3h }),
        wind: scoreWind(c.windMph),
        air: scoreAirTemp(c.airTempF, { change24h: c.airChange24h }),
        sky: scoreSky(c.sky),
        moon: scoreMoon(date),
    };

    const factors = Object.entries(results).map(([id, result]) => ({
        id,
        max: FACTOR_MAX[id],
        rating: ratingFor(result.points, FACTOR_MAX[id]),
        ...result,
    }));

    const score = clamp(Math.round(factors.reduce((sum, factor) => sum + factor.points, 0)), 0, 100);
    return { score, band: bandFor(score), phrase: bitePhrase(score, date), factors };
}

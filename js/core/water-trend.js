// The water temperature over the last few weeks, reduced to what an angler reads from it:
// is the water warming or cooling, has it just dropped or jumped, and is it warm or cold
// for the date.
//
// The input is one mean per day, oldest first: [{ day: 'YYYY-MM-DD', v: °F }]. USGS
// publishes daily means for its sensors; tide stations and the satellite product report
// hourly or daily, and `dailyMeans` reduces those. Daily means are used rather than the
// latest reading because a shallow river can swing several degrees between dawn and
// mid-afternoon, which would read as a trend that is not there.

import { isNum } from './util.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// A week-long change of this much is a direction; less is steady.
const DIRECTION_F_PER_WEEK = 2;
// A three-day change of this much is a cold snap or a warm spell.
const SWING_F = 4;
// Further than this from the median for the date (and outside the middle half of years) is unusual.
const UNUSUAL_F = 2;
const MIN_DAYS = 5;

const dayStart = (day) => Date.parse(`${day}T00:00:00Z`);

/**
 * Daily means from timestamped readings [{ t, v }], by UTC date, oldest first. Days with
 * fewer than `minSamples` readings (an outage, or today so far) are left out.
 */
export function dailyMeans(points, { minSamples = 12 } = {}) {
    const days = new Map();
    for (const point of points ?? []) {
        if (!isNum(point?.t) || !isNum(point?.v)) continue;
        const day = new Date(point.t).toISOString().slice(0, 10);
        const entry = days.get(day) ?? { sum: 0, count: 0 };
        entry.sum += point.v;
        entry.count += 1;
        days.set(day, entry);
    }
    return [...days]
        .filter(([, entry]) => entry.count >= minSamples)
        .map(([day, entry]) => ({ day, v: entry.sum / entry.count }))
        .sort((a, b) => (a.day < b.day ? -1 : 1));
}

/** The daily mean `days` before the latest one, allowing a day's slack either way for gaps. */
function valueDaysBefore(daily, days) {
    const last = dayStart(daily[daily.length - 1].day);
    const wanted = last - days * DAY_MS;
    let best = null;
    for (const entry of daily) {
        const gap = Math.abs(dayStart(entry.day) - wanted);
        if (gap <= DAY_MS && (!best || gap < best.gap)) best = { gap, v: entry.v };
    }
    return best?.v ?? null;
}

/** Least-squares slope in °F per day over the entries. */
function slopePerDay(entries) {
    if (entries.length < 3) return null;
    const xs = entries.map((entry) => dayStart(entry.day) / DAY_MS);
    const meanX = xs.reduce((sum, x) => sum + x, 0) / xs.length;
    const meanY = entries.reduce((sum, entry) => sum + entry.v, 0) / entries.length;
    let num = 0;
    let den = 0;
    entries.forEach((entry, i) => {
        num += (xs[i] - meanX) * (entry.v - meanY);
        den += (xs[i] - meanX) ** 2;
    });
    return den ? num / den : null;
}

/**
 * @typedef {object} WaterTrend
 * @property {'sensor'|'tide-station'|'satellite'} source
 * @property {Array<{ day: string, v: number }>} daily   up to the last 30 days, oldest first
 * @property {number} days            how many days of record the summary rests on
 * @property {number} latestF         the most recent daily mean
 * @property {number|null} change3    °F over the last 3 days
 * @property {number|null} change7    °F over the last 7 days
 * @property {number|null} change14   °F over the last 14 days
 * @property {number|null} perWeek    fitted rate over the last 10 days, °F per week
 * @property {'warming'|'cooling'|'steady'} direction
 * @property {'cold-snap'|'warm-spell'|null} swing
 * @property {number|null} vsNormal   °F above (+) or below (−) the median for the date
 * @property {'warm'|'cold'|'normal'|null} normalState
 */

/**
 * @param {Array<{ day: string, v: number }>} daily  oldest first
 * @param {object} [options]
 * @param {'sensor'|'tide-station'|'satellite'} [options.source]
 * @param {{ p25: number, p50: number, p75: number }|null} [options.normal]  daily-mean percentiles for today's date, °F
 * @param {number} [options.now]  entries older than 30 days before this are ignored
 * @returns {WaterTrend|null}  null when there are too few days to say anything
 */
export function summariseWaterTrend(daily, { source = 'sensor', normal = null, now = Date.now() } = {}) {
    const recent = (daily ?? [])
        .filter((entry) => isNum(entry?.v) && /^\d{4}-\d{2}-\d{2}$/.test(entry?.day ?? ''))
        .filter((entry) => now - dayStart(entry.day) <= 31 * DAY_MS)
        .sort((a, b) => (a.day < b.day ? -1 : 1));
    // The newest day must be recent too: a sensor that stopped a fortnight ago says nothing about now.
    if (recent.length < MIN_DAYS || now - dayStart(recent[recent.length - 1].day) > 4 * DAY_MS) return null;

    const latestF = recent[recent.length - 1].v;
    const change = (days) => {
        const before = valueDaysBefore(recent, days);
        return isNum(before) ? latestF - before : null;
    };
    const lastTen = recent.filter((entry) => dayStart(recent[recent.length - 1].day) - dayStart(entry.day) < 10 * DAY_MS);
    const slope = lastTen.length >= MIN_DAYS ? slopePerDay(lastTen) : null;
    const perWeek = isNum(slope) ? slope * 7 : null;
    const change7 = change(7);
    const weekly = perWeek ?? change7;

    let direction = 'steady';
    if (isNum(weekly) && Math.abs(weekly) >= DIRECTION_F_PER_WEEK) direction = weekly > 0 ? 'warming' : 'cooling';

    const change3 = change(3);
    let swing = null;
    if (isNum(change3) && change3 <= -SWING_F) swing = 'cold-snap';
    else if (isNum(change3) && change3 >= SWING_F) swing = 'warm-spell';

    let vsNormal = null;
    let normalState = null;
    if (normal && isNum(normal.p50)) {
        vsNormal = latestF - normal.p50;
        normalState = 'normal';
        if (vsNormal <= -UNUSUAL_F && !(latestF >= normal.p25)) normalState = 'cold';
        else if (vsNormal >= UNUSUAL_F && !(latestF <= normal.p75)) normalState = 'warm';
    }

    return {
        source,
        daily: recent.slice(-30),
        days: Math.round((dayStart(recent[recent.length - 1].day) - dayStart(recent[0].day)) / DAY_MS) + 1,
        latestF,
        change3,
        change7,
        change14: change(14),
        perWeek,
        direction,
        swing,
        vsNormal,
        normalState,
    };
}

const degrees = (value) => `${Math.abs(value).toFixed(1)}°F`;

/**
 * Short phrases for the page, most telling first:
 * ['Down 6.2°F in 14 days', 'Cold snap: down 4.5°F in 3 days', '3.1°F colder than usual for the date'].
 */
export function describeWaterTrend(trend) {
    if (!trend) return [];
    const phrases = [];
    const span = isNum(trend.change14) ? [trend.change14, 14] : isNum(trend.change7) ? [trend.change7, 7] : null;
    if (span) {
        const [delta, days] = span;
        if (Math.abs(delta) < 1) phrases.push(`Steady over ${days} days`);
        else phrases.push(`${delta > 0 ? 'Up' : 'Down'} ${degrees(delta)} in ${days} days`);
    }
    if (trend.swing === 'cold-snap') phrases.push(`Cold snap: down ${degrees(trend.change3)} in 3 days`);
    if (trend.swing === 'warm-spell') phrases.push(`Warm spell: up ${degrees(trend.change3)} in 3 days`);
    if (trend.normalState === 'cold') phrases.push(`${degrees(trend.vsNormal)} colder than usual for the date`);
    else if (trend.normalState === 'warm') phrases.push(`${degrees(trend.vsNormal)} warmer than usual for the date`);
    else if (trend.normalState === 'normal') phrases.push('About normal for the date');
    return phrases;
}

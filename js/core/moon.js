// Moon phase from the mean synodic month. Accurate to within a few hours, which is
// plenty for an eight-phase label and a solunar-style score.

import { OBLIQUITY, RAD, siderealTime, toDays } from './sun.js';

const SYNODIC_DAYS = 29.530588853;
const DAY_MS = 24 * 60 * 60 * 1000;
// New moon of 2000-01-06 18:14 UTC.
const REFERENCE_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);

const PHASES = [
    { name: 'New Moon' },
    { name: 'Waxing Crescent' },
    { name: 'First Quarter' },
    { name: 'Waxing Gibbous' },
    { name: 'Full Moon' },
    { name: 'Waning Gibbous' },
    { name: 'Last Quarter' },
    { name: 'Waning Crescent' },
];

/** Days since the last new moon, in [0, 29.53). */
export function moonAge(date = new Date()) {
    const days = (date.getTime() - REFERENCE_NEW_MOON) / DAY_MS;
    return ((days % SYNODIC_DAYS) + SYNODIC_DAYS) % SYNODIC_DAYS;
}

export function moonInfo(date = new Date()) {
    const age = moonAge(date);
    const fraction = age / SYNODIC_DAYS; // 0 = new, 0.5 = full
    const index = Math.round(fraction * 8) % 8;
    const illumination = (1 - Math.cos(2 * Math.PI * fraction)) / 2;
    // 1 at new and full moon, 0 at the quarters.
    const syzygy = Math.abs(Math.cos(2 * Math.PI * fraction));
    return { age, fraction, illumination, syzygy, ...PHASES[index] };
}

/**
 * Where the moon is in its daily circuit at `time` (epoch ms) for a longitude:
 * how far, in degrees of hour angle, it is from crossing the meridian overhead
 * ("overhead") or on the far side of the Earth ("underfoot"). 15° is about an hour.
 * These crossings are the "major periods" of solunar tables.
 */
export function moonTransit(time, lon) {
    const d = toDays(time);
    const M = RAD * (134.963 + 13.064993 * d);
    const F = RAD * (93.272 + 13.22935 * d);
    const l = RAD * (218.316 + 13.176396 * d) + RAD * 6.289 * Math.sin(M);
    const b = RAD * 5.128 * Math.sin(F);
    const ra = Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l));
    const hourAngle = (((siderealTime(d, -lon * RAD) - ra) / RAD) % 360 + 360) % 360; // 0 = overhead, 180 = underfoot
    const toOverhead = Math.min(hourAngle, 360 - hourAngle);
    const toUnderfoot = Math.abs(hourAngle - 180);
    return toOverhead <= toUnderfoot
        ? { position: 'overhead', degreesAway: toOverhead }
        : { position: 'underfoot', degreesAway: toUnderfoot };
}

// ---------------------------------------------------------------------------
// Major periods, as times to show
// ---------------------------------------------------------------------------

/** A major period runs from an hour before the moon crosses overhead or underfoot to an hour after. */
export const MAJOR_PERIOD_HALF_MS = 60 * 60 * 1000;

const HOUR_ANGLE_DEGREES_PER_MS = 14.492 / 3600000; // the mean rate: once round in a lunar day of 24 h 50 min

/**
 * The moon's hour angle in degrees, 0–360 (0 = overhead, 180 = underfoot), from the larger
 * terms of the lunar theory in Meeus, "Astronomical Algorithms" (ch. 47), and true sidereal time.
 *
 * moonTransit() above keeps only the first term, which puts a crossing up to ten minutes out:
 * no matter to a score that fades over an hour, but too loose for a time shown to the minute.
 * This agrees with the US Naval Observatory's transit times to within a minute.
 */
function moonHourAngle(time, lon) {
    const d = toDays(time);
    const D = RAD * (297.8501921 + 12.19074912 * d); // moon's mean elongation from the sun
    const M = RAD * (357.5291092 + 0.98560028 * d); // sun's mean anomaly
    const Mm = RAD * (134.9633964 + 13.06499295 * d); // moon's mean anomaly
    const F = RAD * (93.272095 + 13.22935024 * d); // moon's mean distance from its ascending node
    const l = RAD * (218.3164477 + 13.17639648 * d
        + 6.288774 * Math.sin(Mm) + 1.274027 * Math.sin(2 * D - Mm) + 0.658314 * Math.sin(2 * D)
        + 0.213618 * Math.sin(2 * Mm) - 0.185116 * Math.sin(M) - 0.114332 * Math.sin(2 * F)
        + 0.058793 * Math.sin(2 * D - 2 * Mm) + 0.057066 * Math.sin(2 * D - M - Mm) + 0.053322 * Math.sin(2 * D + Mm)
        + 0.045758 * Math.sin(2 * D - M) - 0.040923 * Math.sin(M - Mm) - 0.03472 * Math.sin(D) - 0.030383 * Math.sin(M + Mm));
    const b = RAD * (5.128122 * Math.sin(F) + 0.280602 * Math.sin(Mm + F) + 0.277693 * Math.sin(Mm - F)
        + 0.173237 * Math.sin(2 * D - F) + 0.055413 * Math.sin(2 * D + F - Mm) + 0.046271 * Math.sin(2 * D - F - Mm)
        + 0.032573 * Math.sin(2 * D + F));
    const ra = Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l)) / RAD;
    const greenwichSidereal = 280.46061837 + 360.98564736629 * d;
    return (((greenwichSidereal + lon - ra) % 360) + 360) % 360;
}

/**
 * Each time the moon crosses overhead or underfoot between `start` and `end` (epoch ms)
 * at a longitude, earliest first: [{ t, position: 'overhead' | 'underfoot' }].
 */
export function moonTransits(start, end, lon) {
    const transits = [];
    // Crossings are the multiples of 180° of hour angle; count them from the one last passed.
    let crossing = Math.floor(moonHourAngle(start, lon) / 180) + 1;
    let t = start + (crossing * 180 - moonHourAngle(start, lon)) / HOUR_ANGLE_DEGREES_PER_MS;
    for (; ; crossing++, t += 180 / HOUR_ANGLE_DEGREES_PER_MS) {
        // The moon's own rate wanders a little about the mean, so close in on the crossing.
        for (let pass = 0; pass < 4; pass++) {
            const past = ((moonHourAngle(t, lon) - crossing * 180 + 540) % 360 + 360) % 360 - 180;
            t -= past / HOUR_ANGLE_DEGREES_PER_MS;
        }
        if (t > end) return transits;
        transits.push({ t, position: crossing % 2 === 0 ? 'overhead' : 'underfoot' });
    }
}

/**
 * The major periods that overlap `start`–`end`, earliest first:
 * [{ t, position, start, end }], where `t` is the crossing itself.
 */
export function majorPeriods(start, end, lon) {
    return moonTransits(start - MAJOR_PERIOD_HALF_MS, end + MAJOR_PERIOD_HALF_MS, lon)
        .map((transit) => ({ ...transit, start: transit.t - MAJOR_PERIOD_HALF_MS, end: transit.t + MAJOR_PERIOD_HALF_MS }))
        .filter((period) => period.end > start && period.start < end);
}

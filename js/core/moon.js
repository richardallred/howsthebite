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

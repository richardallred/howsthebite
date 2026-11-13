// Moon phase from the mean synodic month. Accurate to within a few hours, which is
// plenty for an eight-phase label and a solunar-style score.

const SYNODIC_DAYS = 29.530588853;
const DAY_MS = 24 * 60 * 60 * 1000;
// New moon of 2000-01-06 18:14 UTC.
const REFERENCE_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);

const PHASES = [
    { name: 'New Moon', icon: '🌑' },
    { name: 'Waxing Crescent', icon: '🌒' },
    { name: 'First Quarter', icon: '🌓' },
    { name: 'Waxing Gibbous', icon: '🌔' },
    { name: 'Full Moon', icon: '🌕' },
    { name: 'Waning Gibbous', icon: '🌖' },
    { name: 'Last Quarter', icon: '🌗' },
    { name: 'Waning Crescent', icon: '🌘' },
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

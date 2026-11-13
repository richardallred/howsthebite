// Sun position and the day's light events, computed locally from the standard
// low-precision solar formulas (Meeus, "Astronomical Algorithms"). Good to about
// a minute for sunrise/sunset at US latitudes, which is far finer than the score needs.

export const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
export const OBLIQUITY = RAD * 23.4397;

export const toDays = (ms) => ms / DAY_MS - 0.5 + J1970 - J2000;
const fromJulian = (j) => (j + 0.5 - J1970) * DAY_MS;

const meanAnomaly = (d) => RAD * (357.5291 + 0.98560028 * d);

function eclipticLongitude(M) {
    const centre = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    return M + centre + RAD * 102.9372 + Math.PI;
}

const declination = (L) => Math.asin(Math.sin(OBLIQUITY) * Math.sin(L));
const rightAscension = (L) => Math.atan2(Math.sin(L) * Math.cos(OBLIQUITY), Math.cos(L));
export const siderealTime = (d, lw) => RAD * (280.16 + 360.9856235 * d) - lw;

/** Sun's altitude above the horizon in degrees (negative = below) at `time` (epoch ms). */
export function sunAltitude(time, lat, lon) {
    const d = toDays(time);
    const L = eclipticLongitude(meanAnomaly(d));
    const dec = declination(L);
    const H = siderealTime(d, -lon * RAD) - rightAscension(L);
    const phi = lat * RAD;
    return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)) / RAD;
}

const SUNRISE_ALTITUDE = -0.833; // upper limb on the horizon, allowing for refraction
const CIVIL_TWILIGHT_ALTITUDE = -6;

/**
 * Light events (epoch ms) for the solar day whose noon is nearest to `time`:
 * { dawn, sunrise, noon, sunset, dusk, dayLengthHours }.
 * dawn/dusk are civil twilight. Events that do not happen (polar day or night) are null.
 */
export function sunTimes(time, lat, lon) {
    const lw = -lon * RAD;
    const phi = lat * RAD;
    const d = toDays(time);
    const n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
    const ds = 0.0009 + lw / (2 * Math.PI) + n;
    const M = meanAnomaly(ds);
    const L = eclipticLongitude(M);
    const dec = declination(L);
    const correction = 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    const noonJ = J2000 + ds + correction;

    const eventPair = (altitude) => {
        const cosH = (Math.sin(altitude * RAD) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
        if (cosH < -1 || cosH > 1) return [null, null];
        const setJ = J2000 + 0.0009 + (Math.acos(cosH) + lw) / (2 * Math.PI) + n + correction;
        return [fromJulian(noonJ - (setJ - noonJ)), fromJulian(setJ)];
    };

    const [sunrise, sunset] = eventPair(SUNRISE_ALTITUDE);
    const [dawn, dusk] = eventPair(CIVIL_TWILIGHT_ALTITUDE);
    return {
        dawn,
        sunrise,
        noon: fromJulian(noonJ),
        sunset,
        dusk,
        dayLengthHours: sunrise === null ? null : (sunset - sunrise) / 3600000,
    };
}

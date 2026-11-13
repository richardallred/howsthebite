// Small pure helpers shared by the app and the tests. No DOM access in here.

export const HOUR_MS = 60 * 60 * 1000;

export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export const isNum = (value) => typeof value === 'number' && Number.isFinite(value);

export const cToF = (c) => (c * 9) / 5 + 32;
export const hPaToInHg = (hPa) => hPa * 0.0295299830714;

const EARTH_RADIUS_MI = 3958.8;
const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance in miles. */
export function distanceMiles(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** [west, south, east, north] box that contains a circle of `radiusMi` around a point. */
export function boundingBox(lat, lon, radiusMi) {
    const dLat = radiusMi / 69.0;
    const dLon = radiusMi / (69.17 * Math.max(0.2, Math.cos(toRad(lat))));
    return [lon - dLon, Math.max(-90, lat - dLat), lon + dLon, Math.min(90, lat + dLat)];
}

/** Coordinates are rounded (~100 m) before they are stored or sent anywhere. */
export const roundCoord = (value) => Math.round(value * 1000) / 1000;

export function debounce(fn, wait) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
    };
}

/** "5 min ago", "3 hr ago", "2 days ago". */
export function timeAgo(then, now = Date.now()) {
    const minutes = Math.round((now - then) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hr ago`;
    const days = Math.round(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Round tick values covering [min, max] with roughly `target` steps. */
export function niceTicks(min, max, target = 4) {
    if (!(max > min)) {
        const pad = Math.abs(min) * 0.01 || 1;
        min -= pad;
        max += pad;
    }
    const rawStep = (max - min) / target;
    const magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const residual = rawStep / magnitude;
    const step = (residual >= 5 ? 10 : residual >= 2 ? 5 : residual >= 1 ? 2 : 1) * magnitude;
    const first = Math.floor(min / step) * step;
    const ticks = [];
    for (let v = first; v < max + step * 0.999; v += step) ticks.push(Number(v.toPrecision(12)));
    return { ticks, step, min: ticks[0], max: ticks[ticks.length - 1] };
}

const SMALL_WORDS = new Set(['at', 'near', 'of', 'the', 'in', 'on', 'above', 'below', 'and', 'to', 'by', 'from']);
const ABBREVIATIONS = {
    nr: 'near', abv: 'above', ab: 'above', blw: 'below', bl: 'below',
    lk: 'Lake', rv: 'River', riv: 'River', cr: 'Creek', ck: 'Creek', crk: 'Creek',
    trib: 'Tributary', res: 'Reservoir', rd: 'Rd', hwy: 'Hwy', st: 'St', ave: 'Ave', av: 'Ave',
    mt: 'Mt', ft: 'Ft', us: 'US', usgs: 'USGS', rr: 'RR',
};
const STATE_SUFFIX = /,\s*([A-Za-z]{2})\.?\s*$/;

/**
 * USGS station names are shouted ("FOX RIVER NR MCHENRY, IL").
 * Turn them into something readable ("Fox River near McHenry, IL").
 */
export function prettySiteName(raw) {
    if (!raw) return 'Unnamed station';
    let name = String(raw).replace(/\s+/g, ' ').replace(/\s+,/g, ',').replace(/,\s*$/, '').trim();

    let stateSuffix = '';
    const stateMatch = name.match(STATE_SUFFIX);
    if (stateMatch) {
        stateSuffix = `, ${stateMatch[1].toUpperCase()}`;
        name = name.slice(0, stateMatch.index);
    }

    const words = name.split(' ').map((word, index) => {
        const bare = word.toLowerCase().replace(/[.,]/g, '');
        const trailing = word.endsWith(',') ? ',' : '';
        if (ABBREVIATIONS[bare]) return ABBREVIATIONS[bare] + trailing;
        if (index > 0 && SMALL_WORDS.has(bare)) return bare + trailing;
        if (!/[a-z]/i.test(word)) return word; // "&", "60TH" handled below, numbers
        return word.toLowerCase()
            .replace(/(^|[-/(.'])([a-z])/g, (_, lead, ch) => lead + ch.toUpperCase())
            .replace(/^Mc([a-z])/, (_, ch) => `Mc${ch.toUpperCase()}`)
            .replace(/^(\d+)(St|Nd|Rd|Th)\b/, (_, n, suffix) => n + suffix.toLowerCase());
    });

    // Highway designations keep their state code: "Nc 73" -> "NC 73", "Nc Highway 16" -> "NC Highway 16".
    const joined = words.join(' ')
        .replace(/\b([A-Z][a-z]) (?=\d|Hwy\b|Highway\b|Route\b)/g, (_, code) => `${code.toUpperCase()} `);
    return joined + stateSuffix;
}

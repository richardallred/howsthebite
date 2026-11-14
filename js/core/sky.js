// Sky conditions as reported by the National Weather Service -> the label, icon
// and sky class the app uses. NWS describes weather two ways: a short text
// ("Mostly Cloudy", "Light Rain and Fog/Mist") and an icon URL whose path holds
// condition codes (".../icons/land/day/bkn/rain,20"). Text wins when present
// because it distinguishes light from steady precipitation.

/** Sky classes, in the order the fishing score ranks them. */
export const SKY_CLASSES = ['clear', 'partly', 'overcast', 'light-precip', 'precip', 'storm', 'unknown'];

const ICON_CLASS = {
    skc: 'clear', few: 'clear', sct: 'partly', bkn: 'overcast', ovc: 'overcast',
    fog: 'overcast', haze: 'overcast', smoke: 'overcast', dust: 'overcast', hot: 'clear', cold: 'clear',
    rain_showers_hi: 'light-precip',
    rain: 'precip', rain_showers: 'precip', snow: 'precip', sleet: 'precip', fzra: 'precip',
    rain_snow: 'precip', rain_sleet: 'precip', snow_sleet: 'precip', rain_fzra: 'precip', snow_fzra: 'precip',
    blizzard: 'storm', tsra: 'storm', tsra_sct: 'storm', tsra_hi: 'storm',
    tornado: 'storm', hurricane: 'storm', tropical_storm: 'storm',
};

const ICON_LABEL = {
    skc: 'Clear', few: 'Mostly clear', sct: 'Partly cloudy', bkn: 'Mostly cloudy', ovc: 'Overcast',
    fog: 'Fog', haze: 'Haze', smoke: 'Smoke', dust: 'Dust', rain: 'Rain', rain_showers: 'Showers',
    rain_showers_hi: 'Isolated showers', snow: 'Snow', sleet: 'Sleet', fzra: 'Freezing rain',
    tsra: 'Thunderstorms', tsra_sct: 'Scattered thunderstorms', tsra_hi: 'Isolated thunderstorms', blizzard: 'Blizzard',
};

/** Condition codes from an NWS icon URL, e.g. ".../land/night/rain,30/bkn?size=medium" -> ['rain', 'bkn']. */
export function iconCodes(url) {
    const match = /\/icons\/[a-z]+\/(day|night)\/([^?]+)/.exec(url ?? '');
    if (!match) return [];
    return match[2].split('/').map((part) => part.split(',')[0].replace(/^wind_/, ''));
}

export const iconIsDay = (url) => !/\/night\//.test(url ?? '');

function classFromText(text) {
    const t = text.toLowerCase().replace(/freezing (fog|mist)/g, '$1'); // fog, not precipitation
    if (/thunder|t-?storm|tornado|hurricane|tropical storm|squall|blizzard/.test(t)) return 'storm';
    if (/drizzle|flurries|sprinkles|light (rain|snow|showers?|sleet|freezing|ice|wintry)/.test(t)) return 'light-precip';
    if (/rain|snow|sleet|showers?|freezing|ice pellets|hail|wintry/.test(t)) return 'precip';
    if (/mostly (clear|sunny)|^(clear|sunny|fair)\b/.test(t)) return 'clear';
    if (/partly (cloudy|sunny)/.test(t)) return 'partly';
    if (/cloudy|overcast|fog|mist|haze|smoke|dust/.test(t)) return 'overcast';
    return null;
}

/** The icon in the page's sprite (index.html) that pictures a sky: the id after "i-". */
function iconFor(skyClass, text, code, isDay) {
    const t = text.toLowerCase();
    switch (skyClass) {
        case 'clear': return isDay ? (code === 'few' || /mostly/.test(t) ? 'partly' : 'sun') : 'moon';
        case 'partly': return isDay ? 'partly' : 'cloud';
        case 'overcast': return /fog|mist|haze|smoke/.test(t) || ['fog', 'haze', 'smoke'].includes(code) ? 'fog' : 'cloud';
        case 'light-precip': return /snow|flurries/.test(t) ? 'snow' : 'rain';
        case 'precip': return /snow|sleet|wintry|ice/.test(t) || /snow|sleet/.test(code ?? '') ? 'snow' : 'rain';
        case 'storm': return /blizzard/.test(t) || code === 'blizzard' ? 'snow' : 'storm';
        default: return 'thermometer';
    }
}

const sentenceCase = (text) => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase().replace(/\bfog\/mist\b/, 'fog');

/**
 * @param {object} report
 * @param {string} [report.text]  NWS textDescription / shortForecast
 * @param {string} [report.icon]  NWS icon URL
 * @param {boolean} [report.preferIcon]  forecasts: "Slight Chance Light Rain" is mostly not rain, so trust the icon's first code
 * @returns {{ class: string, label: string, icon: string }}
 */
export function describeSky({ text = '', icon = '', preferIcon = false } = {}) {
    const [code] = iconCodes(icon);
    const isDay = iconIsDay(icon);
    const cleanText = text.trim();
    const fromText = cleanText ? classFromText(cleanText) : null;
    const fromIcon = ICON_CLASS[code] ?? null;
    const skyClass = (preferIcon ? fromIcon ?? fromText : fromText ?? fromIcon) ?? 'unknown';
    const label = cleanText ? sentenceCase(cleanText) : ICON_LABEL[code] ?? 'Unknown';
    return { class: skyClass, label, icon: iconFor(skyClass, cleanText, code, isDay) };
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export const compassPoint = (degrees) => COMPASS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];

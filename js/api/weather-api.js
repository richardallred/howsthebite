// Weather from the US National Weather Service (api.weather.gov) and place
// search from Photon (OpenStreetMap). Both are key-less and CORS-enabled; NWS
// data is public domain, so nothing here restricts commercial use.
//
// How the NWS API fits together:
//   /points/{lat},{lon}                    -> forecast office + grid cell, nearby place name, time zone
//   /gridpoints/{office}/{x},{y}/forecast  -> 7-day forecast in 12-hour periods
//   /gridpoints/{office}/{x},{y}/stations  -> observation stations, nearest first
//   /stations/{id}/observations            -> what that station actually measured (current + history)

import { API, US_STATES } from '../config.js';
import { describeSky } from '../core/sky.js';
import { HOUR_MS, cToF, isNum, prettySiteName } from '../core/util.js';
import { HttpError, buildUrl, fetchJson, isAbort } from './http.js';

const PA_PER_INHG = 3386.389;
const MPH_PER_KMH = 0.621371;
const HISTORY_HOURS = 72;
const MAX_OBSERVATION_AGE_MS = 3 * HOUR_MS;
const STATIONS_LISTED = 25; // enough to reach an airport from almost anywhere
const NEAREST_TO_TRY = 4;
const BAROMETERS_TO_TRY = 2;
// Airport stations (ASOS/AWOS) have four-character ICAO ids and, unlike most roadside
// and fire-weather stations, a barometer and a sky sensor.
const AIRPORT_ID = /^[KPT][A-Z0-9]{3}$/;

/** Thrown when NWS has no data for the coordinates (outside the US and its territories). */
export class OutsideCoverageError extends Error {
    constructor() {
        super('The National Weather Service only covers the United States');
        this.name = 'OutsideCoverageError';
    }
}

/** NWS occasionally answers 5xx for a moment; one quick retry clears most of those. */
async function nwsJson(url, { signal, timeoutMs } = {}) {
    const options = { signal, timeoutMs, headers: { Accept: 'application/geo+json' } };
    try {
        return await fetchJson(url, options);
    } catch (error) {
        const retryable = !isAbort(error) && !(error instanceof HttpError && error.status < 500);
        if (!retryable) throw error;
        await new Promise((resolve) => setTimeout(resolve, 600));
        if (signal?.aborted) throw new DOMException('Superseded', 'AbortError');
        return fetchJson(url, options);
    }
}

// The grid lookup never changes for a coordinate, so share it between the
// weather load and the "use my location" place-name lookup.
const pointRequests = new Map();

function getPoint(lat, lon, signal) {
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    if (!pointRequests.has(key)) {
        const request = nwsJson(`${API.NWS}/points/${key}`, { signal })
            .then((data) => {
                const props = data?.properties;
                if (!props?.forecast || !props?.observationStations) throw new Error('NWS point lookup was missing data');
                const place = props.relativeLocation?.properties;
                return {
                    forecastUrl: props.forecast,
                    stationsUrl: props.observationStations,
                    timezone: props.timeZone,
                    place: place?.city ? [place.city, US_STATES[place.state] ?? place.state].filter(Boolean).join(', ') : null,
                };
            })
            .catch((error) => {
                pointRequests.delete(key); // never cache a failure
                if (error instanceof HttpError && error.status === 404) throw new OutsideCoverageError();
                throw error;
            });
        pointRequests.set(key, request);
    }
    return pointRequests.get(key);
}

const value = (quantity) => (isNum(quantity?.value) ? quantity.value : null);
const convert = (quantity, fn) => {
    const v = value(quantity);
    return v === null ? null : fn(v);
};

/** One station's observations, oldest first, in °F / inHg / mph. */
function parseObservations(data) {
    return (data.features ?? [])
        .map(({ properties: p }) => ({
            t: Date.parse(p.timestamp),
            tempF: convert(p.temperature, cToF),
            // Altimeter setting: reported with nearly every observation, unlike seaLevelPressure,
            // and already adjusted to sea level. Mixing the two would fake jumps in the trend.
            pressureInHg: convert(p.barometricPressure, (pa) => pa / PA_PER_INHG),
            windMph: convert(p.windSpeed, (kmh) => kmh * MPH_PER_KMH),
            gustMph: convert(p.windGust, (kmh) => kmh * MPH_PER_KMH),
            windDirection: value(p.windDirection),
            feelsLikeF: convert(p.windChill, cToF) ?? convert(p.heatIndex, cToF),
            humidity: value(p.relativeHumidity),
            text: p.textDescription ?? '',
            icon: p.icon ?? '',
        }))
        .filter((obs) => isNum(obs.t))
        .sort((a, b) => a.t - b.t);
}

/** Latest observation (not older than `maxAge`) for which `pick` returns something. */
function latest(observations, pick, now, maxAge = MAX_OBSERVATION_AGE_MS) {
    for (let i = observations.length - 1; i >= 0; i--) {
        const obs = observations[i];
        if (now - obs.t > maxAge) break;
        const picked = pick(obs);
        if (picked !== null && picked !== undefined && picked !== '') return { obs, value: picked };
    }
    return null;
}

/**
 * Each reading takes its most recent valid value from the last few hours: a
 * station's newest report often lacks one field (wind is the usual one).
 */
const currentTemp = (observations, now) => latest(observations, (obs) => obs.tempF, now);
const currentWind = (observations, now) => latest(observations, (obs) => obs.windMph, now);
const currentPressure = (observations, now) => latest(observations, (obs) => obs.pressureInHg, now);
const currentSky = (observations, now) => latest(observations, (obs) => (obs.text || obs.icon ? obs : null), now)?.value ?? null;

/** Keep at most ~`max` evenly spaced points (some stations report every five minutes). */
function thin(series, max = 300) {
    const step = Math.ceil(series.length / max);
    if (step <= 1) return series;
    return series.filter((_, index) => index % step === 0 || index === series.length - 1);
}

const seriesOf = (observations, field) => thin(
    observations.filter((obs) => isNum(obs[field])).map((obs) => ({ t: obs.t, v: obs[field] })),
);

async function fetchObservations(station, start, signal) {
    const data = await nwsJson(buildUrl(`${API.NWS}/stations/${station.id}/observations`, { start, limit: 500 }), { signal });
    return parseObservations(data);
}

/**
 * Pick the stations to read from.
 *
 * Temperature and wind are local, so they come from the nearest station that
 * reports both. Many rural stations have no barometer; pressure changes slowly
 * over distance, so it is then borrowed from the nearest airport station.
 */
async function observe(stations, signal) {
    const now = Date.now();
    const start = `${new Date(now - HISTORY_HOURS * HOUR_MS).toISOString().slice(0, 19)}Z`;
    const tried = new Set();
    let lastError = null;

    const attempt = async (station) => {
        tried.add(station.id);
        try {
            return await fetchObservations(station, start, signal);
        } catch (error) {
            if (isAbort(error)) throw error;
            lastError = error;
            return [];
        }
    };

    let primary = null;
    for (const station of stations.slice(0, NEAREST_TO_TRY)) {
        const observations = await attempt(station);
        if (currentTemp(observations, now) && currentWind(observations, now)) {
            primary = { station, observations };
            break;
        }
    }
    if (!primary) throw lastError ?? new Error('No nearby weather station is reporting');

    let barometer = currentPressure(primary.observations, now) ? primary : null;
    if (!barometer) {
        const airports = stations.filter((station) => AIRPORT_ID.test(station.id) && !tried.has(station.id));
        for (const station of airports.slice(0, BAROMETERS_TO_TRY)) {
            const observations = await attempt(station);
            if (currentPressure(observations, now)) {
                barometer = { station, observations };
                break;
            }
        }
    }

    return { now, primary, barometer };
}

/** "12 to 15 mph" -> 15 */
const maxWind = (text) => Math.max(0, ...(String(text ?? '').match(/\d+/g) ?? []).map(Number));

/** NWS 12-hour periods -> one entry per local calendar day. */
function dailyFrom(periods, timezone) {
    let dayKey;
    try {
        dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch {
        dayKey = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' });
    }

    const days = new Map();
    for (const period of periods ?? []) {
        const start = Date.parse(period.startTime);
        if (!isNum(start)) continue;
        const key = dayKey.format(start);
        if (!days.has(key)) days.set(key, { t: start, day: null, nights: [] });
        const entry = days.get(key);
        if (period.isDaytime) entry.day = period;
        else entry.nights.push(period);
    }

    return [...days.values()].map(({ t, day, nights }) => {
        const main = day ?? nights[0];
        const all = [day, ...nights].filter(Boolean);
        const lows = nights.map((night) => night.temperature).filter(isNum);
        const sky = describeSky({ text: main.shortForecast, icon: main.icon, preferIcon: true });
        return {
            t,
            label: sky.label,
            icon: sky.emoji,
            highF: isNum(day?.temperature) ? day.temperature : null, // null once the daytime period has passed
            lowF: lows.length ? Math.min(...lows) : null,
            precipChance: Math.max(0, ...all.map((period) => period.probabilityOfPrecipitation?.value ?? 0)),
            windMaxMph: Math.max(...all.map((period) => maxWind(period.windSpeed))),
        };
    });
}

/** The forecast period that covers `now`, as a stand-in when no station reports the sky. */
function forecastSky(periods, now) {
    const period = (periods ?? []).find((p) => Date.parse(p.startTime) <= now && now < Date.parse(p.endTime)) ?? periods?.[0];
    return period ? { text: period.shortForecast, icon: period.icon } : null;
}

/**
 * Current conditions (from the nearest reporting stations), 72 hours of observed
 * temperature and pressure, and a daily forecast. °F / mph / inHg, epoch-ms timestamps.
 * `current.pressureInHg` is null in the rare case that no barometer is in reach.
 */
export async function fetchWeather(lat, lon, { signal } = {}) {
    const point = await getPoint(lat, lon, signal);

    const [forecast, stationList] = await Promise.all([
        nwsJson(`${point.forecastUrl}?units=us`, { signal }),
        nwsJson(`${point.stationsUrl}?limit=${STATIONS_LISTED}`, { signal }),
    ]);
    const periods = forecast.properties?.periods;

    const stations = (stationList.features ?? [])
        .map((feature) => ({ id: feature.properties?.stationIdentifier, name: prettySiteName(feature.properties?.name) }))
        .filter((station) => station.id);
    const { now, primary, barometer } = await observe(stations, signal);

    const temp = currentTemp(primary.observations, now);
    const wind = currentWind(primary.observations, now);
    const pressure = barometer ? currentPressure(barometer.observations, now) : null;
    const gust = latest(primary.observations, (obs) => obs.gustMph, now, HOUR_MS);
    const skyReport = currentSky(primary.observations, now)
        ?? (barometer ? currentSky(barometer.observations, now) : null)
        ?? forecastSky(periods, now);

    return {
        fetchedAt: Date.now(),
        timezone: point.timezone,
        station: primary.station,
        // Named only when pressure is borrowed from a different station than temperature and wind.
        pressureStation: barometer && barometer.station.id !== primary.station.id ? barometer.station : null,
        current: {
            time: temp.obs.t,
            tempF: temp.value,
            feelsLikeF: temp.obs.feelsLikeF,
            humidity: temp.obs.humidity,
            pressureInHg: pressure?.value ?? null,
            windMph: wind.value,
            windDirection: wind.obs.windDirection,
            gustMph: gust && gust.value > wind.value ? gust.value : null,
            sky: describeSky({ text: skyReport?.text, icon: skyReport?.icon }),
        },
        hourly: {
            temp: seriesOf(primary.observations, 'tempF'),
            pressure: barometer ? seriesOf(barometer.observations, 'pressureInHg') : [],
        },
        daily: dailyFrom(periods, point.timezone),
    };
}

/**
 * Nearest city/state for a coordinate. Returns null rather than throwing:
 * a missing name should never block the app.
 */
export async function reverseGeocode(lat, lon, { signal } = {}) {
    try {
        return (await getPoint(lat, lon, signal)).place;
    } catch (error) {
        if (isAbort(error)) throw error;
        return null;
    }
}

// ---------------------------------------------------------------------------
// Place search (Photon / OpenStreetMap)
// ---------------------------------------------------------------------------

// OpenStreetMap tags the search asks for, and how each kind is labelled.
// Anything else Photon returns (basins, wastewater ponds, moats…) is skipped.
const SEARCH_TAGS = [
    'place:city', 'place:town', 'place:village', 'place:hamlet',
    'water', 'natural:water', 'natural:bay', 'waterway:river', 'waterway:stream', 'waterway:canal',
];
const TOWN_KINDS = new Set(['city', 'town', 'village', 'hamlet']);
const WATER_KINDS = {
    reservoir: 'Reservoir', lake: 'Lake', water: 'Lake', pond: 'Pond', oxbow: 'Lake', lagoon: 'Lagoon',
    river: 'River', stream: 'Stream', canal: 'Canal', bay: 'Bay',
};
const FLOWING = new Set(['River', 'Stream', 'Canal']);

const STATE_BY_NAME = Object.fromEntries(
    Object.entries(US_STATES).map(([code, name]) => [name.toLowerCase(), code]),
);

function stateCodeFrom(text) {
    const cleaned = text.trim().toLowerCase();
    if (!cleaned) return null;
    if (US_STATES[cleaned.toUpperCase()]) return cleaned.toUpperCase();
    return STATE_BY_NAME[cleaned] ?? null;
}

const countyLabel = (county) => (county && !/county|parish|borough|census area|city/i.test(county) ? `${county} County` : county);

/**
 * Search US towns, lakes, reservoirs and rivers by name.
 * Accepts "Asheville", "Lake Norman", "Asheville, NC" or "Jordan Lake, North Carolina";
 * a state narrows the results.
 */
export async function searchPlaces(query, { signal } = {}) {
    const [namePart, ...rest] = query.split(',');
    const name = namePart.trim();
    if (name.length < 2) return [];
    const wantedState = stateCodeFrom(rest.join(','));

    const url = buildUrl(API.PHOTON, {
        q: wantedState ? `${name} ${US_STATES[wantedState]}` : name,
        limit: 30,
        lang: 'en',
    });
    for (const tag of SEARCH_TAGS) url.searchParams.append('osm_tag', tag);
    const data = await fetchJson(url, { signal, timeoutMs: 6000 });

    const typed = name.toLowerCase();
    const tokens = typed.split(/\s+/).filter(Boolean);
    const seen = new Set();
    const places = [];
    for (const feature of data.features ?? []) {
        const props = feature.properties ?? {};
        const coords = feature.geometry?.coordinates;
        if (props.countrycode !== 'US' || !props.name || !coords) continue;

        const isTown = props.osm_key === 'place' && TOWN_KINDS.has(props.osm_value);
        const waterKind = isTown ? null : WATER_KINDS[props.osm_value];
        if (!isTown && !waterKind) continue;
        if (wantedState && STATE_BY_NAME[(props.state ?? '').toLowerCase()] !== wantedState) continue;

        // Photon matches loosely; keep only names in which every typed word starts some word.
        const words = props.name.toLowerCase().split(/[^a-z0-9']+/);
        if (!tokens.every((token) => words.some((word) => word.startsWith(token)))) continue;

        const place = {
            name: [props.name, props.state].filter(Boolean).join(', '),
            detail: [waterKind, countyLabel(props.county)].filter(Boolean).join(' · '),
            lat: coords[1],
            lon: coords[0],
        };
        if (waterKind) place.kind = FLOWING.has(waterKind) ? 'river' : 'lake';

        const key = `${place.name}|${place.detail}`.toLowerCase(); // rivers come back once per mapped segment
        if (seen.has(key)) continue;
        seen.add(key);
        // Names that start with what was typed beat names that merely contain it;
        // otherwise Photon's own order (roughly by importance) stands.
        places.push({ place, rank: props.name.toLowerCase().startsWith(typed) ? 0 : 1 });
    }

    return places.sort((a, b) => a.rank - b.rank).slice(0, 8).map(({ place }) => place);
}

// Salt-water data, all from US government services (public domain, no keys):
//
//   NOAA CO-OPS (api.tidesandcurrents.noaa.gov)
//       tide predictions (highs and lows) and observed water temperature
//   NWS beach forecast (mapservices.weather.noaa.gov)
//       surf height, rip-current risk and water temperature for forecast beaches, in season
//   NWS marine grid (api.weather.gov)
//       wave-height forecast for the sea off a beach, all year
//   Sea-surface temperature (this site's /api/sst proxy in front of a NOAA satellite product)
//       for coasts with no thermometer nearby
//
// CO-OPS has no "nearest station" search, so the app carries a station list
// (data/coops-stations.json, rebuilt by scripts/update-coops-stations.mjs).

import { API } from '../config.js';
import { HOUR_MS, distanceMiles, isNum } from '../core/util.js';
import { HttpError, buildUrl, fetchJson, isAbort } from './http.js';

const TIMEOUT_MS = 8000; // everything here is optional: the score copes without it
const HAS_TIDES = 1;
const HAS_WATER_TEMP = 2;

let stationList = null;

/** The bundled CO-OPS station list: [[id, name, lat, lon, flags], …]. Loaded once. */
function loadStationList(signal) {
    if (!stationList) {
        stationList = fetchJson(new URL('data/coops-stations.json', document.baseURI), { signal, timeoutMs: TIMEOUT_MS })
            .catch((error) => {
                stationList = null; // try again next time
                throw error;
            });
    }
    return stationList;
}

/**
 * The CO-OPS stations nearest a point: { tide: [...], temp: [...] }, each nearest first,
 * as { id, name, lat, lon, distanceMi }. Both lists are empty far from the sea.
 */
export async function nearestCoastStations(lat, lon, { signal, tideWithinMi = 12, tempWithinMi = 30 } = {}) {
    const rows = await loadStationList(signal);
    const near = (flag, withinMi, count) => rows
        .filter((row) => row[4] & flag)
        .map(([id, name, stationLat, stationLon]) => ({ id, name, lat: stationLat, lon: stationLon, distanceMi: distanceMiles(lat, lon, stationLat, stationLon) }))
        .filter((station) => station.distanceMi <= withinMi)
        .sort((a, b) => a.distanceMi - b.distanceMi)
        .slice(0, count);
    return { tide: near(HAS_TIDES, tideWithinMi, 2), temp: near(HAS_WATER_TEMP, tempWithinMi, 3) };
}

/** CO-OPS answers some failures with HTTP 200 and an `error` object, others with HTTP 400. */
async function coops(params, signal) {
    const data = await fetchJson(buildUrl(API.COOPS, {
        ...params, time_zone: 'gmt', units: 'english', format: 'json', application: 'fishing-conditions',
    }), { signal, timeoutMs: TIMEOUT_MS });
    if (data?.error) throw new Error(data.error.message ?? 'CO-OPS returned an error');
    return data;
}

const gmt = (text) => Date.parse(`${String(text).replace(' ', 'T')}:00Z`);
const stamp = (time) => new Date(time).toISOString().slice(0, 16).replace(/-/g, '').replace('T', ' '); // yyyyMMdd HH:mm

/**
 * Predicted highs and lows from a day back to about three and a half days ahead:
 * [{ t, heightFt, type: 'H'|'L' }], oldest first. Heights are above mean lower low water.
 */
export async function fetchTides(stationId, { signal, now = Date.now() } = {}) {
    const data = await coops({
        product: 'predictions', interval: 'hilo', datum: 'MLLW', station: stationId,
        // From far enough back for coasts with one tide a day, to past the end of the day after tomorrow.
        begin_date: stamp(now - 30 * HOUR_MS), range: 112,
    }, signal);
    return (data.predictions ?? [])
        .map((entry) => ({ t: gmt(entry.t), heightFt: Number.parseFloat(entry.v), type: entry.type === 'H' ? 'H' : 'L' }))
        .filter((entry) => isNum(entry.t) && isNum(entry.heightFt))
        .sort((a, b) => a.t - b.t);
}

const MAX_WATER_TEMP_AGE_MS = 6 * HOUR_MS;

/** Latest water temperature at a station: { tempF, time }, or null if it is not reporting. */
export async function fetchCoastWaterTemp(stationId, { signal, now = Date.now() } = {}) {
    try {
        const data = await coops({ product: 'water_temperature', station: stationId, date: 'latest' }, signal);
        const latest = data.data?.[data.data.length - 1];
        const tempF = Number.parseFloat(latest?.v);
        const time = gmt(latest?.t);
        if (!isNum(tempF) || !isNum(time) || now - time > MAX_WATER_TEMP_AGE_MS || tempF < 28 || tempF > 100) return null;
        return { tempF, time };
    } catch (error) {
        if (isAbort(error)) throw error;
        return null; // "No data was found" is routine: sensors go offline
    }
}

// ---------------------------------------------------------------------------
// NWS beach forecast
// ---------------------------------------------------------------------------

/** "2 to 3 feet." -> 3, "Around 2 feet" -> 2, "1 foot or less" -> 1 */
export function parseSurfFeet(text) {
    const numbers = (String(text ?? '').match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter((n) => n < 40);
    return /f(?:ee|oo)t|ft/i.test(String(text)) && numbers.length ? Math.max(...numbers) : null;
}

/** "in the upper 70s" -> 78, "mid 60s" -> 65, "around 72 degrees" -> 72 */
export function parseWaterTempF(text) {
    const value = String(text ?? '').toLowerCase();
    const decade = /(\d)0s/.exec(value);
    if (decade) {
        const base = Number(decade[1]) * 10;
        if (/upper|high/.test(value)) return base + 8;
        if (/lower|low/.test(value)) return base + 2;
        return base + 5;
    }
    const number = /\b(\d{2})\b/.exec(value);
    return number && Number(number[1]) >= 30 && Number(number[1]) <= 95 ? Number(number[1]) : null;
}

const BEACH_SEARCH_METRES = 5000; // forecast areas are thin strips along the shore

/**
 * Today's NWS surf-zone forecast for the beach at (or within a few miles of) a point.
 * Returns null when no forecast beach is near: the place is not an ocean beach.
 * Fields are null when the local office issues no surf forecast at this time of year.
 * @returns {null | { beach: string, rip: 'low'|'moderate'|'high'|null, surfFt: number|null, waterTempF: number|null }}
 */
export async function fetchBeachForecast(lat, lon, { signal } = {}) {
    const data = await fetchJson(buildUrl(API.NWS_BEACH, {
        f: 'json',
        geometry: `${lon},${lat}`,
        geometryType: 'esriGeometryPoint',
        inSR: 4326,
        spatialRel: 'esriSpatialRelIntersects',
        distance: BEACH_SEARCH_METRES,
        units: 'esriSRUnit_Meter',
        outFields: 'beachname,rip,surf,wtemp,productdat',
        returnGeometry: false,
    }), { signal, timeoutMs: TIMEOUT_MS });
    if (data?.error) throw new Error(data.error.message ?? 'Beach forecast query failed');
    const attributes = data.features?.[0]?.attributes;
    if (!attributes) return null;
    const rip = /^(low|moderate|high)\b/i.exec(String(attributes.rip ?? '').trim())?.[1].toLowerCase() ?? null;
    return {
        beach: String(attributes.beachname ?? '').trim() || 'Local beaches',
        rip,
        surfFt: parseSurfFeet(attributes.surf),
        waterTempF: parseWaterTempF(attributes.wtemp),
    };
}

// ---------------------------------------------------------------------------
// NWS marine wave forecast
// ---------------------------------------------------------------------------

const NWS_HEADERS = { Accept: 'application/geo+json' };
const PROBE_KM = 8;
const PROBE_BEARINGS = [90, 180, 270, 0, 135, 225, 45, 315];
// Ocean and gulf marine zones; Great Lakes zones (LM, LH, …) and anything else are ignored.
const OCEAN_ZONE = /^(AM|AN|GM|PZ|PK|PH|PM|PS)Z/;
const FEET_PER_METRE = 3.28084;

function offset(lat, lon, bearingDeg, km) {
    const bearing = (bearingDeg * Math.PI) / 180;
    const dLat = (km / 111.2) * Math.cos(bearing);
    const dLon = (km / (111.2 * Math.cos((lat * Math.PI) / 180))) * Math.sin(bearing);
    return [Number((lat + dLat).toFixed(4)), Number((lon + dLon).toFixed(4))];
}

/** "2026-11-13T10:00:00+00:00/PT4H" -> [start, end] in epoch ms */
export function parseInterval(validTime) {
    const [startText, durationText] = String(validTime).split('/');
    const start = Date.parse(startText);
    const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(durationText ?? '');
    if (!isNum(start) || !match) return null;
    const hours = Number(match[1] ?? 0) * 24 + Number(match[2] ?? 0) + Number(match[3] ?? 0) / 60;
    return [start, start + hours * HOUR_MS];
}

/** Wave heights from one NWS grid cell: [{ start, end, heightFt }], or [] when the cell has no real wave data. */
export function parseWaveGrid(grid) {
    const properties = grid?.properties ?? {};
    const periods = (properties.waveHeight?.values ?? [])
        .map((entry) => {
            const interval = parseInterval(entry.validTime);
            return interval && isNum(entry.value) ? { start: interval[0], end: interval[1], heightFt: entry.value * FEET_PER_METRE } : null;
        })
        .filter(Boolean);
    // Land cells carry a single zero for the whole week; so do some masked shoreline cells.
    if (isNum(properties.elevation?.value) && properties.elevation.value > 1) return [];
    if (periods.length < 3 || periods.every((period) => period.heightFt === 0)) return [];
    return periods;
}

/**
 * Find a forecast grid cell over open water off a beach, and its wave forecast.
 * The beach's own cell is land and has no waves, so points a few miles out are tried
 * in every direction until one lies in an ocean marine zone with real wave data.
 * `knownGridUrl` (from an earlier visit) skips the search.
 * @returns {null | { gridUrl: string, periods: Array<{ start, end, heightFt }> }}
 */
export async function fetchWaveForecast(lat, lon, { signal, knownGridUrl = null } = {}) {
    const read = async (gridUrl) => {
        const periods = parseWaveGrid(await fetchJson(gridUrl, { signal, timeoutMs: TIMEOUT_MS, headers: NWS_HEADERS }));
        return periods.length ? { gridUrl, periods } : null;
    };
    if (knownGridUrl) {
        const known = await read(knownGridUrl).catch((error) => {
            if (isAbort(error)) throw error;
            return null;
        });
        if (known) return known;
    }

    const probes = await Promise.all(PROBE_BEARINGS.map(async (bearing) => {
        const [probeLat, probeLon] = offset(lat, lon, bearing, PROBE_KM);
        try {
            const zones = await fetchJson(`${API.NWS}/zones?type=coastal&point=${probeLat},${probeLon}`, { signal, timeoutMs: TIMEOUT_MS, headers: NWS_HEADERS });
            const zone = (zones.features ?? []).map((feature) => feature.properties ?? {}).find((props) => OCEAN_ZONE.test(props.id ?? ''));
            return zone ? { lat: probeLat, lon: probeLon, open: /\bNM\b/i.test(zone.name ?? '') } : null;
        } catch (error) {
            if (isAbort(error)) throw error;
            return null;
        }
    }));
    // Open-ocean zones ("… out 20 NM") before bays and sounds.
    const candidates = probes.filter(Boolean).sort((a, b) => Number(b.open) - Number(a.open)).slice(0, 3);
    for (const candidate of candidates) {
        try {
            const point = await fetchJson(`${API.NWS}/points/${candidate.lat},${candidate.lon}`, { signal, timeoutMs: TIMEOUT_MS, headers: NWS_HEADERS });
            const gridUrl = point.properties?.forecastGridData;
            const found = gridUrl ? await read(gridUrl) : null;
            if (found) return found;
        } catch (error) {
            if (isAbort(error)) throw error;
        }
    }
    return null;
}

/** Wave height (ft) at a time from fetchWaveForecast's periods; null outside them. */
export const waveHeightAt = (periods, time) => (periods ?? []).find((period) => period.start <= time && time < period.end)?.heightFt ?? null;

// ---------------------------------------------------------------------------
// Sea-surface temperature (satellite), through the site's proxy
// ---------------------------------------------------------------------------

let sstProxyAvailable = typeof document === 'undefined' ? false : null;

/**
 * Satellite sea-surface temperature near a point: { tempF, time }, or null when the
 * proxy is not deployed (plain static hosting) or has no reading for the spot.
 */
export async function fetchSeaSurfaceTemp(lat, lon, { signal } = {}) {
    if (sstProxyAvailable === false) return null;
    try {
        const data = await fetchJson(buildUrl(new URL(API.SST_PROXY, document.baseURI), { lat: lat.toFixed(2), lon: lon.toFixed(2) }), { signal, timeoutMs: TIMEOUT_MS + 4000 });
        sstProxyAvailable = true;
        return isNum(data?.tempF) && isNum(data?.time) ? { tempF: data.tempF, time: data.time } : null;
    } catch (error) {
        if (isAbort(error)) throw error;
        const notDeployed = (error instanceof HttpError && [404, 405].includes(error.status)) || error instanceof SyntaxError;
        if (notDeployed && sstProxyAvailable === null) sstProxyAvailable = false;
        return null;
    }
}

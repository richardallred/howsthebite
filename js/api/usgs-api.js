// Live water temperature, level and flow from the USGS Water Data OGC API.
// Docs: https://api.waterdata.usgs.gov/docs/ogcapi/
//
// Finding stations takes two small requests:
//   1. latest-continuous    — every sensor in a bounding box that has reported
//                             recently, with its latest reading
//   2. monitoring-locations — names and site types for the nearest of those
// A further request per series (continuous) loads the last 48 hours for a chart, and
// one to the Statistics API says what a river gauge normally reads on today's date.

import { API, APP } from '../config.js';
import {
    HOUR_MS, boundingBox, cToF, distanceMiles, isNum, prettySiteName,
} from '../core/util.js';
import { HttpError, buildUrl, fetchJson, isAbort } from './http.js';

const TIMEOUT_MS = 8000; // water data is optional: fall back to an estimate rather than stall the page

// USGS parameter codes -> what the app calls them.
// There is no nationwide feed of true water *depth*. What USGS does publish:
//   gage height  — river/lake surface height above the gauge's own fixed reference point
//   discharge    — river flow
//   elevation    — lake/reservoir surface height above a sea-level datum
const PARAMETERS = {
    '00010': { measure: 'temp' },
    '00065': { measure: 'gage' },
    '00060': { measure: 'flow' },
    '00062': { measure: 'elevation', datum: 'local datum' },
    '62614': { measure: 'elevation', datum: 'NGVD 29' },
    '62615': { measure: 'elevation', datum: 'NAVD 88' },
    '72214': { measure: 'elevation', datum: 'IGLD' },
    // Only a minority of stations carry these (roughly one gauge in six in the Southeast,
    // far fewer in the north), so they are a bonus when present, never expected.
    '00300': { measure: 'oxygen' }, // dissolved oxygen, mg/L
    63680: { measure: 'turbidity' }, // FNU
};

// Site types that are open water an angler could fish (wells, springs, etc. are dropped).
const SITE_KINDS = [
    { prefix: 'LK', kind: 'lake', label: 'Lake' },
    { prefix: 'ST', kind: 'river', label: 'River' },
    { prefix: 'ES', kind: 'river', label: 'Estuary' },
];
const SITE_LABEL_OVERRIDES = { 'ST-CA': 'Canal', 'ST-DCH': 'Ditch', 'ST-TS': 'Tidal river' };

// null = not yet known, true = same-origin proxy is deployed, false = talk to USGS directly.
let proxyAvailable = typeof document === 'undefined' ? false : null;

/**
 * GET from USGS. Goes through the site's caching proxy when it is deployed
 * (see functions/api/usgs); otherwise straight to USGS. The first request
 * finds out which: a static host answers the proxy path with a 404 (or with
 * an HTML page), and from then on requests go direct.
 *
 * `path` is the proxy's path, `directUrl` the same resource at USGS.
 */
async function usgsRequest(path, directUrl, params, { signal } = {}) {
    if (proxyAvailable !== false) {
        try {
            const url = buildUrl(new URL(`${API.USGS_PROXY}/${path}`, document.baseURI), params);
            const data = await fetchJson(url, { signal, timeoutMs: TIMEOUT_MS + 4000 });
            proxyAvailable = true;
            return data;
        } catch (error) {
            const notDeployed = (error instanceof HttpError && [404, 405].includes(error.status)) || error instanceof SyntaxError;
            if (isAbort(error) || proxyAvailable === true || !notDeployed) {
                if (error instanceof HttpError) proxyAvailable = true; // it answered, so it exists
                throw error;
            }
            proxyAvailable = false;
        }
    }
    return fetchJson(buildUrl(directUrl, { ...params, api_key: APP.USGS_API_KEY }), { signal, timeoutMs: TIMEOUT_MS });
}

/** One collection of the OGC API (latest-continuous, monitoring-locations, continuous). */
const usgsJson = (name, params, options) => usgsRequest(`${name}/items`, `${API.USGS}/${name}/items`, { f: 'json', ...params }, options);

// The search box is snapped to a 0.1° grid (about 7 miles) and widened to match, so
// people near each other ask the identical question and can share one cached answer.
// It also means the exact spot is never sent, only its neighbourhood.
const GRID_DEGREES = 0.1;
const GRID_MARGIN_MI = 6;
const snap = (value) => Math.round(value / GRID_DEGREES) * GRID_DEGREES;

const toFahrenheit = (value, unit) => (/f/i.test(unit ?? '') ? value : cToF(value));

function plausible(measure, value) {
    if (!isNum(value)) return false;
    if (measure === 'temp') return value > -5 && value < 60; // °C
    if (measure === 'flow') return value >= 0;
    if (measure === 'oxygen') return value >= 0 && value < 25; // mg/L
    if (measure === 'turbidity') return value >= 0 && value < 5000; // FNU
    return value > -500 && value < 20000; // feet
}

/**
 * Nearby stations with recent readings, nearest first. Each station has some of:
 *   tempF + readingTime + timeSeriesId   water temperature
 *   level { type: 'gage'|'elevation', valueFt, time, timeSeriesId, parameterCode, datum }
 *   flow  { cfs, time }
 *   oxygen { mgL, time }, turbidity { fnu, time }   where the station has those probes
 */
export async function findStations(lat, lon, { signal, radiusMi = APP.STATION_RADIUS_MI } = {}) {
    const latest = await usgsJson('latest-continuous', {
        parameter_code: Object.keys(PARAMETERS).sort().join(','),
        bbox: boundingBox(snap(lat), snap(lon), radiusMi + GRID_MARGIN_MI).map((n) => n.toFixed(2)).join(','),
        time: `PT${APP.STATION_MAX_READING_AGE_H}H`,
        properties: 'monitoring_location_id,time_series_id,parameter_code,time,value,unit_of_measure',
        limit: 5000,
    }, { signal });

    // A station can carry several sensors for one measure (e.g. at different depths): keep the freshest.
    const byStation = new Map();
    for (const feature of latest.features ?? []) {
        const props = feature.properties ?? {};
        const coords = feature.geometry?.coordinates;
        const parameter = PARAMETERS[props.parameter_code];
        const value = Number.parseFloat(props.value);
        const time = Date.parse(props.time);
        if (!coords || !parameter || !isNum(time) || !plausible(parameter.measure, value)) continue;

        const distanceMi = distanceMiles(lat, lon, coords[1], coords[0]);
        if (distanceMi > radiusMi) continue;

        let station = byStation.get(props.monitoring_location_id);
        if (!station) {
            station = { id: props.monitoring_location_id, lat: coords[1], lon: coords[0], distanceMi };
            byStation.set(station.id, station);
        }

        if (parameter.measure === 'temp') {
            if (!(station.readingTime >= time)) {
                station.tempF = toFahrenheit(value, props.unit_of_measure);
                station.readingTime = time;
                station.timeSeriesId = props.time_series_id;
            }
        } else if (parameter.measure === 'flow') {
            if (!(station.flow?.time >= time)) station.flow = { cfs: value, time };
        } else if (parameter.measure === 'oxygen') {
            if (!(station.oxygen?.time >= time)) station.oxygen = { mgL: value, time };
        } else if (parameter.measure === 'turbidity') {
            if (!(station.turbidity?.time >= time)) station.turbidity = { fnu: value, time };
        } else if (!(station[parameter.measure]?.time >= time)) {
            station[parameter.measure] = {
                type: parameter.measure,
                valueFt: value,
                time,
                timeSeriesId: props.time_series_id,
                parameterCode: props.parameter_code,
                datum: parameter.datum ?? null,
            };
        }
    }

    const all = [...byStation.values()].sort((a, b) => a.distanceMi - b.distanceMi);
    for (const station of all) {
        // Lakes report elevation; rivers report gage height. Prefer elevation when a site has both.
        station.level = station.elevation ?? station.gage ?? null;
        delete station.elevation;
        delete station.gage;
    }

    // Names are only needed for stations that can end up on screen.
    const wanted = new Map();
    for (const station of all.filter((s) => isNum(s.tempF)).slice(0, 40)) wanted.set(station.id, station);
    for (const station of all.filter((s) => s.level).slice(0, 30)) wanted.set(station.id, station);
    if (wanted.size === 0) return [];

    const details = await usgsJson('monitoring-locations', {
        id: [...wanted.keys()].sort().join(','),
        properties: 'id,monitoring_location_name,site_type_code',
        skipGeometry: true,
        limit: 100,
    }, { signal });

    const detailById = new Map(
        (details.features ?? []).map((feature) => [feature.id ?? feature.properties?.id, feature.properties ?? {}]),
    );

    const stations = [];
    for (const station of [...wanted.values()].sort((a, b) => a.distanceMi - b.distanceMi)) {
        const detail = detailById.get(station.id);
        const typeCode = detail?.site_type_code ?? '';
        const siteKind = SITE_KINDS.find((entry) => typeCode.startsWith(entry.prefix));
        if (!detail || !siteKind) continue;
        stations.push({
            ...station,
            name: prettySiteName(detail.monitoring_location_name),
            kind: siteKind.kind,
            kindLabel: SITE_LABEL_OVERRIDES[typeCode] ?? siteKind.label,
        });
    }
    return stations;
}

/**
 * One continuous series for a station over the last `hours`, oldest first.
 * Values are returned as reported, except temperature which is converted to °F.
 */
async function fetchSeries(stationId, parameterCode, timeSeriesId, { signal, hours = APP.HISTORY_HOURS } = {}) {
    const data = await usgsJson('continuous', {
        monitoring_location_id: stationId,
        parameter_code: parameterCode,
        time_series_id: timeSeriesId,
        time: `PT${hours}H`,
        properties: 'time,value,unit_of_measure',
        skipGeometry: true,
        limit: 5000,
    }, { signal });

    const isTemp = PARAMETERS[parameterCode]?.measure === 'temp';
    const cutoff = Date.now() - hours * HOUR_MS;
    const points = (data.features ?? [])
        .map((feature) => {
            const value = Number.parseFloat(feature.properties?.value);
            return {
                t: Date.parse(feature.properties?.time),
                v: isTemp ? toFahrenheit(value, feature.properties?.unit_of_measure) : value,
            };
        })
        .filter((point) => isNum(point.t) && isNum(point.v) && point.t >= cutoff)
        .sort((a, b) => a.t - b.t);

    // Some gauges report every minute; ~300 points is plenty for a 48-hour chart.
    const step = Math.ceil(points.length / 300);
    if (step <= 1) return points;
    return points.filter((_, index) => index % step === 0 || index === points.length - 1);
}

/** Water temperature (°F) history for a station. */
export const fetchWaterHistory = (station, options) => fetchSeries(station.id, '00010', station.timeSeriesId, options);

/** Gage height or lake elevation (ft) history for a station that has a `level`. */
export const fetchLevelHistory = (station, options) => fetchSeries(station.id, station.level.parameterCode, station.level.timeSeriesId, options);

const PERCENTILES = ['5', '10', '25', '50', '75', '90', '95'];
const MIN_YEARS_OF_RECORD = 10;

/**
 * What a gauge's flow normally is on one day of the year, from its whole approved record:
 * { 5, 10, 25, 50, 75, 90, 95 } -> cfs, or null when the station has no usable record.
 *
 * @param {string} stationId  e.g. 'USGS-02334430'
 * @param {string} monthDay   'MM-DD' in the station's local calendar
 */
export async function fetchFlowNormals(stationId, monthDay, { signal } = {}) {
    const data = await usgsRequest('statistics/observationNormals', `${API.USGS_STATS}/observationNormals`, {
        monitoring_location_id: stationId,
        parameter_code: '00060',
        computation_type: 'percentile',
        start_date: monthDay,
        end_date: monthDay,
    }, { signal });

    for (const feature of data.features ?? []) {
        for (const series of feature.properties?.data ?? []) {
            if (series.parameter_code !== '00060') continue;
            for (const entry of series.values ?? []) {
                if (entry.computation !== 'percentile' || !Array.isArray(entry.values) || !Array.isArray(entry.percentiles)) continue;
                if (!(Number(entry.sample_count) >= MIN_YEARS_OF_RECORD)) continue; // too short a record to call anything "normal"
                const byPercentile = Object.fromEntries(entry.percentiles.map((key, i) => [String(key), Number.parseFloat(entry.values[i])]));
                if (PERCENTILES.every((key) => isNum(byPercentile[key]))) {
                    return Object.fromEntries(PERCENTILES.map((key) => [key, byPercentile[key]]));
                }
            }
        }
    }
    return null;
}

const DAILY_MEAN = '00003';

/**
 * Daily mean water temperature (°F) at a station over the last `days`, oldest first:
 * [{ day: 'YYYY-MM-DD', v }]. USGS computes these from the station's own sensor, usually
 * through yesterday. A station with sensors at more than one depth has more than one daily
 * series; the one with the most days is used.
 */
export async function fetchDailyWaterTemps(station, { signal, days = APP.WATER_TREND_DAYS } = {}) {
    const data = await usgsJson('daily', {
        monitoring_location_id: station.id,
        parameter_code: '00010',
        statistic_id: DAILY_MEAN,
        time: `P${days}D`,
        properties: 'time_series_id,time,value,unit_of_measure',
        skipGeometry: true,
        limit: 500,
    }, { signal });

    const bySeries = new Map();
    for (const feature of data.features ?? []) {
        const props = feature.properties ?? {};
        const value = Number.parseFloat(props.value);
        const day = String(props.time ?? '').slice(0, 10);
        if (!plausible('temp', value) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
        const key = props.time_series_id ?? '';
        if (!bySeries.has(key)) bySeries.set(key, new Map());
        bySeries.get(key).set(day, toFahrenheit(value, props.unit_of_measure));
    }
    const longest = [...bySeries.values()].sort((a, b) => b.size - a.size)[0];
    return longest ? [...longest].map(([day, v]) => ({ day, v })).sort((a, b) => (a.day < b.day ? -1 : 1)) : [];
}

const MIN_YEARS_OF_TEMPERATURE = 5; // temperature records are much younger than flow records

/**
 * What a station's daily mean water temperature normally is on one day of the year:
 * { p25, p50, p75 } in °F, or null when the station has too short a record.
 *
 * @param {string} stationId  e.g. 'USGS-01646500'
 * @param {string} monthDay   'MM-DD'
 */
export async function fetchTempNormals(stationId, monthDay, { signal } = {}) {
    const data = await usgsRequest('statistics/observationNormals', `${API.USGS_STATS}/observationNormals`, {
        monitoring_location_id: stationId,
        parameter_code: '00010',
        computation_type: 'percentile',
        start_date: monthDay,
        end_date: monthDay,
    }, { signal });

    let best = null;
    for (const feature of data.features ?? []) {
        for (const series of feature.properties?.data ?? []) {
            if (series.parameter_code !== '00010' || series.parent_statistic_id !== DAILY_MEAN) continue;
            for (const entry of series.values ?? []) {
                if (entry.computation !== 'percentile' || !Array.isArray(entry.values) || !Array.isArray(entry.percentiles)) continue;
                const years = Number(entry.sample_count);
                if (!(years >= MIN_YEARS_OF_TEMPERATURE) || (best && best.years >= years)) continue;
                const at = (percentile) => {
                    const value = Number.parseFloat(entry.values[entry.percentiles.map(String).indexOf(percentile)]);
                    return plausible('temp', value) ? toFahrenheit(value, series.unit_of_measure) : null;
                };
                const normal = { p25: at('25'), p50: at('50'), p75: at('75') };
                if (isNum(normal.p25) && isNum(normal.p50) && isNum(normal.p75)) best = { years, normal };
            }
        }
    }
    return best?.normal ?? null;
}

// Live water temperature, level and flow from the USGS Water Data OGC API.
// Docs: https://api.waterdata.usgs.gov/docs/ogcapi/
//
// Finding stations takes two small requests:
//   1. latest-continuous    — every sensor in a bounding box that has reported
//                             recently, with its latest reading
//   2. monitoring-locations — names and site types for the nearest of those
// A further request per series (continuous) loads the last 48 hours for a chart.

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
 * GET one USGS collection. Goes through the site's caching proxy when it is
 * deployed (see functions/api/usgs); otherwise straight to USGS. The first
 * request finds out which: a static host answers the proxy path with a 404
 * (or with an HTML page), and from then on requests go direct.
 */
async function usgsJson(name, params, { signal } = {}) {
    if (proxyAvailable !== false) {
        try {
            const url = buildUrl(new URL(`${API.USGS_PROXY}/${name}/items`, document.baseURI), params);
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
    const url = buildUrl(`${API.USGS}/${name}/items`, { f: 'json', ...params, api_key: APP.USGS_API_KEY });
    return fetchJson(url, { signal, timeoutMs: TIMEOUT_MS });
}

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
    return value > -500 && value < 20000; // feet
}

/**
 * Nearby stations with recent readings, nearest first. Each station has some of:
 *   tempF + readingTime + timeSeriesId   water temperature
 *   level { type: 'gage'|'elevation', valueFt, time, timeSeriesId, parameterCode, datum }
 *   flow  { cfs, time }
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

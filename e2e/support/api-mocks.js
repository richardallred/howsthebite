// Fixture responses for every external service the app talks to.
//
// The payloads are generated relative to a pinned clock (NOW) and are shaped
// exactly like the real APIs, so the app's own parsing code is exercised.
// The default scenario is a perfect fishing day; tests override pieces of it.

export const NOW = Date.parse('2026-06-15T15:00:00Z'); // 10:00 in Chicago, on a new moon

const HOUR = 3600_000;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------------------
// National Weather Service
// ---------------------------------------------------------------------------

const NWS = 'https://api.weather.gov';
const PA_PER_INHG = 3386.389;
const fToC = (f) => ((f - 32) * 5) / 9;
const icon = (code, when = 'day') => `${NWS}/icons/land/${when}/${code}?size=medium`;

export const DEFAULT_WEATHER = {
    tempF: 72,
    pressureInHg: 30.03,
    pressureChangePer3h: -0.04, // slowly falling: the best case for the score
    windMph: 10,
    gustMph: 14,
    windDirection: 225,
    skyText: 'Clear',
    skyIcon: 'skc',
    timezone: 'America/Chicago',
    place: { city: 'Madison', state: 'WI' }, // what "use my location" resolves to; null = unnamed
    outsideCoverage: false,
    // Nearest first. A station can lack a barometer and a sky sensor, as rural ones do.
    stations: [{ id: 'KTST', name: 'Testville, Test Regional Airport', pressure: true, sky: true }],
};

const weatherOf = (overrides) => ({ ...DEFAULT_WEATHER, ...overrides });

export function pointResponse(overrides) {
    const w = weatherOf(overrides);
    return {
        properties: {
            gridId: 'TST',
            forecast: `${NWS}/gridpoints/TST/10,20/forecast`,
            observationStations: `${NWS}/gridpoints/TST/10,20/stations`,
            timeZone: w.timezone,
            relativeLocation: w.place ? { properties: w.place } : null,
        },
    };
}

export function stationsResponse(overrides) {
    return {
        features: weatherOf(overrides).stations.map((station) => ({
            properties: { stationIdentifier: station.id, name: station.name },
        })),
    };
}

/** Hourly reports for 72 hours, newest first, in the units NWS uses (°C, Pa, km/h). */
export function observationsResponse(url, overrides) {
    const w = weatherOf(overrides);
    const id = url.pathname.split('/')[2];
    const station = w.stations.find((entry) => entry.id === id) ?? w.stations[0];
    const quantity = (value, unitCode) => ({ unitCode, value, qualityControl: value === null ? 'Z' : 'V' });
    const features = [];
    for (let t = NOW; t >= NOW - 72 * HOUR; t -= HOUR) {
        const hoursFromNow = (t - NOW) / HOUR;
        // 24-hour cycle, so "same time yesterday" equals now and the air trend is steady.
        const tempF = w.tempF + 8 * Math.sin((2 * Math.PI * hoursFromNow) / 24);
        const pressure = w.pressureInHg + (w.pressureChangePer3h / 3) * hoursFromNow;
        features.push({
            properties: {
                timestamp: new Date(t).toISOString(),
                textDescription: station.sky ? w.skyText : '',
                icon: station.sky ? icon(w.skyIcon) : null,
                temperature: quantity(Number(fToC(tempF).toFixed(2)), 'wmoUnit:degC'),
                barometricPressure: quantity(station.pressure ? Number((pressure * PA_PER_INHG).toFixed(1)) : null, 'wmoUnit:Pa'),
                seaLevelPressure: quantity(null, 'wmoUnit:Pa'),
                windSpeed: quantity(Number((w.windMph / 0.621371).toFixed(3)), 'wmoUnit:km_h-1'),
                windGust: quantity(w.gustMph ? Number((w.gustMph / 0.621371).toFixed(3)) : null, 'wmoUnit:km_h-1'),
                windDirection: quantity(w.windDirection, 'wmoUnit:degree_(angle)'),
                windChill: quantity(null, 'wmoUnit:degC'),
                heatIndex: quantity(null, 'wmoUnit:degC'),
                relativeHumidity: quantity(50, 'wmoUnit:percent'),
            },
        });
    }
    return { features };
}

/** Seven days as NWS sends them: alternating day and night periods, starting this morning. */
export function forecastResponse(overrides) {
    const w = weatherOf(overrides);
    const sixAm = Date.parse('2026-06-15T11:00:00Z'); // 06:00 in Chicago (CDT)
    const days = [
        [w.skyText === 'Clear' ? 'Sunny' : w.skyText, w.skyIcon], ['Partly Sunny', 'sct'],
        ['Mostly Cloudy then Slight Chance Light Rain', 'bkn/rain,20'], ['Cloudy', 'ovc'], ['Sunny', 'skc'],
        ['Showers And Thunderstorms', 'tsra,80'], ['Mostly Sunny', 'few'],
    ];
    const periods = [];
    days.forEach(([text, code], i) => {
        const start = sixAm + i * DAY;
        periods.push({
            name: i === 0 ? 'Today' : `Day ${i}`,
            startTime: new Date(start).toISOString(),
            endTime: new Date(start + 12 * HOUR).toISOString(),
            isDaytime: true,
            temperature: 81 + i,
            temperatureUnit: 'F',
            probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: 30 + i * 10 },
            windSpeed: `${6 + i} to ${11 + i} mph`,
            windDirection: 'SW',
            icon: icon(code),
            shortForecast: text,
        }, {
            name: i === 0 ? 'Tonight' : `Night ${i}`,
            startTime: new Date(start + 12 * HOUR).toISOString(),
            endTime: new Date(start + 24 * HOUR).toISOString(),
            isDaytime: false,
            temperature: 61 + i,
            temperatureUnit: 'F',
            probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: null },
            windSpeed: '5 mph',
            windDirection: 'S',
            icon: icon('few', 'night'),
            shortForecast: 'Mostly Clear',
        });
    });
    return { properties: { periods } };
}

// ---------------------------------------------------------------------------
// USGS Water Data
// ---------------------------------------------------------------------------

// Stations are placed relative to the centre of whatever bounding box is requested.
// 1 degree of latitude is about 69 miles.
export const DEFAULT_STATIONS = [
    {
        id: 'USGS-05500005', name: 'DES PLAINES RIVER AT GAUGEVILLE, IL', type: 'ST', milesNorth: 1,
        readings: { '00065': 5.1, '00060': 880 }, // level and flow only: never a temperature source
    },
    {
        id: 'USGS-05500001', name: 'FOX RIVER NR TESTVILLE, IL', type: 'ST', milesNorth: 2,
        readings: { '00010': 20.0, '00065': 3.42, '00060': 1250 },
    },
    {
        id: 'USGS-05500002', name: 'CLEAR LAKE AT TEST DAM, IL', type: 'LK', milesNorth: -8,
        readings: { '00010': 22.0, 62615: 759.32 },
    },
    {
        id: 'USGS-05500003', name: 'ROCK CREEK AT SAMPLE RD NEAR EXAMPLE, IL', type: 'ST', milesNorth: 12,
        readings: { '00010': 18.5 },
    },
    {
        id: 'USGS-414141088000001', name: 'OBSERVATION WELL 12', type: 'GW', milesNorth: 0.5,
        readings: { '00010': 11.0 }, // groundwater: must never be offered to an angler
    },
];

const seriesId = (stationId, parameter) => `ts-${stationId}-${parameter}`;

// Every place a test can be "at". The app snaps its USGS search box to a grid, so the
// box centre is only near the real spot; stations are placed around the nearest known place.
export const KNOWN_PLACES = [[41.8781, -87.6298]];

function locate(url) {
    const [west, south, east, north] = url.searchParams.get('bbox').split(',').map(Number);
    const centre = [(south + north) / 2, (west + east) / 2];
    const distance = ([lat, lon]) => Math.hypot(lat - centre[0], lon - centre[1]);
    return KNOWN_PLACES.reduce((best, place) => (distance(place) < distance(best) ? place : best));
}

export function latestContinuousResponse(url, stations) {
    const [lat, lon] = locate(url);
    const features = [];
    for (const station of stations) {
        for (const [parameter, value] of Object.entries(station.readings)) {
            features.push({
                type: 'Feature',
                id: `${station.id}-${parameter}`,
                geometry: { type: 'Point', coordinates: [lon, lat + station.milesNorth / 69] },
                properties: {
                    monitoring_location_id: station.id,
                    time_series_id: seriesId(station.id, parameter),
                    parameter_code: parameter,
                    time: new Date(NOW - 15 * 60_000).toISOString(),
                    value: String(value),
                    unit_of_measure: parameter === '00010' ? 'degC' : parameter === '00060' ? 'ft^3/s' : 'ft',
                },
            });
        }
    }
    return { type: 'FeatureCollection', features, numberReturned: features.length, links: [] };
}

export function monitoringLocationsResponse(url, stations) {
    const ids = (url.searchParams.get('id') ?? '').split(',');
    const features = stations.filter((station) => ids.includes(station.id)).map((station) => ({
        type: 'Feature',
        id: station.id,
        geometry: null,
        properties: { id: station.id, monitoring_location_name: station.name, site_type_code: station.type },
    }));
    return { type: 'FeatureCollection', features, numberReturned: features.length, links: [] };
}

/** 48 hours at 30-minute steps. River level rises 0.30 ft over the window; everything else is flat. */
export function continuousResponse(url, stations) {
    const station = stations.find((s) => s.id === url.searchParams.get('monitoring_location_id'));
    const parameter = url.searchParams.get('parameter_code');
    const latest = station?.readings[parameter];
    const features = [];
    if (latest !== undefined) {
        for (let t = NOW - 48 * HOUR; t <= NOW - 15 * 60_000; t += HOUR / 2) {
            const hoursAgo = (NOW - t) / HOUR;
            const value = parameter === '00065' ? latest - (0.3 * hoursAgo) / 48 : latest;
            features.push({
                type: 'Feature',
                id: `${station.id}-${parameter}-${t}`,
                geometry: null,
                properties: {
                    time: new Date(t).toISOString(),
                    value: value.toFixed(2),
                    unit_of_measure: parameter === '00010' ? 'degC' : 'ft',
                },
            });
        }
    }
    return { type: 'FeatureCollection', features, numberReturned: features.length, links: [] };
}

// ---------------------------------------------------------------------------
// Place search (Photon)
// ---------------------------------------------------------------------------

const PLACES = [
    { name: 'Asheville', state: 'North Carolina', county: 'Buncombe', countrycode: 'US', osm_key: 'place', osm_value: 'city', lat: 35.60095, lon: -82.55402 },
    { name: 'Ashville', state: 'Ohio', county: 'Pickaway', countrycode: 'US', osm_key: 'place', osm_value: 'village', lat: 39.71562, lon: -82.95296 },
    { name: 'Asheville Mall', state: 'North Carolina', county: 'Buncombe', countrycode: 'US', osm_key: 'shop', osm_value: 'mall', lat: 35.58, lon: -82.52 },
    { name: 'Madison', state: 'Wisconsin', county: 'Dane', countrycode: 'US', osm_key: 'place', osm_value: 'city', lat: 43.07305, lon: -89.40123 },
    { name: 'Madison', state: 'Alabama', county: 'Madison', countrycode: 'US', osm_key: 'place', osm_value: 'town', lat: 34.69926, lon: -86.74833 },
    { name: 'Lake Norman', state: 'North Carolina', county: 'Iredell', countrycode: 'US', osm_key: 'water', osm_value: 'reservoir', lat: 35.592, lon: -80.933 },
    { name: 'Lake Norman of Catawba', state: 'North Carolina', county: 'Catawba', countrycode: 'US', osm_key: 'place', osm_value: 'village', lat: 35.58708, lon: -80.95952 },
    { name: 'Norman Lake', state: 'Ontario', county: 'Renfrew', countrycode: 'CA', osm_key: 'natural', osm_value: 'water', lat: 46.115, lon: -77.809 },
    { name: 'Lake Thunderbird', state: 'Oklahoma', county: 'Cleveland', countrycode: 'US', osm_key: 'water', osm_value: 'reservoir', lat: 35.246, lon: -97.233 },
    { name: 'Lake Norman Wastewater Basin', state: 'North Carolina', county: 'Iredell', countrycode: 'US', osm_key: 'water', osm_value: 'wastewater', lat: 35.6, lon: -80.9 },
    { name: 'French Broad River', state: 'North Carolina', county: 'Madison', countrycode: 'US', osm_key: 'waterway', osm_value: 'river', lat: 35.879, lon: -82.808 },
];
for (const place of PLACES) KNOWN_PLACES.push([place.lat, place.lon]);

/** Photon matches loosely, so the fixture does too: anything sharing a word (or a 4-letter prefix) with the query. */
export function photonResponse(url) {
    const words = (url.searchParams.get('q') ?? '').toLowerCase().split(/\s+/).filter((word) => word.length > 2);
    const features = PLACES
        .filter((place) => {
            const name = place.name.toLowerCase();
            return words.some((word) => name.includes(word) || name.startsWith(word.slice(0, 4)));
        })
        .map(({ lon, lat, ...properties }) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lon, lat] },
            properties: { type: 'other', ...properties },
        }));
    return { type: 'FeatureCollection', features };
}

// 1×1 transparent PNG for map tiles.
export const BLANK_TILE = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
);

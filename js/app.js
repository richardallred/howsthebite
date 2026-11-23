// How's the Bite? — application entry point.
//
// State lives in one object; `render()` redraws the page from it. Network
// results are applied only if they belong to the most recent request, so
// switching locations quickly can never show data for the wrong place.
// Every place has its own address (/fishing/<lat>,<lon>/<name>, see core/place-url.js),
// kept in the address bar and in the browser's history.

import {
    fetchBeachForecast, fetchCoastWaterTemp, fetchCoastWaterTempHistory, fetchSeaSurfaceTemp, fetchTides, fetchWaveForecast,
    loadStationList, nearestCoastStations, waveHeightAt,
} from './api/coast-api.js';
import { fetchSpeciesCounts, speciesRegionKey } from './api/species-api.js';
import {
    fetchDailyWaterTemps, fetchFlowNormals, fetchLevelHistory, fetchTempNormals, fetchWaterHistory, findStations,
} from './api/usgs-api.js';
import { HttpError, isAbort } from './api/http.js';
import { OutsideCoverageError, fetchAlerts, fetchWeather, reverseGeocode, searchPlaces } from './api/weather-api.js';
import { APP, US_STATES } from './config.js';
import { hazardAt, summariseAlerts } from './core/alerts.js';
import { colourAdvice, lureConditions, lurePatterns, recommendLures } from './core/lures.js';
import { LISTED_WATER, OWN_SENSOR } from './core/listed-places.js';
import { lakesNear, nearbyWater, riversFromStations, saltWaterNear } from './core/nearby-water.js';
import { majorPeriods, moonInfo } from './core/moon.js';
import { coordinateName, placeHref, placeMeta, placePath, readPlaceUrl, sectionHeadings, slugify } from './core/place-url.js';
import { SPECIES_GROUPS, bandFor, bitePhrase, estimateWaterTemp, scoreConditions } from './core/scoring.js';
import { bestStretch, dayParts, stretchOf } from './core/day-score.js';
import { DEFAULT_LABELS, chooseSpecies, regionalSpecies, saltSpeciesOptions, speciesOptions } from './core/species.js';
import { sunTimes } from './core/sun.js';
import { upcomingTides } from './core/tides.js';
import { changeOver, classifyTrend, frontState, lastHours } from './core/trend.js';
import { conditionsSummary } from './core/summary.js';
import { dailyMeans, describeWaterTrend, summariseWaterTrend } from './core/water-trend.js';
import { HOUR_MS, debounce, distanceMiles, isNum, roundCoord, timeAgo } from './core/util.js';
import { compassPoint } from './core/sky.js';
import { locateZones, targetPlan } from './core/target-zones.js';
import { fetchLake, loadLakeList } from './api/lake-api.js';
import { locationKey, storage } from './storage.js';
import { createLineChart } from './ui/charts.js';
import { $, el, glyph, icon, setText, svg } from './ui/dom.js';
import { createLakeMap, createStationMap } from './ui/map.js';
import { initTheme } from './ui/theme.js';
import { initTips, tip } from './ui/tips.js';

const state = {
    location: null,
    weather: null,
    stations: [],
    stationsError: null,
    selectedStationId: null,
    waterHistory: [],
    levelHistory: [],
    waterFilter: storage.getWaterFilter(),
    speciesGroup: storage.getSpeciesGroup(), // the saved preference; what is scored also depends on the region
    speciesCounts: null, // { key, counts }: fish recorded in the region of the current location
    mode: storage.getMode(), // the saved kind of fishing: 'fresh', 'inshore' or 'surf'; used where that kind is possible
    saltGroup: storage.getSaltGroup(), // the saved salt-water fish
    coast: null, // tides, coastal water temperature and surf for the current location; null inland or not yet known
    alerts: [],
    nearbyLakes: [], // the best-known lakes around a town, offered for a more specific score
    nearbySalt: [], // and its bays and sounds; its rivers come from the gauges
    flowNormals: null, // { stationId, monthDay, percentiles } for the river gauge in use
    waterTrend: null, // { key, source, daily, normal, at, failed }: the last few weeks of water temperature behind the lure picks
    loading: false,
    loadFailed: false,
    scoreDay: 0, // the score card's day: 0 is today, then each day ahead in the outlook
    scoreFocus: null, // part of that day on the card: { kind: 'part', id } or { kind: 'hour', t }; null for the whole day
    lake: null, // { key, status: 'loading'|'ready'|'none'|'too-big'|'failed', lake }: the outline behind "Where to look"
};

let loadController = null;
let historyController = null;
let trendController = null;
let charts = null;
let stationMap = null;
let lakeMap = null;

// ---------------------------------------------------------------------------
// Derived data
// ---------------------------------------------------------------------------

const matchesFilter = (station) => state.waterFilter === 'all' || station.kind === state.waterFilter;

/** Stations that report water temperature (the selectable list), nearest first. */
const visibleStations = () => state.stations
    .filter((station) => isNum(station.tempF) && matchesFilter(station))
    .slice(0, APP.STATION_LIST_MAX);

const selectedStation = () => visibleStations().find((station) => station.id === state.selectedStationId) ?? null;

// When the chosen place is itself a lake or a river, a station on the same kind
// of water is preferred over a slightly nearer one on the other kind.
const KIND_MISMATCH_PENALTY_MI = 15;

function nearest(stations, origin, wantedKind) {
    let best = null;
    let bestCost = Infinity;
    for (const station of stations) {
        const cost = distanceMiles(origin.lat, origin.lon, station.lat, station.lon)
            + (wantedKind && station.kind !== wantedKind ? KIND_MISMATCH_PENALTY_MI : 0);
        if (cost < bestCost) [best, bestCost] = [station, cost];
    }
    return best;
}

/** The user's saved choice for this location if it is still reporting, otherwise the best nearby station. */
function pickStation(location) {
    const candidates = visibleStations();
    const preferred = storage.getPreferredStation(location);
    return candidates.find((station) => station.id === preferred) ?? nearest(candidates, location, location.kind);
}

/**
 * Where water level and flow come from. For a place that is itself a lake or a
 * river, a gauge on that kind of water close to the place wins (a lake's own
 * elevation gauge often has no thermometer, so it is never the selected
 * station). Otherwise the selected temperature station when it has a gauge,
 * or the gauge closest to it.
 */
const SAME_WATER_MAX_MI = 25;

function levelStation() {
    const selected = selectedStation();
    const location = state.location;
    if (!location) return null;
    const gauges = state.stations.filter((station) => station.level && matchesFilter(station));

    if (location.kind && selected?.kind !== location.kind) {
        const onSameKind = nearest(gauges.filter((station) => station.kind === location.kind), location);
        if (onSameKind && onSameKind.distanceMi <= SAME_WATER_MAX_MI) return onSameKind;
    }
    if (selected?.level) return selected;
    return nearest(gauges, selected ?? location, selected?.kind ?? location.kind);
}

/** Observed series up to "now" (the hourly feed also contains forecast hours). */
function observed(series, now, currentValue) {
    const points = lastHours(series, APP.HISTORY_HOURS, now);
    if (isNum(currentValue) && (!points.length || points[points.length - 1].t < now)) points.push({ t: now, v: currentValue });
    return points;
}

/** Records of each sport fish around the current location: just loaded, remembered from an earlier visit, or null. */
function speciesCounts() {
    if (!state.location) return null;
    const key = speciesRegionKey(state.location.lat, state.location.lon);
    if (state.speciesCounts?.key !== key) state.speciesCounts = { key, counts: storage.getSpeciesCounts(key) };
    return state.speciesCounts.counts;
}

const MODE_LABELS = { fresh: 'Freshwater', inshore: 'Inshore', surf: 'Surf' };

/**
 * The kinds of fishing possible here, and the one in use. Salt water is offered where
 * there is a tide (which includes tidal rivers: the angler knows which they are fishing),
 * surf only where the Weather Service forecasts for a beach.
 */
function modeChoice() {
    const modes = ['fresh'];
    if (state.coast?.tidal) {
        modes.push('inshore');
        if (state.coast.surf) modes.push('surf');
    }
    return { modes, mode: modes.includes(state.mode) ? state.mode : 'fresh' };
}

/** The species choices on offer here, and the one in use (the saved preference when it lives here). */
function speciesChoice() {
    const { mode } = modeChoice();
    if (mode !== 'fresh') {
        const options = saltSpeciesOptions(speciesCounts(), mode, state.location.lat, state.location.lon);
        return { options, chosen: chooseSpecies(options, state.saltGroup) };
    }
    const options = speciesOptions(regionalSpecies(speciesCounts(), state.location?.lat ?? 40));
    return { options, chosen: chooseSpecies(options, state.speciesGroup) };
}

/** Flow counts toward the score only on moving water whose gauge has a long enough record. */
const flowApplies = (gauge) => Boolean(gauge?.flow) && gauge.kind === 'river' && state.location?.kind !== 'lake';

function flowInput(gauge) {
    if (!flowApplies(gauge)) return null;
    const normals = state.flowNormals;
    if (normals?.stationId !== gauge.id || !normals.percentiles) return null;
    return { cfs: gauge.flow.cfs, percentiles: normals.percentiles };
}

/** Forecast sky, wind and (off a beach) wave height for a time ahead; null for the next hour, where the observation is better. */
function forecastAt(time, from) {
    if (time - from < 60 * 60 * 1000) return null;
    const ahead = {};
    const period = (state.weather?.outlook ?? []).find((p) => p.start <= time && time < p.end);
    if (period) {
        ahead.sky = period.sky;
        if (isNum(period.windMph)) ahead.windMph = period.windMph;
    }
    const waveFt = waveHeightAt(state.coast?.waves?.periods, time);
    if (isNum(waveFt)) ahead.waveFt = waveFt;
    return Object.keys(ahead).length ? ahead : null;
}

/** Wave height at the beach now, and where the number comes from. Null when nothing is known. */
function surfNow(clock) {
    const coast = state.coast;
    if (isNum(coast?.beach?.surfFt)) return { heightFt: coast.beach.surfFt, source: 'NWS surf forecast' };
    const offshore = waveHeightAt(coast?.waves?.periods, clock);
    return isNum(offshore) ? { heightFt: offshore, source: 'NWS wave forecast just offshore' } : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const OUTLOOK_DAYS_AHEAD = 2; // the rest of today plus this many full days

function inTimezone(options) {
    try {
        return new Intl.DateTimeFormat('en-US', { ...options, timeZone: state.weather?.timezone });
    } catch {
        return new Intl.DateTimeFormat('en-US', options);
    }
}

/** The next local midnight after `time`, at the location being looked at. */
function nextLocalMidnight(time) {
    const parts = inTimezone({ hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' }).formatToParts(time);
    const part = (type) => Number(parts.find((entry) => entry.type === type)?.value ?? 0);
    const sinceMidnight = ((part('hour') * 60 + part('minute')) * 60 + part('second')) * 1000 + (time % 1000);
    return time - sinceMidnight + DAY_MS;
}

/**
 * Each hour of today and the days ahead, scored at its middle with the forecast for then (the
 * hour under way is the score now, as observed; hours gone by are marked past). `at(time)` gives
 * what differs then (forecast sky and wind, a warning in effect). Grouped by
 * local day: Map of day key → [{ t, past } | { t, at, live, ahead, result, score, band }].
 */
function hourlyScores(inputs, clock, live, end, dayKey, at) {
    const hourStart = clock - (clock % HOUR_MS);
    let first = hourStart;
    while (dayKey.format(first - HOUR_MS) === dayKey.format(hourStart)) first -= HOUR_MS;
    const byDay = new Map();
    for (let t = first; t < end; t += HOUR_MS) {
        const key = dayKey.format(t);
        if (!byDay.has(key)) byDay.set(key, []);
        let hour;
        if (t + HOUR_MS <= clock) hour = { t, past: true };
        else if (t <= clock) hour = { t, at: clock, live: true, ahead: null, result: live };
        else {
            const middle = t + HOUR_MS / 2;
            const ahead = at(middle);
            const result = scoreConditions({
                ...inputs, pressureChange3h: null, front: null, gustMph: null, hazard: null, ...(ahead ?? {}), date: new Date(middle),
            });
            hour = { t, at: middle, live: false, ahead, result };
        }
        if (hour.result) Object.assign(hour, { score: hour.result.score, band: hour.result.band });
        byDay.get(key).push(hour);
    }
    return byDay;
}

/** A score for a stretch of hours, told as its best hour's conditions with the stretch's own number. */
function stretchResult(stretch) {
    const { result, at } = stretch.top;
    return { ...result, score: stretch.score, band: bandFor(stretch.score), phrase: bitePhrase(stretch.score, new Date(at)) };
}

/**
 * Today and the next two days for the score card, hour by hour: each day with its hours, its score
 * (the best two hours still to come), and its parts (dawn, morning, afternoon, dusk, night).
 */
function deriveOutlook(inputs, clock, live, at) {
    const end = nextLocalMidnight(clock) + OUTLOOK_DAYS_AHEAD * DAY_MS;
    const { lat, lon } = state.location;
    const dayKey = inTimezone({ year: 'numeric', month: '2-digit', day: '2-digit' });
    const dayName = inTimezone({ weekday: 'short' });
    const days = [...hourlyScores(inputs, clock, live, end, dayKey, at).values()].map((hours, index) => {
        const start = hours[0].t;
        const { sunrise, sunset } = sunTimes(start + DAY_MS / 2, lat, lon);
        const stretch = bestStretch(hours);
        const scored = hours.filter((hour) => !hour.past).map((hour) => hour.score);
        return {
            label: index === 0 ? 'Today' : dayName.format(start),
            hours,
            best: stretch,
            result: stretch ? stretchResult(stretch) : live,
            parts: dayParts({ start, end: hours[hours.length - 1].t + HOUR_MS, sunrise, sunset })
                .map((part) => ({ ...part, stretch: stretchOf(hours, part.start, part.end) })),
            flat: Math.max(...scored) - Math.min(...scored) < 5, // held down all day: no hour is better than another
        };
    });
    return { days };
}

// A change in level that matters to where fish sit: a lake up or down by 0.15 ft or more in a day
// (new cover flooded, or the bank left dry), or a river rising or falling fast.
const LAKE_LEVEL_SHIFT_FT = 0.15;
const LURE_PICKS = 4; // index.html has this many placeholders

function levelShift(level) {
    const trend = level?.trend;
    if (!trend || !['rising', 'falling'].includes(trend.direction)) return null;
    const big = level.station.kind === 'lake' ? Math.abs(trend.delta) >= LAKE_LEVEL_SHIFT_FT : trend.rapid;
    return big ? trend.direction : null;
}

function derive() {
    const { weather } = state;
    if (!weather) return null;
    const { current, hourly } = weather;
    const now = current.time;
    const clock = Date.now(); // light and moon follow the clock, not the age of the weather report

    const pressure = observed(hourly.pressure, now, current.pressureInHg);
    const air = observed(hourly.temp, now, current.tempF);
    const { mode } = modeChoice();
    const salt = mode !== 'fresh';
    const station = salt ? null : selectedStation();
    const estimate = () => estimateWaterTemp(lastHours(hourly.temp, 72, now).map((point) => point.v), current.tempF);
    // Salt water: a tide station's thermometer, the beach forecast or a satellite reading. Fresh: a USGS sensor.
    const seaTemp = salt ? state.coast?.waterTemp ?? null : null;
    const waterTempF = seaTemp?.tempF ?? station?.tempF ?? estimate();
    const waterMeasured = Boolean(seaTemp ?? station);

    const gauge = salt ? null : levelStation();
    const alerts = summariseAlerts(state.alerts, clock);
    const surf = mode === 'surf' ? surfNow(clock) : null;
    if (mode === 'surf' && state.coast?.beach?.rip === 'high') {
        alerts.items.push({ event: 'High rip current risk at the beach today', level: 'caution', active: true, onset: null, ends: null });
    }
    const species = speciesChoice().chosen;
    const waterTrend = waterMeasured ? currentWaterTrend(clock) : null;
    const inputs = {
        mode,
        lat: state.location.lat,
        lon: state.location.lon,
        speciesGroup: species.id,
        speciesLabel: species.label,
        waterTempF,
        waterEstimated: !waterMeasured,
        waterChange24h: station ? changeOver(state.waterHistory, APP.TEMP_TREND_HOURS) : null,
        oxygenMgL: (station?.oxygen ?? gauge?.oxygen)?.mgL ?? null,
        pressureInHg: current.pressureInHg,
        pressureChange3h: changeOver(pressure, APP.PRESSURE_TREND_HOURS),
        front: frontState(pressure, air),
        windMph: current.windMph,
        gustMph: current.gustMph,
        sky: current.sky.class,
        flow: flowInput(gauge),
        tides: salt ? state.coast?.tides ?? null : null,
        waveFt: surf?.heightFt ?? null,
        hazard: alerts.hazard,
        targets: species.targets,
        waterTrend,
    };
    const result = scoreConditions({ ...inputs, date: new Date(clock) });
    // Ahead of now: the forecast sky and wind, and any warning in effect at the time.
    const at = (time) => {
        const ahead = forecastAt(time, clock);
        const hazard = hazardAt(alerts.items, time, clock);
        return hazard ? { ...ahead, hazard } : ahead;
    };
    const outlook = deriveOutlook(inputs, clock, result, at);

    const factor = (id) => result.factors.find((entry) => entry.id === id);
    const tide = factor('tide')?.state ?? null;

    const level = gauge && {
        station: gauge,
        trend: classifyTrend(
            changeOver(state.levelHistory, APP.TEMP_TREND_HOURS),
            gauge.kind === 'lake' ? { steadyBelow: 0.03, rapidAbove: 0.25 } : { steadyBelow: 0.05, rapidAbove: 0.5 },
        ),
    };

    const lureInput = lureConditions({
        mode,
        waterTempF,
        phase: factor('light').phase,
        sky: current.sky.class,
        windMph: current.windMph,
        turbidityFnu: (gauge?.turbidity ?? station?.turbidity)?.fnu ?? null,
        flowPercentile: factor('flow')?.percentile ?? null,
        tide: tide && (tide.slack ? 'slack' : tide.direction),
        waveFt: surf?.heightFt ?? null,
        date: new Date(clock),
        trend: waterTrend,
        front: inputs.front,
        level: levelShift(level),
    });
    const patterns = lurePatterns(species.targets, lureInput);
    const lures = {
        species,
        picks: recommendLures(species.targets, lureInput, { limit: LURE_PICKS }),
        colour: colourAdvice(lureInput, patterns[0]?.season?.forage ?? null),
        patterns,
        trend: waterTrend,
        trendLoading: waterMeasured && !waterTrend && Boolean(trendSource()) && state.waterTrend?.key !== trendSource()?.key,
    };

    return { result, outlook, lures, alerts, clock, pressure, air, station, waterTempF, level, mode, salt, seaTemp, surf, tide };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const RATING_LABELS = { excellent: 'Excellent', good: 'Good', fair: 'Fair', poor: 'Poor' };

const LIGHT_LABELS = { dawn: 'Early light', dusk: 'Evening light', night: 'After dark' };

function clockTime(time, { withDay = false } = {}) {
    const options = { hour: 'numeric', minute: '2-digit', ...(withDay ? { weekday: 'short' } : {}) };
    try {
        return new Intl.DateTimeFormat('en-US', { ...options, timeZone: state.weather?.timezone }).format(time);
    } catch {
        return new Intl.DateTimeFormat('en-US', options).format(time);
    }
}

/** "Sunset 8:28 PM" or "Sunrise 5:16 AM", whichever comes next. */
function nextSunEvent(clock) {
    const { lat, lon } = state.location;
    const today = sunTimes(clock, lat, lon);
    if (today.sunrise && clock < today.sunrise) return `Sunrise ${clockTime(today.sunrise)}`;
    if (today.sunset && clock < today.sunset) return `Sunset ${clockTime(today.sunset)}`;
    const tomorrow = sunTimes(clock + 24 * 60 * 60 * 1000, lat, lon);
    return tomorrow.sunrise ? `Sunrise ${clockTime(tomorrow.sunrise)}` : null;
}

/** "Overhead 1:32 PM" for the next major period, or "Overhead now, until 2:32 PM" during one. */
function nextMajorPeriod(clock) {
    const [period] = majorPeriods(clock, clock + 13 * 60 * 60 * 1000, state.location.lon); // they come every 12.4 hours
    if (!period) return null;
    const name = period.position === 'overhead' ? 'Overhead' : 'Underfoot';
    return period.start <= clock ? `${name} now, until ${clockTime(period.end)}` : `${name} ${clockTime(period.t)}`;
}

const SKY_LABELS = { clear: 'Clear', partly: 'Partly cloudy', overcast: 'Cloudy', 'light-precip': 'Light rain', precip: 'Rain', storm: 'Thunderstorms' };
const ASSUMED = 'Assumed to hold until then';

/**
 * A factor's reading, for the moment the score card is showing: now (the observations), or a
 * time ahead (the forecast, and what is assumed to hold: water temperature, flow, pressure).
 */
function factorDisplay(factor, derived, view = { now: true, time: derived.clock, ahead: null }) {
    const { current } = state.weather;
    const ahead = view.ahead ?? {};
    // Today, readings assumed to hold (water, flow, pressure) are still the ones taken now.
    const today = !view.index;
    const liveFactor = (id) => derived.result.factors.find((entry) => entry.id === id);
    switch (factor.id) {
        case 'water':
            return {
                label: 'Water temperature',
                iconName: 'droplet',
                value: `${derived.station || derived.seaTemp ? '' : '≈ '}${derived.waterTempF.toFixed(1)}°F`,
                extra: !today ? ASSUMED : derived.salt ? derived.seaTemp?.source ?? null : factor.trend,
            };
        case 'tide': {
            const { state: tide } = factor;
            const word = tide.slack ? 'Slack' : tide.direction === 'rising' ? 'Rising' : 'Falling';
            return {
                label: 'Tide',
                iconName: 'waves',
                value: `${word} · ${tide.heightFt.toFixed(1)} ft`,
                extra: `${tide.next.type === 'H' ? 'High' : 'Low'} ${clockTime(tide.next.t)} (${tide.next.heightFt.toFixed(1)} ft)`,
            };
        }
        case 'waves': {
            const rip = state.coast?.beach?.rip;
            const heightFt = view.now ? derived.surf.heightFt : ahead.waveFt ?? derived.surf.heightFt;
            return {
                label: 'Surf',
                iconName: 'waves',
                value: `${heightFt < 1 ? 'Under 1' : Math.round(heightFt)} ft`,
                extra: !view.now ? (isNum(ahead.waveFt) ? 'Wave forecast' : ASSUMED) : rip ? `Rip current risk: ${rip}` : derived.surf.source,
            };
        }
        case 'light':
            return {
                label: 'Light',
                iconName: 'sun',
                value: LIGHT_LABELS[factor.phase] ?? (view.now ? current.sky.label : SKY_LABELS[ahead.sky] ?? 'Daylight'),
                extra: view.now ? nextSunEvent(derived.clock) : `Forecast for ${clockTime(view.time, { withDay: true })}`,
            };
        case 'wind':
            if (!view.now) {
                return {
                    label: 'Wind',
                    iconName: 'wind',
                    value: `${Math.round(isNum(ahead.windMph) ? ahead.windMph : current.windMph)} mph`,
                    extra: isNum(ahead.windMph) ? 'Forecast' : ASSUMED,
                };
            }
            return {
                label: 'Wind',
                iconName: 'wind',
                value: `${Math.round(current.windMph)} mph${isNum(current.windDirection) && current.windMph >= 1 ? ` ${compassPoint(current.windDirection)}` : ''}`,
                extra: isNum(current.gustMph) ? `Gusts to ${Math.round(current.gustMph)} mph` : 'No gusts reported',
            };
        case 'flow':
            return {
                label: 'River flow',
                iconName: 'waves',
                value: formatFlow(derived.level.station.flow.cfs),
                extra: today ? liveFactor('flow')?.trend ?? factor.trend : ASSUMED,
            };
        case 'season': {
            const { fish, phase } = factor;
            return {
                label: 'Season',
                iconName: 'calendar',
                value: phase.label,
                // With several fish, where each one is; with one, which way the water is heading.
                extra: fish.length > 1
                    ? fish.map((entry) => `${capitalise(entry.target)} ${entry.label.toLowerCase()}`).join(' · ')
                    : phase.half === 'warming' ? 'Water warming toward summer' : 'Water cooling toward winter',
            };
        }
        case 'pressure':
            return {
                label: 'Barometric pressure',
                iconName: 'gauge',
                value: isNum(current.pressureInHg) ? `${current.pressureInHg.toFixed(2)} inHg` : '—',
                extra: today ? liveFactor('pressure')?.trend ?? factor.trend : 'Trend not known that far ahead',
            };
        default: {
            const moon = moonInfo(new Date(view.time));
            const extra = [nextMajorPeriod(view.time), factor.trend].filter(Boolean).join(' · ');
            return { label: 'Moon', iconName: 'moon', value: moon.name, valueIcon: moonGlyph(moon.fraction), extra };
        }
    }
}

/**
 * The moon as it looks tonight: the lit part drawn over the dark disc. `fraction` runs
 * 0 (new) → 0.5 (full) → 1; the lit limb is on the right while waxing, on the left while waning.
 */
function moonGlyph(fraction) {
    const r = 7;
    const waxing = fraction < 0.5;
    const terminator = Math.abs(Math.cos(2 * Math.PI * fraction)) * r; // half-width of the shadow's edge
    const gibbous = fraction > 0.25 && fraction < 0.75;
    // Down the lit limb, then back up along the terminator.
    const limbSweep = waxing ? 1 : 0;
    const edgeSweep = waxing === gibbous ? 1 : 0;
    const lit = `M8 1A${r} ${r} 0 0 ${limbSweep} 8 15A${terminator.toFixed(2)} ${r} 0 0 ${edgeSweep} 8 1Z`;
    return svg('svg', { class: 'moon-glyph', viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' },
        svg('circle', { class: 'moon-dark', cx: 8, cy: 8, r }),
        svg('path', { class: 'moon-lit', d: lit }));
}

/** The sprite icon for a sky; older saved snapshots carry no icon name, so fall back on the sky class. */
const SKY_ICONS = new Set(['sun', 'moon', 'partly', 'cloud', 'fog', 'rain', 'snow', 'storm', 'thermometer']);
const SKY_CLASS_ICONS = { clear: 'sun', partly: 'partly', overcast: 'cloud', 'light-precip': 'rain', precip: 'rain', storm: 'storm' };
const skyIcon = (sky) => (SKY_ICONS.has(sky?.icon) ? sky.icon : SKY_CLASS_ICONS[sky?.class] ?? 'thermometer');

/**
 * What the score card shows for the chosen day: the whole day (its best two hours), one part of
 * it (dawn, dusk…), or a single hour picked on the strip. `now` is whether the conditions
 * behind it are the ones observed now, rather than a forecast.
 */
function scoreView(derived) {
    const days = derived.outlook.days;
    const index = Math.max(0, Math.min(state.scoreDay, days.length - 1));
    const day = days[index];
    if (!day?.best) return { kind: 'hour', now: true, index, result: derived.result, time: derived.clock, ahead: null, day: day ?? null, hour: null };
    const focus = state.scoreFocus;
    const hour = focus?.kind === 'hour' ? day.hours.find((entry) => entry.t === focus.t && !entry.past) : null;
    if (hour) return { kind: 'hour', now: hour.live, index, result: hour.result, time: hour.at, ahead: hour.ahead, day, hour };
    const part = focus?.kind === 'part' ? day.parts.find((entry) => entry.id === focus.id && entry.stretch) : null;
    const stretch = part?.stretch ?? day.best;
    return {
        kind: part ? 'part' : 'day',
        now: Boolean(stretch.top.live),
        index,
        result: part ? stretchResult(stretch) : day.result,
        time: stretch.top.at,
        ahead: stretch.top.ahead,
        day,
        part,
        stretch,
    };
}

let lastDerived = null; // what the card was last drawn from, so a day tab can redraw it without re-deriving

/** Today, then each day ahead in the outlook, each with its day score: tabs that switch the whole card. */
function renderScoreDays(derived) {
    const container = $('scoreDays');
    if (!derived) {
        container.querySelectorAll('.score-day').forEach((tab, index) => tab.toggleAttribute('disabled', index > 0));
        return;
    }
    const view = scoreView(derived);
    container.replaceChildren(...derived.outlook.days.map((day, index) => {
        const result = day.result;
        const selected = index === view.index;
        return el('button', {
            type: 'button',
            class: 'score-day',
            role: 'tab',
            id: `score-day-${index}`,
            'aria-selected': String(selected),
            'aria-controls': 'scoreMain',
            tabindex: selected ? '0' : '-1',
            onClick: () => selectScoreDay(index),
        },
        el('span', { class: 'score-day-name' }, day.label),
        el('span', { class: 'score-day-score', dataset: { band: result.band.key } },
            el('span', { class: 'visually-hidden' }, ', day score '), String(result.score)));
    }));
}

/** Show another day, whole; choosing the day already shown takes it back to the whole day. */
function selectScoreDay(index) {
    const changed = index !== state.scoreDay || state.scoreFocus !== null;
    state.scoreDay = index;
    state.scoreFocus = null;
    pinnedDial = null;
    if (lastDerived) renderScoreCard(lastDerived);
    if (changed) swapScore();
    $(`score-day-${index}`)?.focus();
}

/** Show part of the chosen day: { kind: 'part', id }, { kind: 'hour', t }, or null for the whole day. */
function focusScore(focus, { animate = true } = {}) {
    const same = JSON.stringify(focus) === JSON.stringify(state.scoreFocus);
    if (same || !lastDerived) return false;
    state.scoreFocus = focus;
    pinnedDial = null;
    renderScoreCard(lastDerived);
    if (animate) swapScore();
    return true;
}

function swapScore() {
    if (!lastDerived) return;
    replayClass(document.querySelector('#scoreCard .score-number'), 'is-swapping');
    replayClass($('scoreBand'), 'is-swapping');
}

function initScoreDays() {
    // Arrow keys move between the tabs, as in any tab list.
    $('scoreDays').addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !lastDerived) return;
        const count = lastDerived.outlook.days.length;
        const current = scoreView(lastDerived).index;
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1
            : (current + (event.key === 'ArrowRight' ? 1 : -1) + count) % count;
        event.preventDefault();
        selectScoreDay(next);
    });
    initDayStrip();
}

/** Everything in the score card, for the day chosen. */
function renderScoreCard(derived) {
    renderScoreDays(derived);
    renderScore(derived);
    renderDayStrip(derived);
    renderFactors(derived);
    renderDials(derived);
}

/** "6–8 PM", "11 AM–1 PM", "6:30–8 AM": a stretch of hours, as short as it can be said. */
function hourRange(start, end) {
    const short = (time) => clockTime(time).replace(':00', '');
    const [from, fromHalf] = short(start).split(/\s/);
    const to = short(end);
    return to.endsWith(fromHalf) ? `${from}–${to}` : `${from} ${fromHalf}–${to}`;
}

const hourName = (time) => clockTime(time).replace(':00', '');

function renderScore(derived) {
    const card = $('scoreCard');
    if (!derived) {
        card.dataset.band = 'loading';
        card.dataset.state = state.loadFailed ? 'failed' : 'loading';
        $('headerScore').dataset.band = 'loading';
        setText('headerScore', '');
        setText('scoreValue', '–');
        setText('scoreBand', ' ');
        setText('scorePhrase', state.loadFailed ? 'Conditions unavailable' : 'Checking conditions…');
        setText('scoreHeld', ' ');
        setText('scoreCap', '');
        // While loading, hold the room the best times and the weather will take, so the card
        // does not grow when they arrive. The same placeholders are in index.html.
        const waiting = !state.loadFailed;
        $('scoreBest').replaceChildren(...(waiting
            ? [el('span', { class: 'eyebrow score-best-label' }, 'Best two hours'), el('span', { class: 'window is-placeholder' }, ' ')]
            : []));
        setText('scoreNow', waiting ? ' ' : '');
        return;
    }
    const view = scoreView(derived);
    const { result, day } = view;
    const { current } = state.weather;
    // The first score for a place (after the loading ripple) is revealed; later redraws are not.
    revealing = card.dataset.state !== 'ready';
    if (revealing) playReveal();
    $('scorePin').style.left = `${Math.max(0, Math.min(100, result.score))}%`;
    card.dataset.band = result.band.key;
    card.dataset.state = 'ready';
    card.dataset.day = view.now ? 'now' : 'ahead';
    card.dataset.focus = view.kind;
    // A single hour is told by the strip's own read-out, not by re-reading the whole card each step.
    $('scoreMain').setAttribute('aria-live', view.kind === 'hour' ? 'off' : 'polite');
    // The header gives today's score, whichever day or hour the card is showing.
    const today = derived.outlook.days[0]?.result ?? derived.result;
    $('headerScore').dataset.band = today.band.key;
    setText('headerScore', String(today.score));
    setText('scoreValue', String(result.score));
    setText('scoreBand', result.band.label);
    setText('scorePhrase', result.phrase);
    setText('scoreHeld', heldBackText(result));
    setText('scoreCap', result.cap ? result.cap.reason : '');

    // What the number is for: the day's best two hours, a part of the day, or one hour.
    const whole = el('button', { type: 'button', class: 'btn btn-quiet score-whole', onClick: () => focusScore(null) }, 'Whole day');
    const label = (text) => el('span', { class: 'eyebrow score-best-label' }, text);
    const chip = (text) => el('span', { class: 'window nowrap' }, text);
    if (!day?.best) $('scoreBest').replaceChildren(label('Right now'));
    else if (view.kind === 'day') {
        $('scoreBest').replaceChildren(label(`Best two hours${view.index ? ` on ${day.label}` : ''}`),
            chip(day.flat ? 'much the same all day' : hourRange(day.best.start, day.best.end)));
    } else if (view.kind === 'part') {
        $('scoreBest').replaceChildren(label(view.part.label), chip(hourRange(view.stretch.start, view.stretch.end)), whole);
    } else {
        $('scoreBest').replaceChildren(label(view.now ? 'Right now' : 'Forecast for'),
            chip(view.now ? `until ${hourName(view.hour.t + HOUR_MS)}` : `${view.index ? `${day.label} ` : ''}${hourName(view.hour.t)}`), whole);
    }

    if (view.index > 0) {
        // A day ahead: the forecast for the moment behind the number.
        const sky = SKY_LABELS[view.ahead?.sky];
        const wind = isNum(view.ahead?.windMph) ? `wind ${Math.round(view.ahead.windMph)} mph` : null;
        $('scoreNow').replaceChildren(icon('calendar'), ['Forecast', sky, wind].filter(Boolean).join(' · '));
        return;
    }
    // Today: the score this moment, as a chip that turns the card to it, and the weather now.
    const live = derived.result;
    const showingLive = view.kind === 'hour' && view.now;
    const feelsLike = isNum(current.feelsLikeF) ? ` · feels like ${Math.round(current.feelsLikeF)}°F` : '';
    $('scoreNow').replaceChildren(
        el('button', {
            type: 'button',
            class: 'score-live',
            'aria-pressed': String(showingLive),
            onClick: () => {
                const hour = day?.hours.find((entry) => entry.live);
                if (hour) focusScore(showingLive ? null : { kind: 'hour', t: hour.t });
            },
        },
        'Right now',
        el('span', { class: 'score-day-score', dataset: { band: live.band.key }, id: 'nowScore' }, String(live.score))),
        el('span', { class: 'score-now-weather' }, icon(skyIcon(current.sky)), `${current.sky.label} · ${Math.round(current.tempF)}°F${feelsLike}`),
    );
}

// ---------------------------------------------------------------------------
// The strip of the day under the stamp: drag along it for the score hour by hour
// ---------------------------------------------------------------------------

const shortHour = (time) => hourName(time).replace(/ ([AP])M$/, (_, half) => half.toLowerCase());

function renderDayStrip(derived) {
    const strip = $('dayStrip');
    const track = $('stripTrack');
    const view = derived ? scoreView(derived) : null;
    const day = view?.day;
    if (!day?.best) {
        strip.dataset.state = derived ? 'empty' : 'loading';
        track.replaceChildren();
        track.removeAttribute('aria-valuenow');
        track.removeAttribute('aria-valuetext');
        $('stripTicks').replaceChildren();
        $('stripParts').replaceChildren();
        return;
    }
    strip.dataset.state = 'ready';
    const { hours } = day;
    const count = hours.length;
    const lit = view.kind === 'hour' ? [view.hour.t, view.hour.t + HOUR_MS] : [view.stretch.start, view.stretch.end];
    const position = (time) => `${(100 * (time - hours[0].t)) / (count * HOUR_MS)}%`;

    const bars = hours.map((hour) => {
        const bar = el('span', {
            class: 'strip-bar',
            dataset: hour.past ? { past: '' } : { band: hour.band.key, ...(hour.t >= lit[0] && hour.t < lit[1] ? { lit: '' } : {}) },
        });
        if (!hour.past) bar.style.setProperty('--score', String(hour.score / 100));
        return bar;
    });
    const marks = [];
    const liveHour = hours.find((hour) => hour.live);
    if (liveHour) {
        const now = el('span', { class: 'strip-now' });
        now.style.left = position(derived.clock);
        marks.push(now);
    }
    if (view.kind === 'hour') {
        const thumb = el('span', { class: 'strip-thumb' }, el('span', { class: 'strip-thumb-label' }, view.now ? 'Now' : shortHour(view.hour.t)));
        thumb.style.left = position(view.hour.t + HOUR_MS / 2);
        // Keep the read-out inside the strip at either end.
        const share = (view.hour.t - hours[0].t) / (count * HOUR_MS);
        thumb.dataset.edge = share < 0.08 ? 'start' : share > 0.88 ? 'end' : '';
        marks.push(thumb);
    }
    track.replaceChildren(...bars, ...marks);

    const ahead = hours.filter((hour) => !hour.past);
    const current = view.kind === 'hour' ? view.hour : view.stretch.top;
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', String(count - 1));
    track.setAttribute('aria-valuenow', String(hours.indexOf(current)));
    track.setAttribute('aria-valuetext', `${current.live ? 'Now' : hourName(current.t)}, score ${current.score}, ${current.band.label}`);
    track.setAttribute('aria-label', `${day.label === 'Today' ? "Today's" : `${day.label}'s`} score hour by hour`);
    track.toggleAttribute('aria-disabled', ahead.length < 2);

    $('stripTicks').replaceChildren(...hours.flatMap((hour, index) => {
        if (index % 6 || index === 0) return [];
        const tick = el('span', { class: 'strip-tick' }, shortHour(hour.t));
        tick.style.left = position(hour.t);
        return [tick];
    }));

    $('stripParts').replaceChildren(...day.parts.map((part) => {
        const pressed = view.kind === 'part' && view.part.id === part.id;
        return el('button', {
            type: 'button',
            class: 'strip-part',
            'aria-pressed': String(pressed),
            disabled: !part.stretch,
            title: part.stretch ? hourRange(part.stretch.start, part.stretch.end) : `${part.label} has passed`,
            onClick: () => focusScore(pressed ? null : { kind: 'part', id: part.id }),
        },
        el('span', { class: 'strip-part-name' }, part.label),
        el('span', { class: 'strip-part-score', dataset: part.stretch ? { band: bandFor(part.stretch.score).key } : {} },
            part.stretch ? String(part.stretch.score) : '–'));
    }));
}

function initDayStrip() {
    const track = $('stripTrack');
    const hoursShown = () => (lastDerived ? scoreView(lastDerived).day?.hours ?? [] : []);
    /** Show the hour under the pointer (the first one still to come, when it is over hours gone by). */
    const pick = (event) => {
        const hours = hoursShown();
        if (!hours.length) return;
        const rect = track.getBoundingClientRect();
        const index = Math.max(0, Math.min(hours.length - 1, Math.floor(((event.clientX - rect.left) / rect.width) * hours.length)));
        const hour = hours[index].past ? hours.find((entry) => !entry.past) : hours[index];
        if (hour && focusScore({ kind: 'hour', t: hour.t }, { animate: false })) {
            try { navigator.vibrate?.(4); } catch { /* not everywhere */ }
        }
    };
    let dragging = false;
    track.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || !hoursShown().length) return;
        dragging = true;
        track.setPointerCapture(event.pointerId);
        pick(event);
    });
    track.addEventListener('pointermove', (event) => { if (dragging) pick(event); });
    const stop = () => { dragging = false; };
    track.addEventListener('pointerup', stop);
    track.addEventListener('pointercancel', stop);

    track.addEventListener('keydown', (event) => {
        if (!lastDerived) return;
        if (event.key === 'Escape') {
            if (state.scoreFocus) { event.preventDefault(); focusScore(null); }
            return;
        }
        const view = scoreView(lastDerived);
        const ahead = view.day?.hours.filter((hour) => !hour.past) ?? [];
        if (!ahead.length || !['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) return;
        event.preventDefault();
        const from = ahead.indexOf(view.kind === 'hour' ? view.hour : view.stretch.top);
        const step = { ArrowLeft: -1, ArrowRight: 1, PageUp: -3, PageDown: 3 }[event.key] ?? 0;
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? ahead.length - 1
            : Math.max(0, Math.min(ahead.length - 1, from + step));
        focusScore({ kind: 'hour', t: ahead[index].t }, { animate: false });
    });
}

function renderSpeciesGroup() {
    const { options, chosen } = speciesChoice();
    const container = $('speciesGroup');
    const hadFocus = container.contains(document.activeElement);
    const single = options.length === 1;

    container.hidden = single;
    $('speciesLabel').hidden = single;
    container.replaceChildren(...(single ? [] : options.map((option) => el('button', {
        type: 'button',
        dataset: { group: option.id },
        'aria-pressed': String(option.id === chosen.id),
    }, option.label))));
    if (hadFocus) container.querySelector('button[aria-pressed="true"]')?.focus();

    let note = '';
    if (single) note = `Scored for ${chosen.label.toLowerCase()}, the sport fish found around here.`;
    else if (modeChoice().mode === 'fresh' && chosen.id !== state.speciesGroup) note = `${DEFAULT_LABELS[state.speciesGroup]} aren't recorded around here.`;
    setText('speciesNote', note);
}

function renderModeGroup() {
    const { modes, mode } = modeChoice();
    const container = $('modeGroup');
    const hadFocus = container.contains(document.activeElement);
    $('modeRow').hidden = modes.length < 2;
    container.replaceChildren(...modes.map((id) => el('button', {
        type: 'button',
        dataset: { mode: id },
        'aria-pressed': String(id === mode),
    }, MODE_LABELS[id])));
    if (hadFocus) container.querySelector('button[aria-pressed="true"]')?.focus();
}

/** Salt water: the next highs and lows, and where the water temperature comes from. */
function renderTides(derived) {
    const salt = Boolean(derived?.salt);
    $('tideCard').hidden = !salt;
    // The freshwater parts of the section have nothing to say about a bay or a beach.
    for (const id of ['levelCard', 'waterGrid', 'waterFilter', 'waterChartCard', 'levelChartCard', 'levelSource']) $(id).hidden = salt;
    $('tideSource').hidden = !salt;
    setText('waterTitle', salt ? headings().tides : headings().water);
    if (!salt) return;

    const coast = state.coast;
    const stat = (label, value, hint) => el('div', { class: 'level-stat' },
        el('dt', null, label),
        el('dd', null, el('strong', null, value), hint ? el('span', null, hint) : null));
    const tide = derived.tide;
    const items = [
        tide && stat('Tide now', `${tide.heightFt.toFixed(1)} ft`, tide.slack ? 'slack water' : tide.direction),
        ...upcomingTides(coast?.tides, derived.clock, 4).map((extreme) => stat(
            extreme.type === 'H' ? 'High' : 'Low', clockTime(extreme.t, { withDay: true }), `${extreme.heightFt.toFixed(1)} ft`)),
    ];
    $('tideStats').replaceChildren(...items.filter(Boolean));

    setText('waterSummary', derived.seaTemp
        ? `Water temperature: ${derived.seaTemp.source}.`
        : 'No water temperature reading is available near here, so it is estimated from the last three days of air temperature.');
    setText('tideSource', coast?.tides?.length
        ? `NOAA tide predictions for ${coast.tideStation.name}, ${coast.tideStation.distanceMi.toFixed(1)} mi away. Heights are above the average lowest tide.`
        : 'Tide predictions are unavailable right now.');
}

function renderAlerts(derived) {
    const container = $('alerts');
    const items = derived?.alerts.items ?? [];
    container.hidden = items.length === 0;
    container.replaceChildren(...items.map((item) => {
        let when = '';
        if (!item.active && item.onset) when = ` from ${clockTime(item.onset, { withDay: true })}`;
        else if (item.ends) when = ` until ${clockTime(item.ends, { withDay: true })}`;
        return el('li', { class: 'alert', dataset: { level: item.level } },
            el('strong', null, item.event), when,
            item.level === 'danger' && item.active ? ' — stay off the water' : '');
    }));
}

// ---------------------------------------------------------------------------
// The dials round the stamp
// ---------------------------------------------------------------------------

// Where the dials sit: an arc over the stamp, in the frame's own pixels (styles.css,
// .score-dial-frame: 288 × 240, stamp centred at 144, 148 with a radius of 88).
const DIAL_ARC = { cx: 144, cy: 148, radius: 125, from: -96, to: 96 };
const DIAL_R = 18; // ring radius inside a 42-px dial
const DIAL_NAMES = { water: 'water temperature', light: 'light', season: 'season', wind: 'wind', flow: 'river flow', moon: 'moon', pressure: 'pressure', tide: 'tide', waves: 'surf' };
let pinnedDial = null; // the factor whose reading stays up after a tap
let dialShares = new Map(); // how full each ring was last drawn, so a new day or reading slides from there
let revealing = false; // the score has just arrived: the card plays its reveal (styles.css, .is-revealing)
let revealTimer = null;

/** Restart a CSS animation that a class runs, even if the class is already on. */
function replayClass(node, className) {
    if (!node) return;
    node.classList.remove(className);
    void node.offsetWidth; // a reflow, so the browser sees the class come back
    node.classList.add(className);
}

/** The stamp is pressed on and the dials fill in turn; the class comes off once it has played. */
function playReveal() {
    const card = $('scoreCard');
    replayClass(card, 'is-revealing');
    clearTimeout(revealTimer);
    revealTimer = setTimeout(() => card.classList.remove('is-revealing'), 1600);
}

/** "Moon · First Quarter · 2 of 7, poor" */
function dialDetail(factor, derived) {
    const display = factorDisplay(factor, derived, scoreView(derived));
    return `${display.label} · ${display.value} · ${factor.points} of ${factor.max}, ${RATING_LABELS[factor.rating].toLowerCase()}`;
}

function showDial(factor, derived) {
    const detail = $('dialDetail');
    $('scoreCard').classList.toggle('is-showing-dial', Boolean(factor));
    if (!factor) return;
    detail.textContent = dialDetail(factor, derived);
    detail.dataset.rating = factor.rating;
}

/** One dial per factor, the ones worth most first, its ring filled as far as the factor scores. */
function renderDials(derived) {
    const container = $('scoreDials');
    if (!derived) {
        container.replaceChildren();
        pinnedDial = null;
        dialShares = new Map();
        showDial(null);
        return;
    }
    const view = scoreView(derived);
    const previous = revealing ? new Map() : dialShares;
    dialShares = new Map();
    const fills = [];
    const factors = [...view.result.factors].sort((a, b) => b.max - a.max);
    const heaviest = factors[0].max;
    const step = factors.length > 1 ? (DIAL_ARC.to - DIAL_ARC.from) / (factors.length - 1) : 0;
    const circumference = 2 * Math.PI * DIAL_R;
    const restore = () => showDial(factors.find((factor) => factor.id === pinnedDial) ?? null, derived);
    container.replaceChildren(...factors.map((factor, index) => {
        const angle = ((factors.length > 1 ? DIAL_ARC.from + step * index : 0) * Math.PI) / 180;
        const display = factorDisplay(factor, derived, view);
        const share = factor.points / factor.max;
        const width = 2.5 + 2.5 * (factor.max / heaviest); // the factors that count most have the heaviest rings
        // The ring is drawn where it was last time (empty on a reveal), then moved to its new
        // value on the next frame so the change shows as a slide.
        const from = previous.get(factor.id) ?? (revealing ? 0 : share);
        dialShares.set(factor.id, share);
        const dash = (value) => `${(circumference * value).toFixed(1)} ${circumference.toFixed(1)}`;
        const fill = svg('circle', {
            class: `dial-fill${from > 0 ? '' : ' is-empty'}`, cx: 21, cy: 21, r: DIAL_R, 'stroke-width': width,
            'stroke-dasharray': dash(from),
        });
        if (from !== share) fills.push(() => {
            fill.setAttribute('stroke-dasharray', dash(share));
            fill.classList.toggle('is-empty', share <= 0);
        });
        const dial = el('button', {
            type: 'button',
            class: 'dial',
            dataset: { rating: factor.rating, factor: factor.id },
            'aria-pressed': String(pinnedDial === factor.id),
            'aria-label': `${display.label}: ${display.value}, ${factor.points} of ${factor.max}, ${RATING_LABELS[factor.rating].toLowerCase()}`,
            onMouseenter: () => showDial(factor, derived),
            onFocus: () => showDial(factor, derived),
            onMouseleave: restore,
            onBlur: restore,
            onClick: () => {
                pinnedDial = pinnedDial === factor.id ? null : factor.id;
                container.querySelectorAll('.dial').forEach((other) => other.setAttribute('aria-pressed', String(other.dataset.factor === pinnedDial)));
                showDial(pinnedDial ? factor : null, derived);
            },
        },
        svg('svg', { class: 'dial-ring', viewBox: '0 0 42 42', 'aria-hidden': 'true', focusable: 'false' },
            svg('circle', { class: 'dial-track', cx: 21, cy: 21, r: DIAL_R, 'stroke-width': width }),
            fill),
        glyph(factor.id));
        dial.style.setProperty('--i', String(index));
        dial.style.left = `${(DIAL_ARC.cx + DIAL_ARC.radius * Math.sin(angle)).toFixed(1)}px`;
        dial.style.top = `${(DIAL_ARC.cy - DIAL_ARC.radius * Math.cos(angle)).toFixed(1)}px`;
        return dial;
    }));
    // Two frames: the first paints the starting point, the second starts the transition from it.
    if (fills.length) requestAnimationFrame(() => requestAnimationFrame(() => fills.forEach((move) => move())));
    restore();
}

/**
 * "Held back by the moon and light": the factors costing the most points, when they are
 * doing poorly enough to matter. A ceiling on the score already says this, so it gives way.
 */
function heldBackText(result) {
    if (result.cap) return '\u00a0';
    const costly = result.factors
        .filter((factor) => factor.points / factor.max < 0.6 && factor.max - factor.points >= 3)
        .sort((a, b) => (b.max - b.points) - (a.max - a.points))
        .slice(0, 2)
        .map((factor) => DIAL_NAMES[factor.id] ?? factor.id);
    if (!costly.length) return 'Nothing is holding it back';
    return `Held back by ${costly.length === 2 ? `the ${costly[0]} and ${costly[1]}` : `the ${costly[0]}`}`;
}

function initDetailsToggle() {
    const toggle = $('detailsToggle');
    toggle.addEventListener('click', () => {
        const open = toggle.getAttribute('aria-expanded') !== 'true';
        toggle.setAttribute('aria-expanded', String(open));
        $('scoreCard').classList.toggle('is-open', open);
        toggle.textContent = open ? 'Hide details' : 'Details';
    });
}

function renderFactors(derived) {
    const container = $('factors');
    if (!derived) {
        container.replaceChildren(...Array.from({ length: 6 }, () => el('div', { class: 'factor is-placeholder', 'aria-hidden': 'true' })));
        return;
    }
    const view = scoreView(derived);
    container.replaceChildren(...view.result.factors.map((factor) => {
        const display = factorDisplay(factor, derived, view);
        const rating = RATING_LABELS[factor.rating];
        return el('article', { class: 'factor', dataset: { rating: factor.rating } },
            // The reading and its one-line detail are shown; what it means for the fishing is a tip.
            el('div', { class: 'factor-head' },
                el('h3', { class: 'factor-label' }, glyph(factor.id), display.label),
                tip('What this means for the fishing', el('span', { class: 'factor-note' }, factor.note))),
            el('p', { class: 'factor-value' }, display.valueIcon ?? null, display.value),
            el('p', { class: 'factor-extra' }, display.extra ?? ''),
            el('div', { class: 'factor-foot' },
                el('div', { class: 'meter', 'aria-hidden': 'true' },
                    el('span', { style: `width:${Math.round((factor.points / factor.max) * 100)}%` })),
                el('p', { class: 'factor-points' },
                    el('strong', null, String(factor.points)), `/${factor.max}`,
                    el('span', { class: 'rating-tag' }, rating))));
    }));
}

/**
 * The Amazon Associates tag, where the programme's rules clearly allow one: on the website,
 * in a browser tab, online. The rules bar affiliate links in software "installable by an
 * end user" and in offline material; an installed web app is not mentioned either way, so
 * there the links are left untagged (ordinary links) rather than risk the account.
 */
function affiliateTag() {
    if (!APP.AMAZON_ASSOCIATE_TAG) return null;
    const installed = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
    return installed || navigator.onLine === false ? null : APP.AMAZON_ASSOCIATE_TAG;
}

/** An Amazon search for a kind of lure. A plain, visible amazon.com address: no shortener, no redirect. */
function shopUrl(query, tag) {
    const url = new URL('https://www.amazon.com/s');
    url.searchParams.set('k', query);
    if (tag) url.searchParams.set('tag', tag);
    return url.href;
}

const capitalise = (text) => text.charAt(0).toUpperCase() + text.slice(1);

const TREND_SOURCES = {
    sensor: 'Daily means from the USGS sensor',
    'tide-station': 'Hourly readings from the NOAA tide station',
    satellite: 'Satellite sea-surface temperature, about a day behind',
};

/** The last few weeks of water temperature as a small line, with the first and last values under it. */
function sparkline(daily) {
    const width = 220;
    const height = 44;
    const pad = 3;
    const values = daily.map((entry) => entry.v);
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (max - min < 4) [min, max] = [(min + max) / 2 - 2, (min + max) / 2 + 2]; // a flat month should look flat
    const start = Date.parse(daily[0].day);
    const span = Math.max(1, Date.parse(daily[daily.length - 1].day) - start);
    const x = (entry) => pad + ((Date.parse(entry.day) - start) / span) * (width - 2 * pad);
    const y = (value) => pad + (1 - (value - min) / (max - min)) * (height - 2 * pad);
    const first = daily[0];
    const last = daily[daily.length - 1];
    const days = Math.round(span / (24 * 60 * 60 * 1000));
    return [
        svg('svg', {
            class: 'spark', viewBox: `0 0 ${width} ${height}`, role: 'img',
            'aria-label': `Daily water temperature over the last ${days} days, from ${first.v.toFixed(1)}°F to ${last.v.toFixed(1)}°F`,
        },
        svg('polyline', { class: 'spark-line', points: daily.map((entry) => `${x(entry).toFixed(1)},${y(entry.v).toFixed(1)}`).join(' ') }),
        svg('circle', { class: 'spark-dot', cx: x(last).toFixed(1), cy: y(last.v).toFixed(1), r: 3 })),
        el('p', { class: 'spark-ends', 'aria-hidden': 'true' },
            el('span', null, `${first.v.toFixed(1)}°F`), el('span', null, `${last.v.toFixed(1)}°F`)),
    ];
}

function trendPanel(lures, derived) {
    const { trend, trendLoading } = lures;
    if (trend) {
        return el('div', { class: 'lure-trend' },
            el('p', { class: 'lure-trend-head' }, `Water, last ${trend.days} days`),
            sparkline(trend.daily),
            el('ul', { class: 'lure-trend-facts' }, describeWaterTrend(trend).map((phrase) => el('li', null, phrase))),
            el('p', { class: 'lure-trend-source' }, TREND_SOURCES[trend.source]));
    }
    let text = 'No temperature history from this source, so the season is judged from the date and today\'s reading.';
    if (trendLoading) text = 'Loading the last few weeks of water temperature…';
    else if (!(derived.station || derived.seaTemp)) text = 'No sensor nearby, so the season is judged from the date and an estimated water temperature.';
    return el('div', { class: 'lure-trend' },
        el('p', { class: 'lure-trend-head' }, 'Water trend'),
        el('p', { class: 'lure-trend-source' }, text));
}

const percent = (x) => `${Math.round(x * 1000) / 10}%`;

/**
 * One dial: a ruled track from one end to the other. A firm call is a dot; a loose one is only
 * a shaded range, because a dot would claim more than the evidence does.
 */
function dial(name, ends, reading) {
    const track = el('div', { class: 'pace-track', 'aria-hidden': 'true' },
        reading.firm
            ? el('span', { class: 'pace-dot', style: `--at: ${percent(reading.value)}` })
            : el('span', { class: 'pace-band', style: `--from: ${percent(reading.low)}; --to: ${percent(reading.high)}` }));
    return el('div', { class: `pace${reading.firm ? '' : ' is-loose'}` },
        el('p', { class: 'pace-head' }, `${name}: `, el('strong', null, reading.label)),
        track,
        el('p', { class: 'pace-ends', 'aria-hidden': 'true' }, el('span', null, ends[0]), el('span', null, ends[1])),
        el('p', { class: 'pace-why' }, `${reading.why}.`));
}

/** How to fish it: retrieve speed, and finesse or power. */
function presentationDials({ speed, style }) {
    return el('div', { class: 'paces' },
        dial('Retrieve', ['slow', 'fast'], speed),
        dial('Style', ['finesse', 'power'], style),
        el('p', { class: 'paces-note' },
            'A dot is a firm call; a shaded range means it could go either way. ',
            tip('Where these come from', el('span', null,
                'Speed follows the water temperature, which is the best-measured part of this: fish are cold-blooded, and a cold fish will not chase far. '
                + 'Finesse or power follows water clarity, since fish see a lure from much closer in murky water. Past that it is angler practice, not measured. '
                + 'Both lean the way the suggestions below lean.'))));
}

// Woodcut drawings of the fish (drawings/fish/, traced from art/): the name lures.js gives a fish,
// and its drawing (panfish are drawn as a crappie, muskie as a pike, fluke as a flounder,
// sauger as its cousin the walleye). styles.css maps each to its file; a fish
// without one just has no picture.
const FISH_DRAWINGS = new Map([['bass', 'bass'], ['catfish', 'catfish'], ['walleye', 'walleye'], ['trout', 'trout'], ['panfish', 'crappie'], ['pike', 'pike'], ['muskie', 'pike'],
    ['redfish', 'redfish'], ['speckled trout', 'seatrout'], ['striped bass', 'striper'],
    ['flounder', 'flounder'], ['fluke', 'flounder'], ['smallmouth', 'smallmouth'], ['perch', 'perch'], ['sauger', 'walleye'],
    ['salmon', 'salmon'], ['bluefish', 'bluefish'], ['snook', 'snook'], ['pompano', 'pompano'], ['halibut', 'halibut']]);

/** Where the leading fish is in its year, what has changed lately, and the water temperature behind it. */
function renderLurePattern(derived) {
    const box = $('lurePattern');
    const waiting = !derived && !state.loadFailed;
    box.classList.toggle('is-placeholder', waiting);
    if (waiting) box.setAttribute('aria-hidden', 'true');
    else box.removeAttribute('aria-hidden');
    if (waiting) {
        box.hidden = false;
        box.replaceChildren();
        return;
    }
    const patterns = derived?.lures.patterns ?? [];
    const lead = patterns.find((entry) => entry.season);
    if (!lead) {
        box.hidden = true;
        box.replaceChildren();
        return;
    }
    const others = patterns.filter((entry) => entry !== lead && entry.season);
    box.hidden = false;
    const drawing = FISH_DRAWINGS.get(lead.target);
    box.replaceChildren(
        el('div', { class: `lure-season${drawing ? ' has-drawing' : ''}` },
            drawing && el('span', { class: 'fish-drawing', dataset: { fish: drawing }, 'aria-hidden': 'true' }),
            el('p', { class: 'lure-kicker' }, `${capitalise(lead.target)} · `, el('strong', null, lead.season.label)),
            el('p', { class: 'lure-pattern-text' }, `${lead.season.pattern}.`),
            lead.situations.map((text) => el('p', { class: 'lure-situation' }, `${text}.`)),
            lead.presentation && presentationDials(lead.presentation),
            others.length > 0 && el('p', { class: 'lure-also' },
                others.map((entry) => `${capitalise(entry.target)}: ${entry.season.label.toLowerCase()}`).join(' · '))),
        trendPanel(derived.lures, derived),
    );
}

// Woodcut drawings of the lures (drawings/lures/, traced from art/lures/), one per family,
// matched on the suggestion's name. Order matters: the first family whose pattern fits wins
// ("bladed swim jig" is a swimbait, not a jig; "nightcrawlers on the bottom" a bottom rig).
const LURE_DRAWINGS = [
    ['popping-cork', /popping cork/i],
    ['bobber-rig', /bobber|float/i],
    ['bottom-rig', /on the bottom|bottom rig|fish-finder|slip-sinker|carolina rig|pompano rig|two-hook|quick-strike|crawler harness|cut |crab/i],
    ['spinnerbait', /spinnerbait/i],
    ['spinner', /spinner/i],
    ['spoon', /spoon|diamond jig|blade bait|metal|epoxy/i],
    ['popper', /popper|prop bait|walk-the-dog|topwater|buzzbait|frog/i],
    ['crankbait', /crankbait|lipless/i],
    ['swimbait', /swimbait|paddle|swim jig|bladed jig|glide bait/i],
    ['jerkbait', /jerkbait|twitchbait|plug/i],
    ['worm', /worm|lizard|creature|eel|stick bait|senko/i],
    ['jig', /bucktail/i],
    ['grub', /grub|tube|twister|jighead|soft plastic|shad-shaped/i],
    ['jig', /jig/i],
    ['popping-cork', /shrimp|pinfish/i],
    ['bottom-rig', /liver|stink|bait/i],
];
const lureDrawing = (name) => LURE_DRAWINGS.find(([, pattern]) => pattern.test(name))?.[0] ?? null;

/** A lure-shaped blank shown while the conditions load. The same four are in index.html. */
const lurePlaceholder = () => el('li', { class: 'lure is-placeholder', 'aria-hidden': 'true' },
    el('p', { class: 'lure-target' }, '\u00a0'),
    el('div', { class: 'lure-name' }, el('h3', null, '\u00a0')),
    el('p', { class: 'lure-why' }, '\u00a0', el('br'), '\u00a0'),
    el('span', { class: 'lure-shop' }, '\u00a0'));

function renderLures(derived) {
    const list = $('lureList');
    const tag = affiliateTag();
    $('affiliateDisclosure').hidden = !tag;
    renderLurePattern(derived);
    if (!derived) {
        list.replaceChildren(...(state.loadFailed ? [] : Array.from({ length: LURE_PICKS }, lurePlaceholder)));
        setText('lureSummary', state.loadFailed ? 'Suggestions need the current conditions.' : 'Suggestions will appear with the conditions.');
        setText('lureColour', '');
        return;
    }
    const { picks, colour, species } = derived.lures;
    const fish = species.id === 'any' ? 'the fish found around here' : species.label.toLowerCase();
    setText('lureSummary', picks.length
        ? `Picked for ${fish} from where they are in their year (the date, the water temperature and which way it has been heading), what has changed lately (a cold snap, a front, rising or falling water), and the ${derived.salt ? 'light, tide and wind' : 'light, wind and clarity'} right now.`
        : `There are no suggestions yet for ${fish}.`);
    list.replaceChildren(...picks.map((pick) => el('li', { class: `lure${lureDrawing(pick.name) ? ' has-drawing' : ''}` },
        lureDrawing(pick.name) && el('span', { class: 'lure-drawing', dataset: { lure: lureDrawing(pick.name) }, 'aria-hidden': 'true' }),
        el('p', { class: 'lure-target' }, `For ${pick.target}`, pick.season && el('span', { class: 'lure-season-tag' }, ` · ${pick.season}`)),
        el('div', { class: 'lure-name' },
            el('h3', null, pick.name),
            tip('How to fish it', el('span', { class: 'lure-how' }, pick.how))),
        el('p', { class: 'lure-why' }, `${pick.why}.`),
        pick.note && el('p', { class: 'lure-adjust' }, `${pick.note}.`),
        pick.query && el('a', {
            class: 'lure-shop',
            href: shopUrl(pick.query, tag),
            target: '_blank',
            // "sponsored" is how search engines ask for paid links to be marked.
            rel: tag ? 'sponsored nofollow noopener' : 'nofollow noopener',
            // Four links all reading "Amazon" need a fuller name for screen readers.
            'aria-label': `Find ${pick.name.toLowerCase()} on Amazon${tag ? ' (paid link)' : ''}`,
            // Amazon and the FTC both want the disclosure next to the link itself, not only on the page.
        }, 'Amazon', tag && el('span', { class: 'lure-paid' }, ' · paid link')))));
    setText('lureColour', colour);
}

// ----- Where to look --------------------------------------------------------------------

const lakeKey = (location) => `${location.lat.toFixed(3)},${location.lon.toFixed(3)}`;
const lakeWanted = () => Boolean(state.location) && modeChoice().mode === 'fresh' && state.location.kind !== 'river';
const zonesCache = { key: null, zones: [] }; // finding the zones walks the whole shore: once per lake, phase and wind

function whereZones(lake, plan, windFrom) {
    const key = `${lake.id}|${plan.kinds.map((k) => k.kind).join()}|${Math.round((windFrom ?? 0) / 22.5)}`;
    if (zonesCache.key !== key) {
        zonesCache.key = key;
        zonesCache.zones = locateZones(lake, plan, { windFrom });
    }
    return zonesCache.zones;
}

function renderWhere(derived) {
    const section = $('where');
    const lead = derived?.lures.patterns.find((entry) => entry.season);
    if (!derived || derived.salt || !lead) {
        section.hidden = true;
        return;
    }
    section.hidden = false;
    const { current } = state.weather;
    const windFrom = isNum(current.windDirection) ? current.windDirection : null;
    const plan = targetPlan({ phaseId: lead.season.id, windMph: current.windMph, windFrom, waterTempF: derived.waterTempF });

    const known = state.lake?.key === lakeKey(state.location) ? state.lake : null;
    // Whatever drew the card (a fresh load, conditions kept from a moment ago, a change of
    // mode), the lake for this place is fetched if it isn't here or on its way.
    if (!known && lakeWanted()) queueMicrotask(loadLake);
    const lake = known?.status === 'ready' ? known.lake : null;
    const zones = lake ? whereZones(lake, plan, windFrom) : [];
    const numbered = zones.map((zone) => ({ ...zone, title: plan.kinds.find((k) => k.kind === zone.kind)?.title }));

    let status;
    if (state.location.kind === 'river') status = 'Rivers aren\'t mapped yet; these are what to look for along the banks.';
    else if (!known || known.status === 'loading') status = 'Finding the lake\'s outline… a big lake can take a minute the first time.';
    else if (lake) status = `${lake.name ?? 'This lake'}, for ${lead.target} in the ${lead.season.label.toLowerCase()}.`;
    else if (known.status === 'too-big') status = 'This water is too big to mark spot by spot; these are what to look for along its shores.';
    else if (known.status === 'failed') status = 'The lake outline couldn\'t be loaded; these are what to look for.';
    else status = 'No lake mapped right here. Search for a lake by name to see these marked on it.';
    $('whereLake').replaceChildren(status, known?.status === 'failed'
        ? el('button', { type: 'button', class: 'where-retry', onClick: () => loadLake() }, 'Try again')
        : '');

    $('whereList').replaceChildren(...plan.kinds.map((entry) => {
        const numbers = numbered.map((zone, index) => (zone.kind === entry.kind ? index + 1 : null)).filter(Boolean);
        return el('li', { class: `where-item zone-${entry.kind}` },
            el('span', { class: 'where-swatch', 'aria-hidden': 'true' }),
            el('div', { class: 'where-text' },
                el('h3', { class: 'where-title' }, entry.title,
                    numbers.length > 0 && el('span', { class: 'where-numbers' }, ` · on the map: ${numbers.join(', ')}`),
                    lake && numbers.length === 0 && el('span', { class: 'where-numbers' }, ' · none stand out on this lake')),
                el('p', { class: 'where-why' }, `${entry.why}.`)));
    }));

    const notes = [plan.calmNote, plan.depthNote].filter(Boolean);
    $('whereNote').hidden = notes.length === 0;
    setText('whereNote', notes.join(' '));

    $('whereMapFrame').hidden = !lake;
    if (lake) lakeMap.update({ lake, zones: numbered, location: state.location });
}

async function loadLake() {
    if (!lakeWanted()) return;
    const location = state.location;
    const key = lakeKey(location);
    if (state.lake?.key === key && state.lake.status !== 'failed') return;
    state.lake = { key, status: 'loading', lake: null };
    if (lastDerived) renderWhere(lastDerived);
    let next;
    try {
        const { lake, reason } = await fetchLake(location.lat, location.lon);
        next = { key, status: lake ? 'ready' : reason ?? 'none', lake };
    } catch {
        next = { key, status: 'failed', lake: null };
    }
    if (state.location !== location && lakeKey(state.location) !== key) return;
    state.lake = next;
    renderWhere(derive());
}

function renderForecast() {
    const list = $('forecastList');
    setText('forecastTitle', headings().weather);
    const { weather } = state;
    if (!weather) {
        list.replaceChildren();
        return;
    }
    const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: weather.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    const dayName = new Intl.DateTimeFormat('en-US', { timeZone: weather.timezone, weekday: 'short' });
    const dayDate = new Intl.DateTimeFormat('en-US', { timeZone: weather.timezone, month: 'short', day: 'numeric' });
    const today = dayKey.format(weather.current.time);

    const days = weather.daily.filter((day) => dayKey.format(day.t) >= today).slice(0, APP.FORECAST_DAYS);
    if (!days.length) {
        list.replaceChildren(el('li', { class: 'forecast-empty muted' },
            'The Weather Service has no daily forecast for this exact spot, which happens on open water. Pick a place on the shore for one.'));
        return;
    }
    list.replaceChildren(...days.map((day) => {
        const isToday = dayKey.format(day.t) === today;
        return el('li', { class: 'forecast-day' },
            el('p', { class: 'forecast-name' }, isToday ? 'Today' : dayName.format(day.t),
                el('span', { class: 'muted' }, dayDate.format(day.t))),
            el('p', { class: 'forecast-icon', 'aria-hidden': 'true' }, icon(SKY_ICONS.has(day.icon) ? day.icon : 'cloud')),
            el('p', { class: 'forecast-label' }, day.label),
            el('p', { class: 'forecast-temps' },
                // In the evening NWS no longer forecasts a daytime high for today.
                el('strong', null, isNum(day.highF) ? `${Math.round(day.highF)}°` : '—'),
                el('span', { class: 'muted' }, ` / ${isNum(day.lowF) ? `${Math.round(day.lowF)}°` : '—'}`)),
            el('p', { class: 'forecast-meta' },
                `${Math.round(day.precipChance ?? 0)}% precip`, el('br'),
                day.windMaxMph >= 1 ? `Wind to ${Math.round(day.windMaxMph)} mph` : 'Calm'));
    }));
}

function waterSummary(station) {
    const kinds = { all: '', lake: 'lake ', river: 'river ' }[state.waterFilter];
    if (station) {
        return `USGS reading from ${station.name}, ${station.distanceMi.toFixed(1)} mi away, taken ${timeAgo(station.readingTime)}.`;
    }
    const estimate = 'Water temperature is estimated from the last three days of air temperature.';
    if (state.stationsError) return `${state.stationsError} ${estimate}`;
    if (!state.weather) return 'Looking for nearby USGS sensors…';
    return `No USGS ${kinds}sensors are reporting within ${APP.STATION_RADIUS_MI} miles. ${estimate}`;
}

function renderStations(derived) {
    const station = derived?.station ?? null;
    if (!derived?.salt) setText('waterSummary', waterSummary(station));

    for (const button of $('waterFilter').querySelectorAll('button')) {
        button.setAttribute('aria-pressed', String(button.dataset.filter === state.waterFilter));
    }

    const stations = visibleStations();
    const list = $('stationList');
    const hadFocus = list.contains(document.activeElement);
    if (stations.length === 0) {
        list.replaceChildren(el('li', { class: 'stations-empty' },
            state.weather || state.loadFailed ? 'No stations to show.' : 'Loading stations…'));
    } else {
        list.replaceChildren(...stations.map((item) => {
            const selected = item.id === station?.id;
            return el('li', null,
                el('button', {
                    class: 'station',
                    type: 'button',
                    'aria-pressed': String(selected),
                    onClick: () => selectStation(item.id),
                },
                el('span', { class: 'station-check' }, selected ? icon('check') : null),
                el('span', { class: 'station-text' },
                    el('span', { class: 'station-name' }, item.name),
                    el('span', { class: 'station-meta' },
                        `${item.kindLabel} · ${item.distanceMi.toFixed(1)} mi · ${timeAgo(item.readingTime)}`)),
                el('span', { class: 'station-temp' }, `${item.tempF.toFixed(1)}°F`)));
        }));
    }

    if (hadFocus) list.querySelector('.station[aria-pressed="true"]')?.focus();

    if (state.location) {
        stationMap.update({ location: state.location, stations, selectedId: station?.id ?? null });
    }
}

const formatFlow = (cfs) => `${cfs >= 100 ? Math.round(cfs).toLocaleString('en-US') : cfs.toFixed(1)} cfs`;

function renderLevel(derived) {
    const stats = $('levelStats');
    const level = derived?.level ?? null;
    if (!level) {
        stats.replaceChildren();
        let text = 'Looking for nearby USGS gauges…';
        if (state.stationsError) text = 'Water level and flow are unavailable right now.';
        else if (state.weather || state.loadFailed) {
            const kinds = { all: '', lake: 'lake ', river: 'river ' }[state.waterFilter];
            text = `No USGS ${kinds}level or flow gauges are reporting within ${APP.STATION_RADIUS_MI} miles.`;
        }
        setText('levelSource', text);
        return;
    }

    const { station, trend } = level;
    const isElevation = station.level.type === 'elevation';
    const median = flowInput(station)?.percentiles[50];
    const oxygen = station.oxygen ?? derived.station?.oxygen ?? null;
    const turbidity = station.turbidity ?? derived.station?.turbidity ?? null;
    const stat = (label, value, hint) => el('div', { class: 'level-stat' },
        el('dt', null, label),
        el('dd', null, el('strong', null, value), hint ? el('span', null, hint) : null));

    const trendWord = { rising: 'Rising', falling: 'Falling', steady: 'Steady', unknown: 'Not enough history' }[trend.direction];
    let change = '—';
    if (isNum(trend.delta)) {
        const rounded = Math.abs(trend.delta).toFixed(2);
        const sign = rounded === '0.00' ? '' : trend.delta > 0 ? '+' : '−';
        change = `${sign}${rounded} ft`;
    }
    const items = [
        stat(station.kind === 'lake' ? 'Lake level' : 'River level',
            `${station.level.valueFt.toFixed(2)} ft`,
            isElevation ? `elevation, ${station.level.datum}` : 'gage height'),
        station.flow && stat('Flow', formatFlow(station.flow.cfs),
            isNum(median) ? `median for today ${formatFlow(median)}` : null),
        stat('24-hour change', change, trendWord + (trend.rapid ? ' fast' : '')),
        // Reported by a minority of stations; shown when this one (or the temperature station) has them.
        oxygen && stat('Dissolved oxygen', `${oxygen.mgL.toFixed(1)} mg/L`, oxygen.mgL < 5 ? 'low' : null),
        turbidity && stat('Turbidity', `${turbidity.fnu < 10 ? turbidity.fnu.toFixed(1) : Math.round(turbidity.fnu)} FNU`,
            turbidity.fnu < 10 ? 'clear' : turbidity.fnu < 50 ? 'stained' : 'muddy'),
    ];
    stats.replaceChildren(...items.filter(Boolean)); // replaceChildren would print a null as text

    const explain = isElevation
        ? 'Elevation is the height of the water surface above the datum, not the depth.'
        : "Gage height is measured from the gauge's own reference point, not from the bottom, so watch the trend rather than the number.";
    setText('levelSource',
        `USGS gauge: ${station.name}, ${station.distanceMi.toFixed(1)} mi away, read ${timeAgo(station.level.time)}. ${explain}`);
}

function renderCharts(derived) {
    const timezone = state.weather?.timezone;
    charts.pressure.update(derived?.pressure ?? [], {
        timezone,
        emptyText: derived ? 'No barometer is reporting near here.' : 'Pressure history will appear here.',
    });
    charts.air.update(derived?.air ?? [], { timezone, emptyText: 'Temperature history will appear here.' });
    charts.water.update(derived?.station ? state.waterHistory : [], {
        timezone,
        emptyText: derived && !derived.station
            ? 'No sensor selected, so there is no measured history to chart.'
            : 'Water temperature history will appear here.',
    });

    const gauge = derived?.level?.station ?? null;
    setText('levelChartTitle', gauge?.kind === 'lake' ? 'Lake level' : 'River level');
    charts.level.update(gauge ? state.levelHistory : [], {
        timezone,
        emptyText: derived && !gauge ? 'No level gauge nearby.' : 'Water level history will appear here.',
    });
}

/** "35.58° N · 80.92° W", printed over the place like the corner of a survey sheet. */
function coordinates({ lat, lon }) {
    return `${Math.abs(lat).toFixed(2)}° ${lat < 0 ? 'S' : 'N'} · ${Math.abs(lon).toFixed(2)}° ${lon < 0 ? 'W' : 'E'}`;
}

/** The place for a heading: none for the default city of a first visit, or a position with no name. */
const headings = () => sectionHeadings(state.location && !state.location.fallback ? addressPlace(state.location).name || null : null, aboutPlace());

/** What is known of the place beyond its name: whether it has a water-temperature sensor of its own (core/listed-places.js). */
const aboutPlace = () => ({ ownSensor: Boolean(state.location) && OWN_SENSOR.has(placePath(addressPlace(state.location))) });

// The home page's own description, kept so it can be put back (see renderSummary).
let homeDescription = null;

/**
 * The conditions in a sentence under the place's name, and as the page's description for
 * search results (core/summary.js). A first visit's default city keeps the site's own
 * description, as it keeps the site's title.
 */
function renderSummary(derived) {
    const location = state.location;
    const named = Boolean(location) && !location.fallback;
    const today = derived?.outlook.days[0] ?? null;
    const summary = today && conditionsSummary({
        name: named ? sharedName(location) : null,
        dateText: inTimezone({ weekday: 'long', month: 'long', day: 'numeric' }).format(derived.clock),
        score: today.result.score,
        band: today.result.band.label,
        bestHours: today.best ? hourRange(today.best.start, today.best.end) : null,
        flat: Boolean(today.best) && today.flat,
        waterTempF: derived.waterTempF,
        measured: Boolean(derived.station || derived.seaTemp),
        // A sensor of the place's own is its water however far the dot on the map is; any other is said to be nearby.
        sensorMiles: derived.station && !aboutPlace().ownSensor ? derived.station.distanceMi : null,
        trend: describeWaterTrend(derived.lures.trend)[0] ?? null,
    });
    setText('locationLede', summary ? summary.lede : '\u00a0');
    const meta = document.querySelector('meta[name="description"]');
    const wanted = named ? summary?.description ?? placeMeta(sharedName(location), aboutPlace()).description : homeDescription;
    if (meta && wanted && meta.getAttribute('content') !== wanted) meta.setAttribute('content', wanted);
}

function renderLocation() {
    setText('locationName', state.location?.name ?? 'Choose a location');
    setText('headerPlaceName', state.location?.name ?? '');
    setText('locationCoords', state.location ? coordinates(state.location) : '\u00a0');
    // The page's own title stays while a first visit shows the default city, so search engines
    // (which have no saved place) index the site for what it is, not for Chicago. A place's
    // title matches the one its page is served with (functions/fishing/[[path]].js).
    if (state.location && !state.location.fallback) document.title = placeMeta(state.location.name, aboutPlace()).title;
    setCanonical(state.location && !state.location.fallback ? placePath(addressPlace(state.location)) : '/');
    renderUpdatedAt();
    renderNearbyWater();
    renderRecents();
}

/** The state a town is in, from its name ("Asheville, North Carolina"), for naming its water. */
function stateOf(location) {
    const last = location.name?.split(',').pop().trim() ?? '';
    if (US_STATES[last.toUpperCase()]) return US_STATES[last.toUpperCase()];
    return Object.values(US_STATES).includes(last) ? last : '';
}

/** Show one of the nearby waters, fishing it the way its kind is fished. */
function chooseNearbyWater(place) {
    const mode = place.mode ?? 'fresh';
    if (state.mode !== mode) {
        state.mode = mode;
        storage.setMode(mode);
    }
    setLocation(place);
}

function renderNearbyWater() {
    const container = $('nearbyWater');
    const location = state.location;
    const groups = !location || location.kind ? [] : nearbyWater({
        lakes: state.nearbyLakes,
        rivers: riversFromStations(state.stations, location.lat, location.lon),
        salt: state.nearbySalt,
        state: stateOf(location),
    });
    container.hidden = groups.length === 0;
    const key = groups.flatMap((group) => group.places.map((place) => `${place.name}|${place.miles}`)).join(';');
    if (container.dataset.key === key) return;
    container.dataset.key = key;
    container.replaceChildren(
        el('span', { class: 'chips-label' }, 'Nearby water'),
        // Each kind keeps its own places, so small creeks never crowd out the lakes or the bay.
        ...groups.map((group) => el('span', { class: 'nearby-group', role: 'group', 'aria-label': group.label },
            el('span', { class: 'nearby-kind', 'aria-hidden': 'true' }, group.label),
            ...group.places.map((place) => el('a', {
                class: 'chip chip-water',
                href: placeHref(addressPlace(place), place.mode ? { mode: place.mode } : {}),
                title: [place.detail, `${place.miles} mi away`].filter(Boolean).join(' · '),
                onClick: (event) => {
                    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    chooseNearbyWater(place);
                },
            }, el('span', null, place.label), el('span', { class: 'chip-meta' }, `${place.miles} mi`))))),
    );
}

function renderUpdatedAt() {
    // "Updated 5 min ago" is shown; where the readings were taken is a tip beside it.
    let text = ' ';
    let detail = '';
    if (state.loading) text = state.weather ? 'Refreshing…' : 'Loading conditions…';
    else if (state.weather) {
        const { station, current } = state.weather;
        text = `Updated ${timeAgo(state.weather.fetchedAt)}`;
        if (station?.name) detail = `${text} · weather observed at ${station.name} ${timeAgo(current.time)}`;
        if (state.weather.pressureStation?.name) detail += `, pressure at ${state.weather.pressureStation.name}`;
    }
    const node = $('updatedAt');
    const key = `${text}|${detail}`;
    if (node.dataset.key !== key) {
        node.dataset.key = key;
        const wasOpen = node.querySelector('.tip.is-open') !== null;
        node.replaceChildren(text, detail ? tip('Where the readings come from', detail) : '');
        if (wasOpen) node.querySelector('.tip')?.classList.add('is-open');
    }
    $('refreshBtn').classList.toggle('is-busy', state.loading);
}

function renderRecents() {
    const container = $('recentLocations');
    const current = state.location ? locationKey(state.location) : null;
    const recents = storage.getRecents().filter((item) => locationKey(item) !== current);
    container.hidden = recents.length === 0;
    container.replaceChildren(
        el('span', { class: 'chips-label' }, 'Recent'),
        // Real links, so a recent place can be opened in a new tab or have its address copied.
        ...recents.map((item) => el('a', {
            class: 'chip',
            href: hrefFor(item),
            onClick: (event) => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                setLocation(item);
            },
        }, item.name)),
    );
}

function render() {
    const derived = derive();
    renderLocation();
    renderAlerts(derived);
    lastDerived = derived;
    renderSummary(derived);
    renderScoreCard(derived);
    renderModeGroup();
    renderSpeciesGroup();
    renderLures(derived);
    renderWhere(derived);
    renderForecast();
    renderStations(derived);
    renderLevel(derived);
    renderTides(derived);
    renderCharts(derived);
    syncAddress();
}

// ---------------------------------------------------------------------------
// Addresses: every place has its own (see core/place-url.js)
// ---------------------------------------------------------------------------

const MY_LOCATION = 'My location';

/** The place as it goes into an address. A position with no town name is shared by its coordinates alone. */
const addressPlace = (location) => (location.name === MY_LOCATION ? { ...location, name: '' } : location);

/** The name someone opening this place's address will see. */
const sharedName = (location) => addressPlace(location).name || coordinateName(location.lat, location.lon);

/** Same spot (to the address's precision) and same name: nothing to reload. */
const samePlace = (a, b) => Boolean(a && b) && Boolean(a.fallback) === Boolean(b.fallback)
    && locationKey(a) === locationKey(b) && slugify(addressPlace(a).name) === slugify(addressPlace(b).name);

/**
 * The address of a place. With `choices`, also the kind of water and the fish the score is
 * for, wherever there is a choice, so whoever opens it sees the same score.
 */
function hrefFor(location, { choices = false } = {}) {
    const extra = {};
    if (choices) {
        const { modes, mode } = modeChoice();
        if (modes.length > 1) extra.mode = mode;
        const { options, chosen } = speciesChoice();
        if (options.length > 1) extra.fish = chosen.id;
    }
    return placeHref(addressPlace(location), extra);
}

/**
 * Tell search engines whether the page has anything to index. By the time the weather
 * service says it has no data for a spot, the server has already answered 200, so the
 * page says it instead: a noindex added by script, which is what Google documents for
 * pages whose content arrives that way. Otherwise such a page reads as a "soft 404".
 */
function setIndexable(indexable) {
    const marker = document.querySelector('meta[name="robots"][data-no-coverage]');
    if (indexable) marker?.remove();
    else if (!marker) document.head.append(el('meta', { name: 'robots', content: 'noindex', 'data-no-coverage': '' }));
}

/** Point the canonical link and og:url at the page being shown, on the site's own domain. */
function setCanonical(path) {
    for (const [selector, attribute] of [['link[rel="canonical"]', 'href'], ['meta[property="og:url"]', 'content']]) {
        const node = document.querySelector(selector);
        const current = node?.getAttribute(attribute);
        if (!current) continue;
        const wanted = new URL(path, current).href;
        if (current !== wanted) node.setAttribute(attribute, wanted);
    }
}

/**
 * Keep the address bar on what is shown, so it can be copied, bookmarked or reloaded. The
 * choices are only known once the place has loaded (whether it is tidal, which fish live
 * there), so until then the address is left as it is. The #section stays.
 */
function syncAddress() {
    const location = state.location;
    if (!location || location.fallback || state.loading || !state.weather) return;
    const href = hrefFor(location, { choices: true }) + window.location.hash;
    if (href !== window.location.pathname + window.location.search + window.location.hash) {
        history.replaceState({ location }, '', href);
    }
}

/** Give a newly chosen place its own history entry, so Back returns to the one before. */
function pushAddress(location, previous) {
    const href = hrefFor(location);
    // The default city on a first visit is a placeholder, not somewhere to go back to.
    if (!previous || previous.fallback) {
        history.replaceState({ location }, '', href);
        return;
    }
    // Record what the entry being left showed: a #section link may have made it without a place.
    history.replaceState({ ...history.state, location: previous }, '');
    history.pushState({ location }, '', href);
}

/** Choices carried by an address apply to this visit; saved preferences are left as they are. */
function applyAddressChoices({ mode, freshFish, saltFish }) {
    if (mode) state.mode = mode;
    if (freshFish) state.speciesGroup = freshFish;
    if (saltFish) state.saltGroup = saltFish;
}

const isPlace = (value) => Boolean(value) && isNum(value.lat) && isNum(value.lon) && typeof value.name === 'string';

/**
 * The visitor's own copy of a linked place, if they have one (the same spot, shared under
 * the same name): it has the exact position, "My location" and the kind of water.
 */
function knownPlace(linked) {
    return [storage.getLocation(), ...storage.getRecents()]
        .find((item) => item && locationKey(item) === locationKey(linked.place) && sharedName(item) === linked.place.name) ?? null;
}

/**
 * The popular places (spots/index.html) are each known to be a lake or a river, which an
 * address alone cannot say. Someone arriving at one of them from that page or a search
 * engine gets the same gauges and score as someone who searched for it.
 */
function withListedKind(place) {
    if (place.kind) return place;
    const water = LISTED_WATER[placePath(place)];
    return water ? { ...place, kind: water } : place;
}

/** Back and Forward: show the place that history entry was showing. */
function onHistoryNavigation(event) {
    const linked = readPlaceUrl(window.location);
    applyAddressChoices(linked);
    const remembered = isPlace(event.state?.location) ? event.state.location : null;
    const place = remembered ?? (linked.place && withListedKind(linked.place)) ?? storage.getLocation() ?? { ...APP.DEFAULT_LOCATION, fallback: true };
    if (samePlace(place, state.location)) {
        render(); // only the #section, or a choice, changed
        return;
    }
    setLocation(place, { address: false });
}

let shareLabelTimer = null;

/** Share the place on screen: the system share sheet where there is one, otherwise copy the link. */
async function sharePlace() {
    const location = state.location;
    if (!location) return;
    const url = new URL(hrefFor(location, { choices: Boolean(state.weather) && !state.loading }), window.location.origin).href;
    const name = sharedName(location);
    const result = state.weather ? derive()?.result : null;
    const text = result
        ? `How's the bite at ${name}? ${result.score}/100 (${result.band.label.toLowerCase()}) right now.`
        : `How's the bite at ${name}?`;

    if (typeof navigator.share === 'function') {
        try {
            await navigator.share({ title: placeMeta(name).ogTitle, text, url });
            return;
        } catch (error) {
            if (error?.name === 'AbortError') return; // the sheet was closed
            // Anything else (no permission, nothing to share to): copy the link instead.
        }
    }
    try {
        await navigator.clipboard.writeText(url);
        setText('shareLabel', 'Link copied');
        clearTimeout(shareLabelTimer);
        shareLabelTimer = setTimeout(() => setText('shareLabel', 'Share'), 2500);
    } catch {
        showNotice(`Copy this link to share it: ${url}`, { tone: 'info' });
    }
}

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------

function showNotice(text, { tone = 'error', action = null, actionLabel = 'Try again' } = {}) {
    const notice = $('notice');
    notice.dataset.tone = tone;
    setText('noticeText', text);
    const button = $('noticeAction');
    button.hidden = !action;
    button.textContent = actionLabel;
    button.onclick = action;
    notice.hidden = false;
}

function hideNotice() {
    $('notice').hidden = true;
}

// ---------------------------------------------------------------------------
// Loading data
// ---------------------------------------------------------------------------

function describeUsgsError(error) {
    if (error instanceof HttpError && error.status === 429) return 'USGS is rate-limiting requests right now.';
    return 'USGS water data is unavailable right now.';
}

async function loadWater(location, signal) {
    const stations = await findStations(location.lat, location.lon, { signal });
    return { stations };
}

/**
 * 48-hour temperature and level series for the current stations. A series that
 * fails to load is left empty (its chart says so); only cancellation propagates.
 */
async function loadHistories(signal) {
    const orEmpty = (error) => {
        if (isAbort(error)) throw error;
        return [];
    };
    const station = selectedStation();
    const gauge = levelStation();
    const [waterHistory, levelHistory, flowNormals] = await Promise.all([
        station ? fetchWaterHistory(station, { signal }).catch(orEmpty) : [],
        gauge ? fetchLevelHistory(gauge, { signal }).catch(orEmpty) : [],
        loadFlowNormals(gauge, signal),
    ]);
    if (signal.aborted) throw new DOMException('Superseded', 'AbortError');
    state.waterHistory = waterHistory;
    state.levelHistory = levelHistory;
    state.flowNormals = flowNormals;
}

/** Today's date as the gauge's own calendar has it: 'MM-DD'. */
function monthDay() {
    const options = { year: 'numeric', month: '2-digit', day: '2-digit' };
    try {
        return new Intl.DateTimeFormat('en-CA', { ...options, timeZone: state.weather?.timezone }).format(Date.now()).slice(5);
    } catch {
        return new Intl.DateTimeFormat('en-CA', options).format(Date.now()).slice(5);
    }
}

/**
 * Normal flow for today's date at the river gauge in use. Optional: without it
 * the flow factor is simply left out of the score. Reused while the gauge and
 * the date stay the same, since the answer cannot change.
 */
async function loadFlowNormals(gauge, signal) {
    if (!flowApplies(gauge)) return null;
    const today = monthDay();
    const known = state.flowNormals;
    if (known?.percentiles && known.stationId === gauge.id && known.monthDay === today) return known;
    try {
        return { stationId: gauge.id, monthDay: today, percentiles: await fetchFlowNormals(gauge.id, today, { signal }) };
    } catch (error) {
        if (isAbort(error)) throw error;
        return null;
    }
}

/**
 * Where the last few weeks of water temperature come from for what is on screen: the
 * selected USGS sensor's daily means (and its normals for the date), the tide station
 * whose thermometer gives the reading, or the satellite cell off the coast. Null when
 * the water temperature is an estimate from air temperature, which has no useful history.
 * `key` changes with the source and the date, so a day-old trend is fetched again.
 */
function trendSource() {
    if (!state.location) return null;
    const { lat, lon } = state.location;
    const today = monthDay();
    const days = APP.WATER_TREND_DAYS;
    if (modeChoice().mode === 'fresh') {
        const station = selectedStation();
        if (!station) return null;
        return {
            key: `usgs:${station.id}:${today}`,
            source: 'sensor',
            load: async (signal) => {
                const [daily, normal] = await Promise.all([
                    fetchDailyWaterTemps(station, { signal, days }),
                    fetchTempNormals(station.id, today, { signal }).catch((error) => {
                        if (isAbort(error)) throw error;
                        return null; // normals are a bonus
                    }),
                ]);
                return { daily, normal };
            },
        };
    }
    const reading = state.coast?.waterTemp;
    if (reading?.kind === 'station') {
        return {
            key: `coops:${reading.stationId}:${today}`,
            source: 'tide-station',
            load: async (signal) => ({ daily: dailyMeans(await fetchCoastWaterTempHistory(reading.stationId, { signal, days })), normal: null }),
        };
    }
    if (!state.coast?.tidal) return null;
    return {
        key: `sst:${lat},${lon}:${today}`,
        source: 'satellite',
        load: async (signal) => ({ daily: (await fetchSeaSurfaceTemp(lat, lon, { signal, days }))?.daily ?? [], normal: null }),
    };
}

/** The water-temperature trend for what is on screen, once it has loaded. */
function currentWaterTrend(clock) {
    const known = state.waterTrend;
    if (!known?.daily?.length || known.key !== trendSource()?.key) return null;
    return summariseWaterTrend(known.daily, { source: known.source, normal: known.normal, now: clock });
}

/**
 * Load the water-temperature trend behind the lure picks. It is a refinement, so it runs after
 * the page has drawn and redraws when it lands; a failure is remembered for a while rather
 * than retried on every redraw.
 */
async function loadWaterTrend() {
    if (!state.weather) return;
    const wanted = trendSource();
    const known = state.waterTrend;
    if (!wanted) return;
    if (known?.key === wanted.key && !(known.failed && Date.now() - known.at > APP.STALE_AFTER_MS)) return;
    if (trendController?.key === wanted.key) return; // already on its way

    trendController?.abort();
    const controller = new AbortController();
    controller.key = wanted.key;
    trendController = controller;
    let result;
    try {
        result = { ...(await wanted.load(controller.signal)), failed: false };
    } catch (error) {
        if (isAbort(error)) return;
        result = { daily: [], normal: null, failed: true };
    } finally {
        if (trendController === controller) trendController = null;
    }
    if (controller.signal.aborted || trendSource()?.key !== wanted.key) return;
    state.waterTrend = { key: wanted.key, source: wanted.source, at: Date.now(), ...result };
    render();
    saveSnapshot();
}

const COAST_TEMP_MAX_MI = 30;

/**
 * Tides, water temperature and the beach forecast for a location, or { tidal: false }
 * away from tidal water. Every part is optional; whatever fails is simply left out.
 */
async function loadCoast(location, signal) {
    const { lat, lon } = location;
    const stations = await nearestCoastStations(lat, lon, { signal, tempWithinMi: COAST_TEMP_MAX_MI });
    if (!stations.tide.length) return { tidal: false };

    const quiet = (promise, fallback = null) => promise.catch((error) => {
        if (isAbort(error)) throw error;
        return fallback;
    });
    const hint = storage.getCoastHint(location);
    const tidesFrom = async () => {
        for (const station of stations.tide) {
            const tides = await quiet(fetchTides(station.id, { signal }), []);
            if (tides.length >= 2) return { tideStation: station, tides };
        }
        return { tideStation: stations.tide[0], tides: [] };
    };
    const temperatureFrom = async () => {
        for (const station of stations.temp) {
            const reading = await fetchCoastWaterTemp(station.id, { signal });
            if (reading) {
                return {
                    ...reading,
                    kind: 'station',
                    stationId: station.id,
                    source: `NOAA station ${prettyStation(station.name)}, ${station.distanceMi.toFixed(1)} mi away, read ${timeAgo(reading.time)}`,
                };
            }
        }
        return null;
    };
    // `undefined` = the beach service did not answer; fall back on what was learned last time.
    const [tideInfo, measured, beach] = await Promise.all([
        tidesFrom(), temperatureFrom(), quiet(fetchBeachForecast(lat, lon, { signal }), undefined),
    ]);
    if (signal.aborted) throw new DOMException('Superseded', 'AbortError');

    let waterTemp = measured;
    if (!waterTemp && isNum(beach?.waterTempF)) waterTemp = { tempF: beach.waterTempF, time: Date.now(), kind: 'beach', source: `NWS forecast for ${beachName(beach)}` };
    if (!waterTemp) {
        const satellite = await quiet(fetchSeaSurfaceTemp(lat, lon, { signal }));
        if (satellite) waterTemp = { ...satellite, kind: 'satellite', source: `satellite estimate from ${timeAgo(satellite.time)}` };
    }

    const surf = beach === undefined ? Boolean(hint?.surf) : beach !== null;
    if (beach !== undefined) storage.setCoastHint(location, { surf, gridUrl: hint?.gridUrl ?? null });
    return { tidal: true, surf, ...tideInfo, waterTemp, beach: beach ?? null, waves: null };
}

const prettyStation = (name) => name.replace(/\b([A-Z])([A-Z']+)\b/g, (_, first, rest) => first + rest.toLowerCase());
const beachName = (beach) => (/^n\/?a$/i.test(beach.beach) ? 'the local beaches' : beach.beach);

let wavesFor = null;

/**
 * The wave forecast off the beach, for surf fishing. Finding the right forecast cell takes
 * several requests the first time, so it runs after the page has drawn and redraws when it lands.
 */
async function loadWaves() {
    const location = state.location;
    const coast = state.coast;
    if (!coast?.surf || coast.waves || wavesFor === location || modeChoice().mode !== 'surf') return;
    wavesFor = location;
    try {
        const hint = storage.getCoastHint(location);
        const waves = await fetchWaveForecast(location.lat, location.lon, { knownGridUrl: hint?.gridUrl ?? null });
        if (state.location !== location || state.coast !== coast) return;
        coast.waves = waves ?? { gridUrl: null, periods: [] };
        if (waves) storage.setCoastHint(location, { surf: true, gridUrl: waves.gridUrl });
        render();
        saveSnapshot();
    } catch { /* optional: the surf factor is simply left out */ } finally {
        if (wavesFor === location) wavesFor = null;
    }
}

/**
 * Find out which sport fish are recorded around the location, unless that is already
 * known. Optional: on failure the choices fall back to a latitude-based assumption.
 */
/**
 * A town (or "my location") is a general area: offer the lakes and salt water around it
 * (its rivers come from the gauges), so a tap gives the score and gauges for that water.
 * Both lists are bundled with the site; either can be missing without harm.
 */
async function loadNearbyWater(location) {
    if (location.kind) return;
    const [lakes, tides] = await Promise.allSettled([loadLakeList(), loadStationList()]);
    if (state.location !== location) return;
    if (lakes.status === 'fulfilled') state.nearbyLakes = lakesNear(lakes.value, location.lat, location.lon);
    if (tides.status === 'fulfilled') state.nearbySalt = saltWaterNear(tides.value, location.lat, location.lon);
    renderNearbyWater();
}

async function loadSpeciesCounts(location, signal) {
    if (speciesCounts()) return;
    const key = speciesRegionKey(location.lat, location.lon);
    const counts = await fetchSpeciesCounts(location.lat, location.lon, { signal });
    storage.setSpeciesCounts(key, counts);
    if (state.location === location) state.speciesCounts = { key, counts };
}

async function load() {
    const location = state.location;
    if (!location) return;

    loadController?.abort();
    historyController?.abort();
    const controller = new AbortController();
    loadController = controller;
    const { signal } = controller;

    state.loading = true;
    renderUpdatedAt();
    loadNearbyWater(location); // from bundled lists, but never waited for

    const [weatherResult, waterResult, alertsResult] = await Promise.allSettled([
        fetchWeather(location.lat, location.lon, { signal }),
        loadWater(location, signal),
        fetchAlerts(location.lat, location.lon, { signal }),
        loadSpeciesCounts(location, signal),
        loadCoast(location, signal).then((coast) => {
            if (state.location === location && !signal.aborted) state.coast = coast;
        }),
    ]);
    if (signal.aborted) return; // a newer load() owns the screen now

    if (weatherResult.status === 'rejected') {
        loadController = null;
        state.loading = false;
        state.loadFailed = true;
        const offline = navigator.onLine === false;
        const stale = state.weather ? ` Showing conditions from ${timeAgo(state.weather.fetchedAt)}.` : '';
        let problem = "Couldn't load the weather.";
        if (offline) problem = "You're offline.";
        else if (weatherResult.reason instanceof OutsideCoverageError) {
            problem = 'Weather comes from the US National Weather Service, which has no data for this spot. Try a place in the United States.';
            setIndexable(false);
        }
        showNotice(problem + stale, { action: () => load() });
        render();
        return;
    }

    state.weather = weatherResult.value;
    state.loadFailed = false;
    state.alerts = alertsResult.status === 'fulfilled' ? alertsResult.value : []; // alerts are a bonus, never a blocker
    if (waterResult.status === 'fulfilled') {
        state.stations = waterResult.value.stations;
        state.stationsError = null;
    } else {
        state.stations = [];
        state.stationsError = describeUsgsError(waterResult.reason);
    }

    state.selectedStationId = pickStation(location)?.id ?? null;

    // Fetch the histories before the first paint so the score does not jump
    // when the trends arrive a moment later.
    try {
        await loadHistories(signal);
    } catch {
        return; // superseded by a newer load()
    }

    loadController = null;
    state.loading = false;
    if ($('notice').dataset.tone === 'error') hideNotice(); // keep informational notices
    render();
    saveSnapshot();
    loadWaves();
    loadWaterTrend();
    loadLake();
}

function saveSnapshot() {
    if (!state.weather) return;
    storage.setSnapshot({
        location: state.location,
        weather: state.weather,
        stations: state.stations,
        selectedStationId: state.selectedStationId,
        waterHistory: state.waterHistory,
        levelHistory: state.levelHistory,
        flowNormals: state.flowNormals,
        waterTrend: state.waterTrend?.failed ? null : state.waterTrend,
        alerts: state.alerts,
        coast: state.coast,
    });
}

function restoreSnapshot() {
    const snapshot = storage.getSnapshot(state.location);
    if (!snapshot) return false;
    state.weather = snapshot.weather;
    state.stations = Array.isArray(snapshot.stations) ? snapshot.stations : [];
    state.waterHistory = Array.isArray(snapshot.waterHistory) ? snapshot.waterHistory : [];
    state.levelHistory = Array.isArray(snapshot.levelHistory) ? snapshot.levelHistory : [];
    state.flowNormals = snapshot.flowNormals ?? null;
    state.waterTrend = Array.isArray(snapshot.waterTrend?.daily) ? snapshot.waterTrend : null;
    state.alerts = Array.isArray(snapshot.alerts) ? snapshot.alerts : [];
    state.coast = snapshot.coast ?? null;
    state.selectedStationId = pickStation(state.location)?.id ?? null;
    if (state.selectedStationId !== snapshot.selectedStationId) {
        state.waterHistory = [];
        state.levelHistory = [];
    }
    return true;
}

const isStale = () => !state.weather || Date.now() - state.weather.fetchedAt > APP.STALE_AFTER_MS;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Show a place. `address: false` when the address bar already shows it (Back and Forward);
 * otherwise it gets a new history entry.
 */
function setLocation(place, { address = true } = {}) {
    const previous = state.location;
    const location = { lat: roundCoord(place.lat), lon: roundCoord(place.lon), name: place.name };
    if (place.kind) location.kind = place.kind; // 'lake' or 'river' when a water body was searched for
    if (place.fallback) location.fallback = true; // the default city, when Back returns to a first visit
    state.location = location;
    state.weather = null;
    state.stations = [];
    state.stationsError = null;
    state.selectedStationId = null;
    state.scoreDay = 0;
    state.scoreFocus = null;
    state.waterHistory = [];
    state.levelHistory = [];
    state.flowNormals = null;
    state.waterTrend = null;
    state.alerts = [];
    state.nearbyLakes = [];
    state.nearbySalt = [];
    state.coast = null;
    state.loadFailed = false;
    if (!location.fallback) {
        storage.setLocation(location);
        storage.addRecent(location);
    }
    if (address) pushAddress(location, previous);
    hideNotice();
    setIndexable(true);
    render();
    load();
}

/** Switch the water temperature source and reload the temperature and level histories. */
async function selectStation(stationId, { remember = true, force = false } = {}) {
    if (stationId === state.selectedStationId && !force) return;
    historyController?.abort();
    const controller = new AbortController();
    historyController = controller;

    state.selectedStationId = stationId;
    state.waterHistory = [];
    state.levelHistory = [];
    if (remember) storage.setPreferredStation(state.location, stationId);
    render();

    try {
        await loadHistories(controller.signal);
    } catch {
        return; // superseded by another selection or a full reload
    }
    render();
    saveSnapshot();
    loadWaterTrend();
}

function setSpeciesGroup(group) {
    if (!(group in SPECIES_GROUPS)) return;
    if (modeChoice().mode === 'fresh') {
        if (group === state.speciesGroup) return;
        state.speciesGroup = group;
        storage.setSpeciesGroup(group);
    } else {
        if (group === state.saltGroup) return;
        state.saltGroup = group;
        storage.setSaltGroup(group);
    }
    render();
}

function setMode(mode) {
    if (mode === state.mode || !(mode in MODE_LABELS)) return;
    state.mode = mode;
    storage.setMode(mode);
    render();
    loadWaves();
    loadWaterTrend();
    loadLake();
}

function setWaterFilter(filter) {
    if (filter === state.waterFilter) return;
    state.waterFilter = filter;
    storage.setWaterFilter(filter);
    // Keep the current station if it survives the filter, otherwise take the best match.
    // Histories are reloaded either way because the level gauge can change with the filter.
    const next = selectedStation() ?? pickStation(state.location);
    selectStation(next?.id ?? null, { remember: false, force: true });
}

const GEO_ERRORS = {
    1: 'Location access was denied. Allow it in your browser settings, or search for a place instead.',
    2: "Your location couldn't be determined. Try again, or search for a place instead.",
    3: 'Finding your location took too long. Try again, or search for a place instead.',
};

async function useMyLocation() {
    if (!('geolocation' in navigator)) {
        showNotice("This browser can't share your location. Search for a place instead.");
        return;
    }
    const button = $('locateBtn');
    const label = button.querySelector('span');
    button.disabled = true;
    label.textContent = 'Locating…';
    try {
        const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 15000, maximumAge: 5 * 60 * 1000 });
        });
        const lat = roundCoord(position.coords.latitude);
        const lon = roundCoord(position.coords.longitude);
        const name = await reverseGeocode(lat, lon).catch(() => null);
        setLocation({ lat, lon, name: name ?? MY_LOCATION });
    } catch (error) {
        showNotice(GEO_ERRORS[error?.code] ?? GEO_ERRORS[2]);
    } finally {
        button.disabled = false;
        label.textContent = 'Use my location';
    }
}

// ---------------------------------------------------------------------------
// The place in the header
// ---------------------------------------------------------------------------

/**
 * Once the place's heading scrolls up under the header, the header shows the place and its
 * score instead of the site's name, so it is always clear what the page is about. Clicking
 * it goes back to the top.
 */
function initHeaderPlace() {
    const header = document.querySelector('.app-header');
    const place = $('headerPlace');
    const show = (on) => {
        header.classList.toggle('is-scrolled', on);
        place.tabIndex = on ? 0 : -1;
        place.toggleAttribute('aria-hidden', !on);
    };
    place.addEventListener('click', (event) => {
        event.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    if (!('IntersectionObserver' in window)) return;
    new IntersectionObserver(([entry]) => {
        show(!entry.isIntersecting && entry.boundingClientRect.top < header.offsetHeight);
    }, { rootMargin: `-${header.offsetHeight}px 0px 0px 0px` }).observe($('locationName'));
}

// ---------------------------------------------------------------------------
// Search (combobox with a results listbox)
// ---------------------------------------------------------------------------

function initSearch() {
    const form = $('searchForm');
    const input = $('searchInput');
    const list = $('searchResults');
    let results = [];
    let activeIndex = -1;
    let controller = null;

    const close = () => {
        list.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        activeIndex = -1;
    };

    const open = (children) => {
        list.replaceChildren(...children);
        list.hidden = false;
        input.setAttribute('aria-expanded', 'true');
    };

    const message = (text) => open([el('li', { class: 'search-message', role: 'presentation' }, text)]);

    const setActive = (index) => {
        activeIndex = index;
        list.querySelectorAll('[role="option"]').forEach((option, i) => {
            option.setAttribute('aria-selected', String(i === index));
            if (i === index) {
                input.setAttribute('aria-activedescendant', option.id);
                option.scrollIntoView({ block: 'nearest' });
            }
        });
    };

    const choose = (place) => {
        input.value = '';
        results = [];
        close();
        input.blur();
        setLocation(place);
    };

    /** With nothing typed, the box offers the places looked at lately. */
    const showRecents = () => {
        const current = state.location ? locationKey(state.location) : null;
        const recents = storage.getRecents().filter((item) => locationKey(item) !== current);
        results = recents;
        activeIndex = -1;
        if (!recents.length) {
            close();
            return;
        }
        open([
            el('li', { class: 'search-heading', role: 'presentation' }, 'Recent places'),
            ...recents.map((place, index) => el('li', {
                id: `search-option-${index}`,
                class: 'search-option',
                role: 'option',
                'aria-selected': 'false',
                onMousedown: (event) => {
                    event.preventDefault();
                    choose(place);
                },
            }, el('span', null, place.name), place.kind ? el('span', { class: 'muted' }, place.kind === 'lake' ? 'Lake' : place.kind === 'river' ? 'River' : '') : null)),
        ]);
    };

    async function search(query) {
        controller?.abort();
        controller = new AbortController();
        const { signal } = controller;
        try {
            const found = await searchPlaces(query, { signal });
            if (signal.aborted) return null;
            results = found;
            activeIndex = -1;
            if (found.length === 0) {
                message(`No US places match “${query}”. Try a nearby town.`);
            } else {
                open(found.map((place, index) => el('li', {
                    id: `search-option-${index}`,
                    class: 'search-option',
                    role: 'option',
                    'aria-selected': 'false',
                    // mousedown, not click: keep focus in the input so blur doesn't close the list first
                    onMousedown: (event) => {
                        event.preventDefault();
                        choose(place);
                    },
                }, el('span', null, place.name), place.detail ? el('span', { class: 'muted' }, place.detail) : null)));
            }
            return found;
        } catch (error) {
            if (!isAbort(error)) message('Search is unavailable right now. Check your connection and try again.');
            return null;
        }
    }

    const searchSoon = debounce((query) => search(query), APP.SEARCH_DEBOUNCE_MS);

    input.addEventListener('input', () => {
        const query = input.value.trim();
        if (query.length < APP.SEARCH_MIN_CHARS) {
            controller?.abort();
            results = [];
            if (query) close();
            else showRecents();
            return;
        }
        searchSoon(query);
    });

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            close();
        } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !input.value.trim() && list.hidden) {
            event.preventDefault();
            showRecents();
        } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && results.length && !list.hidden) {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setActive((activeIndex + step + results.length) % results.length);
        }
    });

    input.addEventListener('focus', () => {
        if (!input.value.trim()) showRecents();
        else if (results.length && input.value.trim().length >= APP.SEARCH_MIN_CHARS) {
            list.hidden = false;
            input.setAttribute('aria-expanded', 'true');
        }
    });
    input.addEventListener('blur', close);

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const query = input.value.trim();
        if (!query && activeIndex >= 0 && results[activeIndex]) { // a recent place, picked with the arrow keys
            choose(results[activeIndex]);
            return;
        }
        if (query.length < APP.SEARCH_MIN_CHARS) return;
        if (activeIndex >= 0 && results[activeIndex]) {
            choose(results[activeIndex]);
            return;
        }
        // Enter picks the best match, running the search first if the debounce hasn't fired yet.
        const found = await search(query);
        if (found?.length) choose(found[0]);
    });
}

// ---------------------------------------------------------------------------
// Section navigation, install prompt, service worker
// ---------------------------------------------------------------------------

function initSectionNav() {
    const links = [...document.querySelectorAll('.bottom-nav a')];
    const byId = new Map(links.map((link) => [link.getAttribute('href').slice(1), link]));
    const visibleRatio = new Map();

    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) visibleRatio.set(entry.target.id, entry.isIntersecting ? entry.intersectionRect.height : 0);
        let best = null;
        for (const [id, height] of visibleRatio) {
            if (height > 0 && (!best || height > visibleRatio.get(best))) best = id;
        }
        if (!best) return;
        for (const [id, link] of byId) {
            if (id === best) link.setAttribute('aria-current', 'true');
            else link.removeAttribute('aria-current');
        }
    }, { rootMargin: '-80px 0px -80px 0px', threshold: [0, 0.25, 0.5, 0.75, 1] });

    for (const id of byId.keys()) observer.observe($(id));
}

/**
 * Honour #forecast-style links (and the old ?section= shortcuts) once content has a height.
 * `id` is read at start-up, before the address bar is moved to the place's own address.
 */
function scrollToRequestedSection(id) {
    const target = id && ['forecast', 'water', 'history'].includes(id === 'map' ? 'water' : id) ? $(id === 'map' ? 'water' : id) : null;
    target?.scrollIntoView();
}

function initInstallPrompt() {
    const banner = $('installBanner');
    let promptEvent = null;

    window.addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault();
        promptEvent = event;
        const { dismissals, lastDismissed } = storage.getInstallPrompt();
        const coolingDown = Date.now() - lastDismissed < APP.INSTALL_PROMPT_COOLDOWN_MS;
        if (dismissals < APP.INSTALL_PROMPT_MAX_DISMISSALS && !coolingDown) banner.hidden = false;
    });

    $('installBtn').addEventListener('click', async () => {
        banner.hidden = true;
        if (!promptEvent) return;
        promptEvent.prompt();
        await promptEvent.userChoice.catch(() => null);
        promptEvent = null;
    });

    $('installDismiss').addEventListener('click', () => {
        banner.hidden = true;
        const { dismissals } = storage.getInstallPrompt();
        storage.setInstallPrompt({ dismissals: dismissals + 1, lastDismissed: Date.now() });
    });

    window.addEventListener('appinstalled', () => {
        banner.hidden = true;
        promptEvent = null;
    });
}

function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    // A new version of the service worker takes over as soon as it is installed, but this
    // page would go on running the scripts it loaded earlier: an open tab, or the installed
    // app, can otherwise sit on an old version for days. So when control changes hands,
    // reload once. (Not on the very first install, when there is no older version to replace.)
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || reloading) return;
        reloading = true;
        window.location.reload();
    });

    window.addEventListener('load', async () => {
        try {
            const registration = await navigator.serviceWorker.register('sw.js');
            // Browsers only look for a new version on a page load, so also look whenever
            // the app comes back into view.
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') registration.update().catch(() => { /* offline */ });
            });
        } catch { /* offline support is optional */ }
    });
}

// ---------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------

async function offerLocalConditions() {
    // First visit: we are showing the default city, and say so straight away (index.html
    // already shows this notice, so it does not move the page). If the browser already has
    // permission, switch to the user's position; otherwise never prompt unasked.
    showNotice(`Showing ${APP.DEFAULT_LOCATION.name}. Search for a place or tap “Use my location” for conditions near you.`,
        { tone: 'info', action: useMyLocation, actionLabel: 'Use my location' });
    try {
        const status = await navigator.permissions?.query({ name: 'geolocation' });
        if (status?.state === 'granted') useMyLocation();
    } catch { /* Permissions API unavailable */ }
}

function init() {
    // Each visit presses the stamp from a different part of the ink texture (styles.css, .score-stamp).
    document.documentElement.style.setProperty('--ink-at', `${Math.round(Math.random() * 100)}% ${Math.round(Math.random() * 100)}%`);
    initTheme();
    initTips();
    initSearch();
    initHeaderPlace();
    initDetailsToggle();
    initScoreDays();
    initSectionNav();
    initInstallPrompt();
    registerServiceWorker();

    const degrees = (value) => `${value.toFixed(1)}°F`;
    const wholeDegrees = (value) => `${Math.round(value)}°`;
    charts = {
        pressure: createLineChart($('pressureChart'), {
            label: 'Barometric pressure', format: (v) => `${v.toFixed(2)} inHg`, formatTick: (v) => v.toFixed(2), minRange: 0.2,
        }),
        air: createLineChart($('airChart'), { label: 'Air temperature', format: degrees, formatTick: wholeDegrees, minRange: 8 }),
        water: createLineChart($('waterChart'), { label: 'Water temperature', format: degrees, formatTick: wholeDegrees, minRange: 4 }),
        level: createLineChart($('levelChart'), {
            label: 'Water level', format: (v) => `${v.toFixed(2)} ft`, formatTick: (v) => v.toFixed(2), minRange: 0.4,
        }),
    };
    stationMap = createStationMap($('stationMap'), { onSelect: (id) => selectStation(id) });
    lakeMap = createLakeMap($('whereMap'));

    $('locateBtn').addEventListener('click', useMyLocation);
    $('refreshBtn').addEventListener('click', () => load());
    $('shareBtn').addEventListener('click', sharePlace);
    window.addEventListener('popstate', onHistoryNavigation);
    $('waterFilter').addEventListener('click', (event) => {
        const filter = event.target.closest('button')?.dataset.filter;
        if (filter) setWaterFilter(filter);
    });
    $('modeGroup').addEventListener('click', (event) => {
        const mode = event.target.closest('button')?.dataset.mode;
        if (mode) setMode(mode);
    });
    $('speciesGroup').addEventListener('click', (event) => {
        const group = event.target.closest('button')?.dataset.group;
        if (group) setSpeciesGroup(group);
    });

    // A place in the address (a shared link, a bookmark, a reload) wins over the saved one.
    const section = window.location.hash.slice(1) || new URLSearchParams(window.location.search).get('section');
    const linked = readPlaceUrl(window.location);
    if (!linked.place) homeDescription = document.querySelector('meta[name="description"]')?.getAttribute('content') ?? null;
    applyAddressChoices(linked);
    const saved = storage.getLocation();
    if (linked.place) {
        state.location = knownPlace(linked) ?? withListedKind(linked.place);
        storage.setLocation(state.location);
        storage.addRecent(state.location);
    } else {
        state.location = saved ?? { ...APP.DEFAULT_LOCATION, fallback: true };
        // Not a place after all (only possible where no server checks addresses first).
        if (linked.invalid) history.replaceState(null, '', `/${window.location.hash}`);
    }
    history.replaceState({ ...history.state, location: state.location }, '');

    const restored = restoreSnapshot();
    render();
    if (restored) scrollToRequestedSection(section);

    const firstLoad = isStale() ? load() : Promise.resolve();
    firstLoad.then(() => {
        if (!restored) scrollToRequestedSection(section);
    });
    // Someone who followed a link came to see that place: no hint, and no switching to where they are.
    if (!saved && !linked.place) offerLocalConditions();
    delete document.documentElement.dataset.firstVisit; // the notice is the app's now (js/theme-init.js)

    // Keep things fresh while the app stays open, and when it comes back to the foreground.
    const refreshIfStale = () => {
        if (document.visibilityState === 'visible' && !state.loading && isStale()) load();
    };
    document.addEventListener('visibilitychange', refreshIfStale);
    window.addEventListener('online', refreshIfStale);
    setInterval(() => {
        renderUpdatedAt();
        refreshIfStale();
    }, 60 * 1000);
}

init();

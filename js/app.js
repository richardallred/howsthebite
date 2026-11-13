// How's the Bite? — application entry point.
//
// State lives in one object; `render()` redraws the page from it. Network
// results are applied only if they belong to the most recent request, so
// switching locations quickly can never show data for the wrong place.

import { fetchFlowNormals, fetchLevelHistory, fetchWaterHistory, findStations } from './api/usgs-api.js';
import { HttpError, isAbort } from './api/http.js';
import { OutsideCoverageError, fetchAlerts, fetchWeather, reverseGeocode, searchPlaces } from './api/weather-api.js';
import { APP } from './config.js';
import { summariseAlerts } from './core/alerts.js';
import { moonInfo } from './core/moon.js';
import { SPECIES_GROUPS, bestWindows, estimateWaterTemp, scoreConditions } from './core/scoring.js';
import { sunTimes } from './core/sun.js';
import { changeOver, classifyTrend, lastHours } from './core/trend.js';
import { debounce, distanceMiles, isNum, roundCoord, timeAgo } from './core/util.js';
import { compassPoint } from './core/sky.js';
import { locationKey, storage } from './storage.js';
import { createLineChart } from './ui/charts.js';
import { $, el, icon, setText } from './ui/dom.js';
import { createStationMap } from './ui/map.js';
import { initTheme } from './ui/theme.js';

const state = {
    location: null,
    weather: null,
    stations: [],
    stationsError: null,
    selectedStationId: null,
    waterHistory: [],
    levelHistory: [],
    waterFilter: storage.getWaterFilter(),
    speciesGroup: storage.getSpeciesGroup(),
    alerts: [],
    flowNormals: null, // { stationId, monthDay, percentiles } for the river gauge in use
    loading: false,
    loadFailed: false,
};

let loadController = null;
let historyController = null;
let charts = null;
let stationMap = null;

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

/** Flow counts toward the score only on moving water whose gauge has a long enough record. */
const flowApplies = (gauge) => Boolean(gauge?.flow) && gauge.kind === 'river' && state.location?.kind !== 'lake';

function flowInput(gauge) {
    if (!flowApplies(gauge)) return null;
    const normals = state.flowNormals;
    if (normals?.stationId !== gauge.id || !normals.percentiles) return null;
    return { cfs: gauge.flow.cfs, percentiles: normals.percentiles };
}

/** Forecast sky and wind for a time ahead; null for the next hour, where the observation is better. */
function forecastAt(time, from) {
    if (time - from < 60 * 60 * 1000) return null;
    const period = (state.weather?.outlook ?? []).find((p) => p.start <= time && time < p.end);
    if (!period) return null;
    return isNum(period.windMph) ? { sky: period.sky, windMph: period.windMph } : { sky: period.sky };
}

function derive() {
    const { weather } = state;
    if (!weather) return null;
    const { current, hourly } = weather;
    const now = current.time;
    const clock = Date.now(); // light and moon follow the clock, not the age of the weather report

    const pressure = observed(hourly.pressure, now, current.pressureInHg);
    const air = observed(hourly.temp, now, current.tempF);
    const station = selectedStation();
    const waterTempF = station
        ? station.tempF
        : estimateWaterTemp(lastHours(hourly.temp, 72, now).map((point) => point.v), current.tempF);

    const gauge = levelStation();
    const alerts = summariseAlerts(state.alerts, clock);
    const inputs = {
        lat: state.location.lat,
        lon: state.location.lon,
        speciesGroup: state.speciesGroup,
        waterTempF,
        waterEstimated: !station,
        waterChange24h: station ? changeOver(state.waterHistory, APP.TEMP_TREND_HOURS) : null,
        oxygenMgL: (station?.oxygen ?? gauge?.oxygen)?.mgL ?? null,
        pressureInHg: current.pressureInHg,
        pressureChange3h: changeOver(pressure, APP.PRESSURE_TREND_HOURS),
        windMph: current.windMph,
        gustMph: current.gustMph,
        sky: current.sky.class,
        flow: flowInput(gauge),
        hazard: alerts.hazard,
    };
    const result = scoreConditions({ ...inputs, date: new Date(clock) });
    const windows = bestWindows(inputs, {
        start: clock,
        hours: APP.OUTLOOK_HOURS,
        at: (time) => forecastAt(time, clock),
    });

    const level = gauge && {
        station: gauge,
        trend: classifyTrend(
            changeOver(state.levelHistory, APP.TEMP_TREND_HOURS),
            gauge.kind === 'lake' ? { steadyBelow: 0.03, rapidAbove: 0.25 } : { steadyBelow: 0.05, rapidAbove: 0.5 },
        ),
    };

    return { result, windows, alerts, clock, pressure, air, station, waterTempF, level };
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

function factorDisplay(factor, derived) {
    const { current } = state.weather;
    switch (factor.id) {
        case 'water':
            return {
                label: 'Water temperature',
                iconName: 'droplet',
                value: `${derived.station ? '' : '≈ '}${derived.waterTempF.toFixed(1)}°F`,
                extra: factor.trend,
            };
        case 'light':
            return {
                label: 'Light',
                iconName: 'sun',
                value: LIGHT_LABELS[factor.phase] ?? current.sky.label,
                extra: nextSunEvent(derived.clock),
            };
        case 'wind':
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
                extra: factor.trend,
            };
        case 'pressure':
            return {
                label: 'Barometric pressure',
                iconName: 'gauge',
                value: isNum(current.pressureInHg) ? `${current.pressureInHg.toFixed(2)} inHg` : '—',
                extra: factor.trend,
            };
        default: {
            const moon = moonInfo(new Date(derived.clock));
            return { label: 'Moon', iconName: 'moon', value: `${moon.icon} ${moon.name}`, extra: factor.trend };
        }
    }
}

/** ["now–9:20 PM", "Tue 4:40–7:00 AM"] */
function describeWindows(windows, clock) {
    const dayKey = (time) => clockTime(time, { withDay: true }).split(' ')[0];
    const today = dayKey(clock);
    return windows.slice(0, 2).map((window) => {
        if (window.start <= clock) return `now–${clockTime(window.end)}`;
        const day = dayKey(window.start);
        // "4:40–7:00 AM" when both ends share AM/PM, otherwise both in full.
        const [from, fromHalf] = clockTime(window.start).split(/\s/);
        const end = clockTime(window.end);
        const range = end.endsWith(fromHalf) ? `${from}–${end}` : `${from} ${fromHalf}–${end}`;
        return day === today ? range : `${day} ${range}`;
    });
}

function renderScore(derived) {
    const card = $('scoreCard');
    if (!derived) {
        card.dataset.band = 'loading';
        setText('scoreValue', '–');
        setText('scoreBand', ' ');
        setText('scorePhrase', state.loadFailed ? 'Conditions unavailable' : 'Checking conditions…');
        setText('scoreNow', '');
        setText('scoreCap', '');
        setText('scoreBest', '');
        return;
    }
    const { result } = derived;
    const { current } = state.weather;
    card.dataset.band = result.band.key;
    setText('scoreValue', String(result.score));
    setText('scoreBand', result.band.label);
    setText('scorePhrase', result.phrase);
    const feelsLike = isNum(current.feelsLikeF) ? ` · feels like ${Math.round(current.feelsLikeF)}°F` : '';
    setText('scoreNow', `${current.sky.emoji} ${current.sky.label} · ${Math.round(current.tempF)}°F${feelsLike}`);
    setText('scoreCap', result.cap ? result.cap.reason : '');
    // Each window is kept on one line; the list wraps between windows on a narrow card.
    const best = describeWindows(derived.windows, derived.clock);
    $('scoreBest').replaceChildren(...(best.length ? ['Best times: '] : []),
        ...best.flatMap((text, index) => [index ? ' · ' : '', el('span', { class: 'nowrap' }, text)]));
}

function renderSpeciesGroup() {
    for (const button of $('speciesGroup').querySelectorAll('button')) {
        button.setAttribute('aria-pressed', String(button.dataset.group === state.speciesGroup));
    }
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

function renderFactors(derived) {
    const container = $('factors');
    if (!derived) {
        container.replaceChildren(...Array.from({ length: 6 }, () => el('div', { class: 'factor is-placeholder', 'aria-hidden': 'true' })));
        return;
    }
    container.replaceChildren(...derived.result.factors.map((factor) => {
        const display = factorDisplay(factor, derived);
        const rating = RATING_LABELS[factor.rating];
        return el('article', { class: 'factor', dataset: { rating: factor.rating } },
            el('h3', { class: 'factor-label' }, icon(display.iconName), display.label),
            el('p', { class: 'factor-value' }, display.value),
            el('p', { class: 'factor-note' }, factor.note),
            el('p', { class: 'factor-extra' }, display.extra ?? ' '),
            el('div', { class: 'factor-foot' },
                el('div', { class: 'meter', 'aria-hidden': 'true' },
                    el('span', { style: `width:${Math.round((factor.points / factor.max) * 100)}%` })),
                el('p', { class: 'factor-points' },
                    el('strong', null, String(factor.points)), `/${factor.max}`,
                    el('span', { class: 'rating-tag' }, rating))));
    }));
}

function renderForecast() {
    const list = $('forecastList');
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
    list.replaceChildren(...days.map((day) => {
        const isToday = dayKey.format(day.t) === today;
        return el('li', { class: 'forecast-day' },
            el('p', { class: 'forecast-name' }, isToday ? 'Today' : dayName.format(day.t),
                el('span', { class: 'muted' }, dayDate.format(day.t))),
            el('p', { class: 'forecast-icon', 'aria-hidden': 'true' }, day.icon),
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
    setText('waterSummary', waterSummary(station));

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

function renderLocation() {
    setText('locationName', state.location?.name ?? 'Choose a location');
    document.title = state.location ? `${state.location.name} — How's the Bite?` : "How's the Bite?";
    renderUpdatedAt();
    renderRecents();
}

function renderUpdatedAt() {
    let text = ' ';
    if (state.loading) text = state.weather ? 'Refreshing…' : 'Loading conditions…';
    else if (state.weather) {
        const { station, current } = state.weather;
        text = `Updated ${timeAgo(state.weather.fetchedAt)}`;
        if (station?.name) text += ` · weather observed at ${station.name} ${timeAgo(current.time)}`;
        if (state.weather.pressureStation?.name) text += `, pressure at ${state.weather.pressureStation.name}`;
    }
    setText('updatedAt', text);
    $('refreshBtn').classList.toggle('is-busy', state.loading);
}

function renderRecents() {
    const container = $('recentLocations');
    const current = state.location ? locationKey(state.location) : null;
    const recents = storage.getRecents().filter((item) => locationKey(item) !== current);
    container.hidden = recents.length === 0;
    container.replaceChildren(
        el('span', { class: 'chips-label' }, 'Recent'),
        ...recents.map((item) => el('button', {
            class: 'chip',
            type: 'button',
            onClick: () => setLocation(item),
        }, item.name)),
    );
}

function render() {
    const derived = derive();
    renderLocation();
    renderAlerts(derived);
    renderScore(derived);
    renderSpeciesGroup();
    renderFactors(derived);
    renderForecast();
    renderStations(derived);
    renderLevel(derived);
    renderCharts(derived);
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

    const [weatherResult, waterResult, alertsResult] = await Promise.allSettled([
        fetchWeather(location.lat, location.lon, { signal }),
        loadWater(location, signal),
        fetchAlerts(location.lat, location.lon, { signal }),
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
        alerts: state.alerts,
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
    state.alerts = Array.isArray(snapshot.alerts) ? snapshot.alerts : [];
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

function setLocation(place) {
    const location = { lat: roundCoord(place.lat), lon: roundCoord(place.lon), name: place.name };
    if (place.kind) location.kind = place.kind; // 'lake' or 'river' when a water body was searched for
    state.location = location;
    state.weather = null;
    state.stations = [];
    state.stationsError = null;
    state.selectedStationId = null;
    state.waterHistory = [];
    state.levelHistory = [];
    state.flowNormals = null;
    state.alerts = [];
    state.loadFailed = false;
    storage.setLocation(location);
    storage.addRecent(location);
    hideNotice();
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
}

function setSpeciesGroup(group) {
    if (group === state.speciesGroup || !(group in SPECIES_GROUPS)) return;
    state.speciesGroup = group;
    storage.setSpeciesGroup(group);
    render();
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
        setLocation({ lat, lon, name: name ?? 'My location' });
    } catch (error) {
        showNotice(GEO_ERRORS[error?.code] ?? GEO_ERRORS[2]);
    } finally {
        button.disabled = false;
        label.textContent = 'Use my location';
    }
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
            close();
            return;
        }
        searchSoon(query);
    });

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            close();
        } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && results.length && !list.hidden) {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setActive((activeIndex + step + results.length) % results.length);
        }
    });

    input.addEventListener('focus', () => {
        if (results.length && input.value.trim().length >= APP.SEARCH_MIN_CHARS) {
            list.hidden = false;
            input.setAttribute('aria-expanded', 'true');
        }
    });
    input.addEventListener('blur', close);

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const query = input.value.trim();
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

/** Honour #forecast-style links (and the old ?section= shortcuts) once content has a height. */
function scrollToRequestedSection() {
    const id = window.location.hash.slice(1) || new URLSearchParams(window.location.search).get('section');
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
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
    });
}

// ---------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------

async function offerLocalConditions() {
    // First visit: we are showing the default city. If the browser already has
    // permission, switch to the user's position; otherwise never prompt unasked.
    try {
        const status = await navigator.permissions?.query({ name: 'geolocation' });
        if (status?.state === 'granted') {
            useMyLocation();
            return;
        }
    } catch { /* Permissions API unavailable */ }
    showNotice(`Showing ${APP.DEFAULT_LOCATION.name}. Search for a place or tap “Use my location” for conditions near you.`,
        { tone: 'info', action: useMyLocation, actionLabel: 'Use my location' });
}

function init() {
    initTheme();
    initSearch();
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

    $('locateBtn').addEventListener('click', useMyLocation);
    $('refreshBtn').addEventListener('click', () => load());
    $('waterFilter').addEventListener('click', (event) => {
        const filter = event.target.closest('button')?.dataset.filter;
        if (filter) setWaterFilter(filter);
    });
    $('speciesGroup').addEventListener('click', (event) => {
        const group = event.target.closest('button')?.dataset.group;
        if (group) setSpeciesGroup(group);
    });

    const saved = storage.getLocation();
    state.location = saved ?? { ...APP.DEFAULT_LOCATION };

    const restored = restoreSnapshot();
    render();
    if (restored) scrollToRequestedSection();

    const firstLoad = isStale() ? load() : Promise.resolve();
    firstLoad.then(() => {
        if (!restored) scrollToRequestedSection();
    });
    if (!saved) offerLocalConditions();

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

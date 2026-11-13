import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    FACTOR_MAX, HAZARD_CAP, SPECIES_GROUPS, bandFor, bestWindows, bitePhrase, estimateWaterTemp, flowPercentile,
    scoreConditions, scoreFlow, scoreLight, scoreMoon, scorePressure, scoreSeries, scoreWaterTemp, scoreWind,
} from '../js/core/scoring.js';

const HOUR = 3600_000;
const CHICAGO = { lat: 41.8781, lon: -87.6298 };
// 15 June 2026 in Chicago (CDT = UTC−5): sunrise 5:16 AM, sunset 8:28 PM, new moon.
const local = (hour, minute = 0) => new Date(Date.UTC(2026, 5, 15, hour + 5, minute));
const FULL_MOON = new Date(Date.UTC(2000, 0, 21, 4, 40));
const NORMALS = { 5: 300, 10: 450, 25: 800, 50: 1250, 75: 2100, 90: 3300, 95: 4400 };

const ideal = {
    ...CHICAGO,
    waterTempF: 68,
    pressureInHg: 30.1,
    pressureChange3h: -0.04,
    windMph: 10,
    sky: 'clear',
    flow: { cfs: 1250, percentiles: NORMALS },
    date: local(20), // half an hour before sunset
};
const points = (result, id) => result.factors.find((factor) => factor.id === id)?.points;

test('factor maximums add up to 100', () => {
    assert.equal(Object.values(FACTOR_MAX).reduce((a, b) => a + b, 0), 100);
});

test('ideal conditions at dusk score in the top band; awful ones score at the bottom', () => {
    const best = scoreConditions(ideal);
    assert.ok(best.score >= 95, `expected >= 95, got ${best.score}`);
    assert.equal(best.band.key, 'exceptional');
    assert.equal(best.cap, null);

    const awful = scoreConditions({
        ...CHICAGO, waterTempF: 33, pressureInHg: 30.9, pressureChange3h: 0.1, windMph: 35, sky: 'precip',
        date: new Date(Date.UTC(2026, 0, 15, 18)),
    });
    assert.ok(awful.score <= 12, `expected <= 12, got ${awful.score}`);
});

test('no factor exceeds its maximum or drops below zero', () => {
    const inRange = (result, max) => assert.ok(result.points >= 0 && result.points <= max && result.share >= 0 && result.share <= 1);
    for (const group of Object.keys(SPECIES_GROUPS)) {
        for (const t of [-20, 33, 45, 58, 66, 70, 80, 92, 110]) {
            for (const oxygenMgL of [null, 0.5, 4.5, 9]) {
                inRange(scoreWaterTemp(t, { group, oxygenMgL }), FACTOR_MAX.water);
                inRange(scoreWaterTemp(t, { group, oxygenMgL, estimated: true }), FACTOR_MAX.water);
            }
        }
    }
    for (const mph of [0, 2, 8, 14, 22, 40]) inRange(scoreWind(mph, { gustMph: mph * 1.6 }), FACTOR_MAX.wind);
    for (const d of [null, -0.2, -0.04, 0, 0.04, 0.2]) inRange(scorePressure(30.1, { change3h: d }), FACTOR_MAX.pressure);
    for (let h = 0; h < 48; h++) {
        const date = new Date(local(0).getTime() + h * HOUR);
        inRange(scoreLight({ time: date.getTime(), ...CHICAGO, sky: 'partly' }), FACTOR_MAX.light);
        inRange(scoreMoon(date, CHICAGO.lon), FACTOR_MAX.moon);
    }
});

// --- Water temperature -----------------------------------------------------

test('each species group has its own prime range', () => {
    const full = FACTOR_MAX.water;
    assert.equal(scoreWaterTemp(74, { group: 'warm' }).points, full);
    assert.equal(scoreWaterTemp(66, { group: 'cool' }).points, full);
    assert.equal(scoreWaterTemp(56, { group: 'cold' }).points, full);
    assert.equal(scoreWaterTemp(68).points, full); // "all species" default

    // 72°F is ideal for bass and too warm for trout.
    assert.ok(scoreWaterTemp(72, { group: 'cold' }).points < full * 0.25);
    assert.match(scoreWaterTemp(72, { group: 'cold' }).note, /Warm for trout/);
    assert.match(scoreWaterTemp(74, { group: 'cold' }).note, /Too warm for trout/);
    // 52°F is prime for trout and slow for bass.
    assert.ok(scoreWaterTemp(52, { group: 'warm' }).points < full * 0.5);
    assert.match(scoreWaterTemp(52, { group: 'warm' }).note, /^Cold|^Cool/);
});

test('bass score follows the measured catch by temperature band', () => {
    // Catch per outing: 49–58°F about 40% of the 69–78°F peak, 59–68°F about 80%, 79–88°F about 70%.
    const share = (t) => scoreWaterTemp(t, { group: 'warm' }).share;
    assert.ok(Math.abs(share(54) - 0.4) < 0.05);
    assert.ok(Math.abs(share(64) - 0.8) < 0.05);
    assert.equal(share(74), 1);
    assert.ok(Math.abs(share(85) - 0.7) < 0.08);
});

test('water temperature changes gradually, with no cliffs between bands', () => {
    for (const group of Object.keys(SPECIES_GROUPS)) {
        for (let t = 33; t < 100; t += 0.5) {
            const step = Math.abs(scoreWaterTemp(t + 0.5, { group }).share - scoreWaterTemp(t, { group }).share);
            assert.ok(step <= 0.1, `${group} jumps ${step.toFixed(2)} at ${t}°F`);
        }
    }
});

test('an estimated water temperature is labelled and pulled toward the middle', () => {
    const measuredCold = scoreWaterTemp(38);
    const estimatedCold = scoreWaterTemp(38, { estimated: true, change24h: 0.2 });
    assert.ok(estimatedCold.points > measuredCold.points);
    assert.ok(scoreWaterTemp(68, { estimated: true }).points < scoreWaterTemp(68).points);
    assert.match(estimatedCold.note, /estimated/);
    assert.equal(estimatedCold.trend, null);
});

test('the 24-hour water trend is reported but does not move the score', () => {
    assert.equal(scoreWaterTemp(60, { change24h: -5 }).points, scoreWaterTemp(60, { change24h: 0 }).points);
    assert.match(scoreWaterTemp(60, { change24h: -5 }).trend, /Falling fast · −5\.0°F in 24 hr/);
    assert.match(scoreWaterTemp(60, { change24h: 0.2 }).trend, /Steady/);
});

test('low dissolved oxygen cuts the water score, sooner for trout', () => {
    const normal = scoreWaterTemp(70, { group: 'warm', oxygenMgL: 8 });
    const low = scoreWaterTemp(70, { group: 'warm', oxygenMgL: 3.4 });
    assert.equal(normal.points, FACTOR_MAX.water);
    assert.ok(low.points < normal.points * 0.6);
    assert.match(low.note, /Low oxygen \(3\.4 mg\/L\)/);
    // 5.5 mg/L is fine for bass but already impairs salmonids.
    assert.equal(scoreWaterTemp(70, { group: 'warm', oxygenMgL: 5.5 }).points, FACTOR_MAX.water);
    assert.ok(scoreWaterTemp(56, { group: 'cold', oxygenMgL: 5.5 }).points < FACTOR_MAX.water);
});

// --- Light -----------------------------------------------------------------

test('light: dusk beats dawn, which beats an overcast day, bright midday and night', () => {
    const light = (date, sky = 'clear') => scoreLight({ time: date.getTime(), ...CHICAGO, sky });
    const dusk = light(local(20));
    const dawn = light(local(5, 30));
    const overcastNoon = light(local(13), 'overcast');
    const brightNoon = light(local(13));
    const night = light(local(1));

    assert.equal(dusk.points, FACTOR_MAX.light);
    assert.deepEqual([dusk.phase, dawn.phase, brightNoon.phase, night.phase], ['dusk', 'dawn', 'day', 'night']);
    assert.ok(dusk.points > dawn.points);
    assert.ok(dawn.points > overcastNoon.points);
    assert.ok(overcastNoon.points > brightNoon.points);
    assert.ok(brightNoon.points > night.points);
    assert.match(brightNoon.note, /Bright sun/);
    assert.match(night.note, /After dark/);
});

test('light changes smoothly through the day, with no jumps', () => {
    const places = [
        ['Chicago in June', CHICAGO, Date.UTC(2026, 5, 15)],
        ['Fairbanks in December, where the noon sun is only 2° up', { lat: 64.84, lon: -147.72 }, Date.UTC(2026, 11, 21)],
        ['Utqiagvik under the midnight sun', { lat: 71.29, lon: -156.79 }, Date.UTC(2026, 5, 21)],
    ];
    for (const [name, place, start] of places) {
        for (let t = start; t < start + 24 * HOUR; t += 10 * 60_000) {
            const a = scoreLight({ time: t, ...place, sky: 'clear' }).share;
            const b = scoreLight({ time: t + 10 * 60_000, ...place, sky: 'clear' }).share;
            // Nightfall is the steepest stretch: full marks to night value in about 45 minutes.
            assert.ok(Math.abs(a - b) <= 0.16, `${name}: jump of ${Math.abs(a - b).toFixed(2)} at ${new Date(t).toISOString()}`);
        }
    }
});

test('light falls back to the sky alone when the place is unknown', () => {
    assert.equal(scoreLight({ time: Date.now(), sky: 'overcast' }).phase, 'day');
    assert.ok(scoreLight({ time: Date.now(), sky: 'overcast' }).points > scoreLight({ time: Date.now(), sky: 'clear' }).points);
});

// --- Wind ------------------------------------------------------------------

test('wind: a light chop is ideal, calm is nearly as good, strong wind is not', () => {
    assert.equal(scoreWind(8).points, FACTOR_MAX.wind);
    assert.ok(scoreWind(0).points >= FACTOR_MAX.wind * 0.7);
    assert.ok(scoreWind(18).points < scoreWind(12).points);
    assert.equal(scoreWind(32).points, 0);
    assert.match(scoreWind(32).note, /Too windy/);
    // Gusts count: 10 mph gusting 30 is scored like a steady 21.
    assert.equal(scoreWind(10, { gustMph: 30 }).points, scoreWind(21).points);
    assert.equal(scoreWind(10, { gustMph: 13 }).points, scoreWind(10).points);
});

// --- River flow --------------------------------------------------------------

test('flow percentile interpolates within the record and extrapolates beyond it', () => {
    assert.equal(flowPercentile(1250, NORMALS), 50);
    assert.equal(flowPercentile(300, NORMALS), 5);
    assert.equal(flowPercentile(625, NORMALS), 17.5);
    assert.ok(flowPercentile(100, NORMALS) < 5);
    assert.ok(flowPercentile(6000, NORMALS) > 95);
    assert.equal(flowPercentile(50000, NORMALS), 100);
    assert.equal(flowPercentile(1250, null), null);
    assert.equal(flowPercentile(1250, { ...NORMALS, 50: Number.NaN }), null);
    assert.equal(flowPercentile(1250, { ...NORMALS, 25: 9999 }), null); // not increasing: unusable
});

test('flow: normal is best, low costs a little, flood costs nearly everything', () => {
    const flow = (cfs) => scoreFlow({ cfs, percentiles: NORMALS });
    assert.equal(flow(1250).points, FACTOR_MAX.flow);
    assert.match(flow(1250).note, /Normal for the date/);
    assert.match(flow(1250).trend, /100% of the median/);
    assert.ok(flow(350).points >= FACTOR_MAX.flow * 0.6);
    assert.match(flow(350).note, /Very low/);
    assert.ok(flow(2900).points < FACTOR_MAX.flow);
    assert.ok(flow(6000).points <= 2);
    assert.match(flow(6000).note, /Very high/);
    assert.equal(scoreFlow(null), null);
    assert.equal(scoreFlow({ cfs: 1250, percentiles: null }), null);
});

// --- Moon and pressure -------------------------------------------------------

test('moon: new/full beats the quarters, and overhead or underfoot adds a little', () => {
    const quarter = new Date(FULL_MOON.getTime() + 7.38 * 86_400_000);
    assert.ok(scoreMoon(FULL_MOON).points > scoreMoon(quarter).points);
    assert.match(scoreMoon(quarter).note, /Quarter moon/);

    // Over a lunar day the moon crosses overhead once and underfoot once.
    const notes = new Set();
    let best = 0;
    for (let t = local(0).getTime(); t < local(25).getTime(); t += 20 * 60_000) {
        const result = scoreMoon(new Date(t), CHICAGO.lon);
        notes.add(result.note);
        best = Math.max(best, result.points);
    }
    assert.ok(notes.has('Moon overhead — a solunar feeding window'));
    assert.ok(notes.has('Moon underfoot — a solunar feeding window'));
    assert.equal(best, FACTOR_MAX.moon); // new moon and a major period together
});

test('pressure: only the trend counts, and never for more than five points', () => {
    const at = (change3h) => scorePressure(30.1, { change3h });
    assert.equal(at(-0.04).points, FACTOR_MAX.pressure);
    assert.ok(at(-0.04).points > at(0.005).points);
    assert.ok(at(0.005).points > at(0.09).points);
    // The level itself earns nothing either way.
    assert.equal(scorePressure(29.4, { change3h: 0 }).points, scorePressure(30.1, { change3h: 0 }).points);
    assert.match(at(-0.04).trend, /Falling · −0\.04 inHg in 3 hr/);
    assert.match(at(0).trend, /Steady/);
    assert.equal(scorePressure(30.1, {}).trend, null);
});

test('a missing barometer scores as neutral instead of failing', () => {
    const result = scorePressure(null, { change3h: null });
    assert.equal(result.points, 3);
    assert.match(result.note, /No barometer/);
    const withBarometer = scoreConditions(ideal).score;
    const without = scoreConditions({ ...ideal, pressureInHg: null, pressureChange3h: null }).score;
    assert.ok(withBarometer - without <= 2);
});

// --- Overall score -----------------------------------------------------------

test('time of day moves the score: dusk above dawn above midday above night', () => {
    const at = (date) => scoreConditions({ ...ideal, date }).score;
    assert.ok(at(local(20)) > at(local(5, 30)));
    assert.ok(at(local(5, 30)) > at(local(13)));
    assert.ok(at(local(13)) > at(local(3)));
});

test('a factor that does not apply is left out and the rest are rescaled', () => {
    const river = scoreConditions(ideal);
    const lake = scoreConditions({ ...ideal, flow: null });
    assert.equal(river.available, 100);
    assert.equal(lake.available, 100 - FACTOR_MAX.flow);
    assert.equal(points(lake, 'flow'), undefined);
    assert.ok(Math.abs(river.score - lake.score) <= 2); // an ideal lake is not penalised for having no flow
});

test('a limiting factor sets a ceiling however good everything else is', () => {
    const trout = scoreConditions({ ...ideal, speciesGroup: 'cold', waterTempF: 74 });
    assert.ok(trout.score < 25, `got ${trout.score}`);
    assert.equal(trout.cap.reason, 'Held down by the water temperature');

    const flood = scoreConditions({ ...ideal, flow: { cfs: 9000, percentiles: NORMALS } });
    assert.ok(flood.score < 25, `got ${flood.score}`);
    assert.equal(flood.cap.reason, 'Held down by the river flow');

    const gale = scoreConditions({ ...ideal, windMph: 32 });
    assert.ok(gale.score <= 12);
    assert.equal(gale.cap.reason, 'Held down by the wind');

    // Poor light or a weak moon never caps the score on its own.
    assert.equal(scoreConditions({ ...ideal, date: local(13) }).cap, null);
});

test('thunderstorms and dangerous-weather warnings cap the score', () => {
    const storm = scoreConditions({ ...ideal, sky: 'storm' });
    assert.equal(storm.score, HAZARD_CAP);
    assert.equal(storm.cap.reason, 'Thunderstorms in the area');

    const warned = scoreConditions({ ...ideal, hazard: 'Severe Thunderstorm Warning' });
    assert.equal(warned.score, HAZARD_CAP);
    assert.equal(warned.cap.reason, 'Severe Thunderstorm Warning in effect');
    assert.equal(points(warned, 'water'), FACTOR_MAX.water); // the factors still show the underlying conditions

    // A cap that changes nothing is not reported: the gale already holds this lower.
    assert.equal(scoreConditions({ ...ideal, windMph: 40, hazard: 'Tornado Warning' }).cap.reason, 'Held down by the wind');
});

test('best windows are the low-light periods, earliest first', () => {
    const start = local(10).getTime();
    const windows = bestWindows(ideal, { start, hours: 36 });
    assert.equal(windows.length, 3); // this evening, tomorrow's dawn, tomorrow evening
    const hourOf = (time) => ((time - local(0).getTime()) / HOUR) % 24;
    assert.ok(hourOf(windows[0].start) >= 18.5 && hourOf(windows[0].end) <= 21.5, 'first window brackets sunset');
    assert.ok(hourOf(windows[1].start) >= 4 && hourOf(windows[1].end) <= 8, 'second window brackets sunrise');
    assert.ok(windows[0].peak > windows[1].peak);
    for (let i = 1; i < windows.length; i++) assert.ok(windows[i].start > windows[i - 1].end);

    // A forecast storm removes that evening from the list.
    const stormy = bestWindows(ideal, {
        start, hours: 36, at: (time) => (time < local(24).getTime() ? { sky: 'storm' } : null),
    });
    assert.ok(stormy.every((window) => window.start >= local(24).getTime()));
});

test('no best windows are offered when the score is held flat the whole time', () => {
    const start = local(10).getTime();
    assert.deepEqual(bestWindows({ ...ideal, waterTempF: 32.2 }, { start, hours: 36 }), []); // frozen: capped at every hour
    assert.deepEqual(bestWindows({ ...ideal, flow: { cfs: 20000, percentiles: NORMALS } }, { start, hours: 36 }), []);
    assert.ok(bestWindows({ ...ideal, waterTempF: 50 }, { start, hours: 36 }).length > 0); // cool but fishable
});

test('score series: the first point is the score now, later points use the forecast', () => {
    const start = local(10).getTime();
    const base = { ...ideal, pressureChange3h: 0.1, hazard: 'Severe Thunderstorm Warning' }; // now: capped by the warning
    const series = scoreSeries(base, { start, end: start + 6 * HOUR });
    assert.equal(series.length, 19); // now, then every 20 minutes
    assert.equal(series[0].t, start);
    assert.equal(series[0].score, scoreConditions({ ...base, date: new Date(start) }).score);
    assert.equal(series[0].score, HAZARD_CAP);
    assert.equal(series[0].cap, 'Severe Thunderstorm Warning in effect');
    // The warning and the pressure trend are not carried into the hours ahead.
    assert.ok(series[1].score > 70);
    assert.equal(series[1].cap, null);
    assert.equal(series[1].band.label, bandFor(series[1].score).label);
    for (let i = 1; i < series.length; i++) assert.equal((series[i].t - series[i - 1].t), 20 * 60_000);

    // What is forecast for an hour changes that hour only.
    const windy = scoreSeries(ideal, { start, end: start + 6 * HOUR, at: (t) => (t >= start + 3 * HOUR ? { windMph: 32 } : null) });
    assert.ok(windy[6].score > 70);
    assert.ok(windy[12].score <= 12);
    assert.equal(windy[12].cap, 'Held down by the wind');
});

test('score series: samples after the first sit on round clock times', () => {
    const start = local(10, 7).getTime(); // 10:07
    const series = scoreSeries(ideal, { start, end: start + 2 * HOUR });
    assert.equal(series[0].t, start);
    assert.equal(new Date(series[1].t).getUTCMinutes(), 20);
    assert.equal(new Date(series[2].t).getUTCMinutes(), 40);
    assert.ok(series[series.length - 1].t <= start + 2 * HOUR);
});

test('bands and phrases', () => {
    assert.equal(bandFor(100).key, 'exceptional');
    assert.equal(bandFor(85).key, 'exceptional');
    assert.equal(bandFor(84).key, 'excellent');
    assert.equal(bandFor(55).key, 'good');
    assert.equal(bandFor(40).key, 'fair');
    assert.equal(bandFor(25).key, 'poor');
    assert.equal(bandFor(10).key, 'verypoor');
    assert.equal(bandFor(0).key, 'terrible');

    const day = new Date('2026-06-01T12:00:00Z');
    assert.equal(bitePhrase(72, day), bitePhrase(72, new Date('2026-06-01T20:00:00Z')));
    assert.match(bitePhrase(72, day), /^The bite is /);
});

test('water temperature estimate lags the air temperature', () => {
    assert.equal(estimateWaterTemp([50, 60, 70], 90), 60);
    assert.equal(estimateWaterTemp([], 70), 65);
    assert.equal(estimateWaterTemp([10, 20], 15), 33); // liquid water floor
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { seasonHalf, seasonalPhase } from '../js/core/season.js';
import { frontState } from '../js/core/trend.js';
import { dailyMeans, describeWaterTrend, summariseWaterTrend } from '../js/core/water-trend.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = Date.parse('2026-11-14T15:00:00Z');
const iso = (t) => new Date(t).toISOString().slice(0, 10);

/** `values` are daily means ending yesterday, oldest first. */
const days = (values, end = NOW) => values.map((v, i) => ({ day: iso(end - (values.length - i) * DAY), v }));
const ramp = (n, from, to) => Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));

// ---------------------------------------------------------------------------
// Water trend
// ---------------------------------------------------------------------------

test('hourly readings become daily means, leaving out days with too few readings', () => {
    const start = Date.parse('2026-11-01T00:00:00Z');
    const hourly = [];
    for (let h = 0; h < 24; h++) hourly.push({ t: start + h * HOUR, v: 60 + (h % 2) }); // a full day, mean 60.5
    for (let h = 0; h < 5; h++) hourly.push({ t: start + DAY + h * HOUR, v: 50 }); // a stub of a day
    hourly.push({ t: Number.NaN, v: 99 });
    assert.deepEqual(dailyMeans(hourly), [{ day: '2026-11-01', v: 60.5 }]);
    assert.deepEqual(dailyMeans(hourly, { minSamples: 5 }).map((entry) => entry.day), ['2026-11-01', '2026-11-02']);
    assert.deepEqual(dailyMeans(null), []);
});

test('a month of cooling water reads as cooling, with the 7- and 14-day changes', () => {
    const trend = summariseWaterTrend(days(ramp(30, 70, 55.5)), { now: NOW });
    assert.equal(trend.direction, 'cooling');
    assert.equal(trend.days, 30);
    assert.equal(trend.latestF, 55.5);
    assert.ok(Math.abs(trend.change7 - -3.5) < 0.01);
    assert.ok(Math.abs(trend.change14 - -7) < 0.01);
    assert.ok(Math.abs(trend.perWeek - -3.5) < 0.01);
    assert.equal(trend.swing, null);
    assert.equal(trend.normalState, null);
    assert.deepEqual(describeWaterTrend(trend), ['Down 7.0°F in 14 days']);
});

test('small wobbles are steady; a sudden three-day drop is a cold snap', () => {
    const wobble = summariseWaterTrend(days(ramp(20, 60, 60).map((v, i) => v + (i % 2 ? 0.6 : -0.6))), { now: NOW });
    assert.equal(wobble.direction, 'steady');
    assert.deepEqual(describeWaterTrend(wobble), ['Steady over 14 days']);

    const snap = summariseWaterTrend(days([...ramp(17, 62, 62), 61, 58, 56.5]), { now: NOW });
    assert.equal(snap.swing, 'cold-snap');
    assert.equal(snap.direction, 'cooling');
    assert.match(describeWaterTrend(snap).join(' | '), /Cold snap: down 5\.5°F in 3 days/);

    const spell = summariseWaterTrend(days([...ramp(17, 48, 48), 50, 52, 53]), { now: NOW });
    assert.equal(spell.swing, 'warm-spell');
});

test('compared with the normal for the date when the station has one', () => {
    const normal = { p25: 54, p50: 56, p75: 58 };
    const cold = summariseWaterTrend(days(ramp(14, 52, 51)), { now: NOW, normal });
    assert.equal(cold.normalState, 'cold');
    assert.ok(Math.abs(cold.vsNormal - -5) < 0.01);
    assert.match(describeWaterTrend(cold).at(-1), /5\.0°F colder than usual for the date/);
    assert.equal(summariseWaterTrend(days(ramp(14, 57, 57)), { now: NOW, normal }).normalState, 'normal');
    assert.equal(summariseWaterTrend(days(ramp(14, 61, 61)), { now: NOW, normal }).normalState, 'warm');
});

test('too little or too old a record says nothing', () => {
    assert.equal(summariseWaterTrend(days([60, 60, 60, 60]), { now: NOW }), null);
    assert.equal(summariseWaterTrend(days(ramp(20, 60, 55), NOW - 10 * DAY), { now: NOW }), null); // the sensor stopped ten days ago
    assert.equal(summariseWaterTrend([], { now: NOW }), null);
    assert.deepEqual(describeWaterTrend(null), []);
    // Gaps are fine: a value a day either side stands in.
    const gappy = days(ramp(20, 70, 60)).filter((_, i) => i % 3 !== 1);
    assert.ok(summariseWaterTrend(gappy, { now: NOW }).change7 < 0);
});

// ---------------------------------------------------------------------------
// Seasons
// ---------------------------------------------------------------------------

const at = (text) => new Date(`${text}T17:00:00Z`);

test('the calendar decides spring or fall, except near the turns where the water does', () => {
    assert.equal(seasonHalf(at('2026-04-10')), 'warming');
    assert.equal(seasonHalf(at('2026-10-10')), 'cooling');
    assert.equal(seasonHalf(at('2026-01-05')), 'cooling');
    assert.equal(seasonHalf(at('2026-01-20')), 'warming');

    const warming = { change14: 4, days: 30 };
    const cooling = { change14: -4, days: 30 };
    assert.equal(seasonHalf(at('2026-01-05'), warming), 'warming'); // an early spring in the far south
    assert.equal(seasonHalf(at('2026-07-20'), cooling), 'cooling'); // an early fall
    assert.equal(seasonHalf(at('2026-08-20'), warming), 'warming'); // summer is not over yet
    // Away from the turns a cold spell in April is not fall, nor a warm week in November spring.
    assert.equal(seasonHalf(at('2026-04-10'), cooling), 'warming');
    assert.equal(seasonHalf(at('2026-11-10'), warming), 'cooling');
    assert.equal(seasonHalf(at('2026-03-01'), cooling), 'warming');
    // Small changes leave the calendar alone.
    assert.equal(seasonHalf(at('2026-07-20'), { change14: -1.5, days: 30 }), 'warming');
});

test('bass move through their year by temperature and direction', () => {
    const phase = (date, waterTempF, trend = null) => seasonalPhase('bass', { date: at(date), waterTempF, trend }).id;
    assert.equal(phase('2026-01-08', 44), 'winter');
    assert.equal(phase('2026-03-15', 55), 'prespawn');
    assert.equal(phase('2026-04-20', 65), 'spawn');
    assert.equal(phase('2026-06-01', 75), 'postspawn');
    assert.equal(phase('2026-07-15', 84), 'summer');
    assert.equal(phase('2026-08-10', 84), 'summer');
    assert.equal(phase('2026-10-01', 70), 'fall');
    assert.equal(phase('2026-11-14', 57), 'latefall');
    assert.equal(phase('2026-12-20', 46), 'winter');
    // Florida: 64°F water in late January is spawning time, not fall.
    assert.equal(phase('2026-01-25', 64), 'spawn');
    assert.equal(phase('2026-12-20', 66), 'latefall');
});

test('salt-water and cold-water fish have their own calendars', () => {
    const phase = (target, date, waterTempF) => seasonalPhase(target, { date: at(date), waterTempF });
    assert.equal(phase('redfish', '2026-10-01', 78).label, 'Fall run');
    assert.equal(phase('redfish', '2026-01-10', 56).id, 'winter');
    assert.equal(phase('snook', '2026-01-10', 66).id, 'winter');
    assert.equal(phase('snook', '2026-06-20', 84).id, 'summer');
    assert.equal(phase('snook', '2026-10-01', 80).id, 'fall');
    assert.equal(phase('striper', '2026-04-15', 54).id, 'spring');
    assert.equal(phase('striper', '2026-10-25', 60).id, 'fall');
    assert.equal(phase('flounder', '2026-11-01', 64).id, 'fall');
    assert.equal(phase('surfperch', '2026-02-01', 56).id, 'peak');
    assert.equal(phase('corbina', '2026-08-01', 68).id, 'summer');
    assert.equal(phase('halibut', '2026-05-01', 62).id, 'spawn');
    assert.equal(phase('walleye', '2026-04-05', 45).id, 'spawn');
    assert.equal(phase('walleye', '2026-01-25', 42).id, 'winter');
    assert.equal(phase('muskie', '2026-10-05', 58).id, 'fall');
    assert.equal(phase('trout', '2026-10-20', 52).id, 'fall');
    assert.equal(phase('salmon', '2026-09-20', 55).id, 'run');
    assert.equal(phase('pompano', '2026-11-01', 74).id, 'fall');
    assert.equal(phase('whiting', '2026-03-01', 62).id, 'peak');
});

test('a phase names itself and the fish\'s food', () => {
    const phase = seasonalPhase('bass', { date: at('2026-10-01'), waterTempF: 70 });
    assert.equal(phase.label, 'Fall feed');
    assert.equal(phase.forage, 'shad');
    assert.equal(phase.half, 'cooling');
    assert.ok(!/[.!?]$/.test(phase.pattern), 'the page adds the full stop');
    assert.equal(seasonalPhase('tarpon', { date: at('2026-10-01'), waterTempF: 80 }), null);
    assert.equal(seasonalPhase('bass', { date: null, waterTempF: 70 }), null);
});

// ---------------------------------------------------------------------------
// Fronts
// ---------------------------------------------------------------------------

/** Hourly series over the last 48 hours: f(hoursAgo) -> value. */
const hourly = (f) => Array.from({ length: 49 }, (_, i) => ({ t: NOW - (48 - i) * HOUR, v: f(48 - i) }));

test('a sharp rise in pressure with colder air is a front just through; a steady fall is one coming', () => {
    const rising = hourly((ago) => 29.85 + (0.2 * (48 - ago)) / 48); // +0.10 in the last 24 hours
    const steepRise = hourly((ago) => (ago > 24 ? 29.8 : 29.8 + (0.2 * (24 - ago)) / 24));
    const cooled = hourly((ago) => (ago > 24 ? 70 : 58));
    const mild = hourly(() => 65);
    assert.equal(frontState(steepRise, cooled), 'passed');
    assert.equal(frontState(steepRise, mild), 'passed'); // +0.20 in a day is a front even without the air
    assert.equal(frontState(rising, cooled), null); // +0.10 is not enough
    assert.equal(frontState(hourly((ago) => 30.1 - (0.12 * (12 - Math.min(ago, 12))) / 12), mild), 'approaching');
    assert.equal(frontState(hourly(() => 30.0), mild), null);
    assert.equal(frontState([], []), null);
});

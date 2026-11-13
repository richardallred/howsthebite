import assert from 'node:assert/strict';
import { test } from 'node:test';

import { moonAge, moonInfo } from '../js/core/moon.js';
import { changeOver, classifyTrend, lastHours, valueAt } from '../js/core/trend.js';
import {
    HOUR_MS, boundingBox, distanceMiles, niceTicks, prettySiteName, timeAgo,
} from '../js/core/util.js';
import { compassPoint, describeSky, iconCodes } from '../js/core/sky.js';

const hourly = (values, start = 0) => values.map((v, i) => ({ t: start + i * HOUR_MS, v }));

test('valueAt interpolates between samples and refuses to extrapolate far', () => {
    const series = hourly([10, 20, 40]);
    assert.equal(valueAt(series, 0.5 * HOUR_MS), 15);
    assert.equal(valueAt(series, 1.5 * HOUR_MS), 30);
    assert.equal(valueAt(series, 2 * HOUR_MS), 40);
    assert.equal(valueAt(series, -HOUR_MS), 10); // within tolerance
    assert.equal(valueAt(series, -5 * HOUR_MS), null);
    assert.equal(valueAt([], 0), null);
});

test('changeOver uses timestamps, not sample counts', () => {
    // 15-minute samples rising 1 unit per hour.
    const series = Array.from({ length: 41 }, (_, i) => ({ t: i * HOUR_MS / 4, v: i / 4 }));
    assert.ok(Math.abs(changeOver(series, 3) - 3) < 1e-9);
    assert.equal(changeOver(hourly([1, 2]), 24), null); // not enough history
    assert.equal(changeOver([], 3), null);
});

test('classifyTrend', () => {
    const limits = { steadyBelow: 0.02, rapidAbove: 0.06 };
    assert.equal(classifyTrend(0.01, limits).direction, 'steady');
    assert.deepEqual(classifyTrend(-0.03, limits), { direction: 'falling', rapid: false, delta: -0.03 });
    assert.deepEqual(classifyTrend(0.08, limits), { direction: 'rising', rapid: true, delta: 0.08 });
    assert.equal(classifyTrend(null, limits).direction, 'unknown');
});

test('lastHours keeps only the trailing window', () => {
    const series = hourly([1, 2, 3, 4, 5]);
    assert.deepEqual(lastHours(series, 2, 4 * HOUR_MS).map((p) => p.v), [3, 4, 5]);
});

test('moon phase matches known dates', () => {
    // Full moon 2024-10-17 11:26 UTC, new moon 2024-11-01 12:47 UTC.
    assert.equal(moonInfo(new Date('2024-10-17T12:00:00Z')).name, 'Full Moon');
    assert.equal(moonInfo(new Date('2024-11-01T12:00:00Z')).name, 'New Moon');
    assert.equal(moonInfo(new Date('2024-11-09T06:00:00Z')).name, 'First Quarter');
    assert.ok(moonInfo(new Date('2024-10-17T12:00:00Z')).illumination > 0.98);
    const age = moonAge(new Date('2024-11-01T12:47:00Z'));
    assert.ok(age < 0.6 || age > 28.9, `age at new moon was ${age}`);
});

test('distance and bounding box', () => {
    // Chicago -> Milwaukee is about 81 miles.
    const miles = distanceMiles(41.8781, -87.6298, 43.0389, -87.9065);
    assert.ok(miles > 79 && miles < 84, `got ${miles}`);

    const [west, south, east, north] = boundingBox(41.88, -87.63, 60);
    assert.ok(west < -87.63 && east > -87.63 && south < 41.88 && north > 41.88);
    // USGS rejects very large boxes; a 60-mile radius must stay small.
    assert.ok((east - west) * (north - south) < 5);
    // The box really contains points 60 miles away to the north and east.
    assert.ok(distanceMiles(41.88, -87.63, north, -87.63) >= 59.5);
    assert.ok(distanceMiles(41.88, -87.63, 41.88, east) >= 59.5);
});

test('niceTicks produces round, covering ticks', () => {
    const { ticks } = niceTicks(29.74, 30.19);
    assert.ok(ticks[0] <= 29.74 && ticks.at(-1) >= 30.19);
    assert.ok(ticks.length >= 3 && ticks.length <= 8);
    const flat = niceTicks(50, 50);
    assert.ok(flat.ticks[0] < 50 && flat.ticks.at(-1) > 50);
});

test('prettySiteName tidies USGS station names', () => {
    assert.equal(prettySiteName('FOX RIVER NEAR MCHENRY, IL'), 'Fox River near McHenry, IL');
    assert.equal(prettySiteName('KANKAKEE R AT INFLOW OF POWER PLANT NR LORENZO, IL'),
        'Kankakee R at Inflow of Power Plant near Lorenzo, IL');
    assert.equal(prettySiteName('CHICAGO S & S CANAL AT WESTERN AVE AT CHICAGO, IL'),
        'Chicago S & S Canal at Western Ave at Chicago, IL');
    assert.equal(prettySiteName('ROOT RIVER AT 60TH ST NEAR CALEDONIA, WI'),
        'Root River at 60th St near Caledonia, WI');
    assert.equal(prettySiteName('Long Lake at BEN Dock at Long Lake, IL'), 'Long Lake at Ben Dock at Long Lake, IL');
    assert.equal(prettySiteName('DOWAGIAC CREEK AT DUTCH SETTLEMENT RD NR DOWAGIAC,'),
        'Dowagiac Creek at Dutch Settlement Rd near Dowagiac');
    assert.equal(prettySiteName('CATAWBA R AT RR BRIDGE AB NC 73 AT COWANS FORD, NC'),
        'Catawba R at RR Bridge above NC 73 at Cowans Ford, NC');
    assert.equal(prettySiteName('CATAWBA RIVER AT NC HIGHWAY 16 NEAR MILLERSVILLE, NC'),
        'Catawba River at NC Highway 16 near Millersville, NC');
    assert.equal(prettySiteName(''), 'Unnamed station');
});

test('timeAgo', () => {
    const now = Date.UTC(2026, 0, 1);
    assert.equal(timeAgo(now - 20_000, now), 'just now');
    assert.equal(timeAgo(now - 5 * 60_000, now), '5 min ago');
    assert.equal(timeAgo(now - 3 * HOUR_MS, now), '3 hr ago');
    assert.equal(timeAgo(now - 49 * HOUR_MS, now), '2 days ago');
});

test('NWS sky reports are classified from text first, then the icon', () => {
    const icon = (path) => `https://api.weather.gov/icons/land/${path}?size=medium`;
    assert.deepEqual(iconCodes(icon('night/rain,30/bkn')), ['rain', 'bkn']);
    assert.deepEqual(iconCodes(icon('day/wind_few')), ['few']);
    assert.deepEqual(iconCodes(null), []);

    assert.deepEqual(describeSky({ text: 'Mostly Cloudy', icon: icon('day/bkn') }), { class: 'overcast', label: 'Mostly cloudy', emoji: '☁️' });
    assert.equal(describeSky({ text: 'Clear', icon: icon('night/skc') }).emoji, '🌙');
    assert.equal(describeSky({ text: 'Mostly Clear', icon: icon('day/few') }).class, 'clear');
    assert.equal(describeSky({ text: 'Partly Cloudy' }).class, 'partly');
    assert.equal(describeSky({ text: 'Light Rain and Fog/Mist', icon: icon('day/rain') }).class, 'light-precip');
    assert.equal(describeSky({ text: 'Light Rain and Fog/Mist' }).label, 'Light rain and fog');
    assert.equal(describeSky({ text: 'Heavy Rain' }).class, 'precip');
    assert.equal(describeSky({ text: 'Fog/Mist', icon: icon('day/fog') }).class, 'overcast');
    assert.equal(describeSky({ text: 'Thunderstorm in Vicinity' }).class, 'storm');
    assert.equal(describeSky({ text: 'Freezing Fog' }).class, 'overcast');
    assert.equal(describeSky({ text: 'Freezing Rain' }).class, 'precip');
    assert.equal(describeSky({ text: 'Light Snow' }).emoji, '🌨️');

    // No text: fall back to the icon. Nothing at all: unknown.
    assert.deepEqual(describeSky({ icon: icon('day/tsra_hi,40') }), { class: 'storm', label: 'Isolated thunderstorms', emoji: '⛈️' });
    assert.equal(describeSky({}).class, 'unknown');

    // Forecasts: "Slight Chance Light Rain" under a mostly-cloudy icon is a cloudy day.
    const forecast = describeSky({ text: 'Mostly Cloudy then Slight Chance Light Rain', icon: icon('day/bkn/rain,20'), preferIcon: true });
    assert.equal(forecast.class, 'overcast');
    assert.equal(forecast.label, 'Mostly cloudy then slight chance light rain');
});

test('compass points', () => {
    assert.equal(compassPoint(0), 'N');
    assert.equal(compassPoint(327), 'NW');
    assert.equal(compassPoint(359), 'N');
});

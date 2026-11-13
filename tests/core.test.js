import assert from 'node:assert/strict';
import { test } from 'node:test';

import { forecastSkyClass } from '../js/api/weather-api.js';
import { summariseAlerts } from '../js/core/alerts.js';
import { moonAge, moonInfo, moonTransit } from '../js/core/moon.js';
import { sunAltitude, sunTimes } from '../js/core/sun.js';
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

    assert.deepEqual(describeSky({ text: 'Mostly Cloudy', icon: icon('day/bkn') }), { class: 'overcast', label: 'Mostly cloudy', icon: 'cloud' });
    assert.equal(describeSky({ text: 'Clear', icon: icon('night/skc') }).icon, 'moon');
    assert.equal(describeSky({ text: 'Mostly Clear', icon: icon('day/few') }).class, 'clear');
    assert.equal(describeSky({ text: 'Partly Cloudy' }).class, 'partly');
    assert.equal(describeSky({ text: 'Light Rain and Fog/Mist', icon: icon('day/rain') }).class, 'light-precip');
    assert.equal(describeSky({ text: 'Light Rain and Fog/Mist' }).label, 'Light rain and fog');
    assert.equal(describeSky({ text: 'Heavy Rain' }).class, 'precip');
    assert.equal(describeSky({ text: 'Fog/Mist', icon: icon('day/fog') }).class, 'overcast');
    assert.equal(describeSky({ text: 'Thunderstorm in Vicinity' }).class, 'storm');
    assert.equal(describeSky({ text: 'Freezing Fog' }).class, 'overcast');
    assert.equal(describeSky({ text: 'Freezing Rain' }).class, 'precip');
    assert.equal(describeSky({ text: 'Light Snow' }).icon, 'snow');

    // No text: fall back to the icon. Nothing at all: unknown.
    assert.deepEqual(describeSky({ icon: icon('day/tsra_hi,40') }), { class: 'storm', label: 'Isolated thunderstorms', icon: 'storm' });
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

test('sunrise and sunset match published times to within two minutes', () => {
    const minutes = (iso) => Date.parse(iso) / 60000;
    const near = (actual, iso) => assert.ok(Math.abs(actual / 60000 - minutes(iso)) <= 2, `${new Date(actual).toISOString()} vs ${iso}`);

    // Chicago, 15 June 2026 (CDT): sunrise 5:15 AM, sunset 8:28 PM.
    const chicago = sunTimes(Date.parse('2026-06-15T15:00:00Z'), 41.8781, -87.6298);
    near(chicago.sunrise, '2026-06-15T10:15:30Z');
    near(chicago.sunset, '2026-06-16T01:28:00Z');
    assert.ok(chicago.dawn < chicago.sunrise && chicago.sunset < chicago.dusk);
    assert.ok(Math.abs(chicago.dayLengthHours - 15.2) < 0.1);

    // Atlanta, 21 December 2026 (EST): sunrise 7:39 AM, sunset 5:33 PM.
    const atlanta = sunTimes(Date.parse('2026-12-21T17:00:00Z'), 33.749, -84.388);
    near(atlanta.sunrise, '2026-12-21T12:39:00Z');
    near(atlanta.sunset, '2026-12-21T22:33:30Z');
});

test('sun altitude is high at solar noon, about zero at sunrise and negative at night', () => {
    const { noon, sunrise } = sunTimes(Date.parse('2026-06-15T15:00:00Z'), 41.8781, -87.6298);
    assert.ok(Math.abs(sunAltitude(noon, 41.8781, -87.6298) - 71.4) < 0.5); // 90 − latitude + declination
    assert.ok(Math.abs(sunAltitude(sunrise, 41.8781, -87.6298)) < 1);
    assert.ok(sunAltitude(Date.parse('2026-06-15T06:00:00Z'), 41.8781, -87.6298) < -20);
});

test('places with midnight sun report no sunrise or sunset instead of a wrong one', () => {
    const utqiagvik = sunTimes(Date.parse('2026-06-21T20:00:00Z'), 71.29, -156.79);
    assert.equal(utqiagvik.sunrise, null);
    assert.equal(utqiagvik.sunset, null);
    assert.equal(utqiagvik.dayLengthHours, null);
    assert.ok(Number.isFinite(utqiagvik.noon));
});

test('the moon crosses overhead and underfoot about every 12.4 hours', () => {
    // At new moon the moon keeps company with the sun: overhead near solar noon, underfoot near midnight.
    const noon = sunTimes(Date.parse('2026-06-15T15:00:00Z'), 41.8781, -87.6298).noon;
    const atNoon = moonTransit(noon, -87.6298);
    assert.equal(atNoon.position, 'overhead');
    assert.ok(atNoon.degreesAway < 15);
    const atMidnight = moonTransit(noon - 12 * HOUR_MS, -87.6298);
    assert.equal(atMidnight.position, 'underfoot');
    assert.ok(atMidnight.degreesAway < 15);
    assert.ok(moonTransit(noon + 6 * HOUR_MS, -87.6298).degreesAway > 60);
});

test('alerts: dangerous ones in effect are flagged, advisories are listed, the rest ignored', () => {
    const now = Date.parse('2026-06-15T15:00:00Z');
    const alert = (event, onsetHours, endsHours) => ({
        event, onset: now + onsetHours * HOUR_MS, ends: endsHours === null ? null : now + endsHours * HOUR_MS,
    });

    const summary = summariseAlerts([
        alert('Small Craft Advisory', -1, 5),
        alert('Freeze Warning', -1, 5), // irrelevant on the water
        alert('Severe Thunderstorm Warning', -0.5, 1),
        alert('Severe Thunderstorm Warning', -0.2, 1), // duplicate event
        alert('Flood Warning', -30, -1), // already over
        alert('Wind Advisory', 30, 40), // too far ahead
        alert('Tornado Watch', 2, 8), // coming up
    ], now);
    assert.equal(summary.hazard, 'Severe Thunderstorm Warning');
    assert.deepEqual(summary.items.map((item) => [item.event, item.level, item.active]), [
        ['Severe Thunderstorm Warning', 'danger', true],
        ['Small Craft Advisory', 'caution', true],
        ['Tornado Watch', 'caution', false],
    ]);

    // A warning that has been issued but has not started yet does not cap the score.
    assert.equal(summariseAlerts([alert('Severe Thunderstorm Warning', 1, 2)], now).hazard, null);
    assert.deepEqual(summariseAlerts(undefined, now), { hazard: null, items: [] });
    assert.equal(summariseAlerts([{ event: 'Tornado Warning', onset: null, ends: null }], now).hazard, 'Tornado Warning');
});

test('a forecast chance of thunderstorms is not scored as a storm; a likely one is', () => {
    const period = (shortForecast, chance, code = 'tsra') => ({
        shortForecast, icon: `https://api.weather.gov/icons/land/day/${code},${chance ?? 0}?size=small`,
        probabilityOfPrecipitation: { value: chance },
    });
    assert.equal(forecastSkyClass(period('Slight Chance Showers And Thunderstorms', 20, 'tsra_hi')), 'light-precip');
    assert.equal(forecastSkyClass(period('Chance Showers And Thunderstorms', 40, 'tsra_sct')), 'light-precip');
    assert.equal(forecastSkyClass(period('Showers And Thunderstorms Likely', 70)), 'storm');
    assert.equal(forecastSkyClass(period('Showers And Thunderstorms', 93)), 'storm');
    // No probability given: go by the wording.
    assert.equal(forecastSkyClass(period('Isolated Thunderstorms', null)), 'light-precip');
    assert.equal(forecastSkyClass(period('Thunderstorms', null)), 'storm');
    // Anything that is not a storm is unaffected.
    assert.equal(forecastSkyClass({ shortForecast: 'Sunny', icon: 'https://api.weather.gov/icons/land/day/skc?size=small' }), 'clear');
    assert.equal(forecastSkyClass({ shortForecast: 'Rain Likely', icon: 'https://api.weather.gov/icons/land/day/rain,80?size=small', probabilityOfPrecipitation: { value: 80 } }), 'precip');
});

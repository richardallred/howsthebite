import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FRONT_AHEAD_HOURS, FRONT_BEHIND_HOURS, airSeries, detectFronts, frontAt, rainAhead } from '../js/core/fronts.js';
import { outlookFrom } from '../js/api/weather-api.js';

const HOUR = 3600_000;
const NOW = Date.UTC(2026, 9, 12, 15); // a Monday, 10:00 in Chicago

// A day's swing of 8°F either side of `base`, warmest mid-afternoon.
const daily = (t) => 8 * Math.sin((2 * Math.PI * ((t / HOUR) % 24 - 15)) / 24);
/** Hourly air temperature from 72 hours ago to 108 hours ahead; `shift(hoursFromNow)` is the air mass on top of the daily swing. */
const air = (shift = () => 0, base = 60) => {
    const series = [];
    for (let h = -72; h <= 108; h++) series.push({ t: NOW + h * HOUR, v: base + daily(NOW + h * HOUR) + shift(h) });
    return series;
};
const step = (atHour, by) => (h) => (h >= atHour ? by : 0);

test('settled weather has no fronts, however far the temperature swings in a day', () => {
    assert.deepEqual(detectFronts(air()), []);
    assert.deepEqual(detectFronts(air((h) => h * 0.05)), []); // a slow warming trend is not a front
    assert.deepEqual(detectFronts([]), []);
    assert.deepEqual(detectFronts(null), []);
});

test('a cold front is found where the air turns colder than the day before, and timed to the hour or so', () => {
    const [front, ...others] = detectFronts(air(step(30, -15)));
    assert.equal(others.length, 0);
    assert.equal(front.kind, 'cold');
    assert.ok(Math.abs(front.t - (NOW + 30 * HOUR)) <= 2 * HOUR, `timed ${(front.t - NOW) / HOUR} h from now`);
    assert.ok(Math.abs(front.changeF + 15) < 0.5);
});

test('a warm front is the same thing the other way, and a small change is neither', () => {
    const [front] = detectFronts(air(step(20, 12)));
    assert.equal(front.kind, 'warm');
    assert.ok(Math.abs(front.t - (NOW + 20 * HOUR)) <= 2 * HOUR);
    assert.deepEqual(detectFronts(air(step(20, 6))), []);
    assert.deepEqual(detectFronts(air(step(20, -6))), []);
});

test('air that cools over half a day is one front, timed inside the cooling', () => {
    const ramp = (h) => -16 * Math.min(1, Math.max(0, (h - 24) / 12));
    const fronts = detectFronts(air(ramp));
    assert.equal(fronts.length, 1);
    assert.equal(fronts[0].kind, 'cold');
    assert.ok(fronts[0].t >= NOW + 22 * HOUR && fronts[0].t <= NOW + 38 * HOUR);
});

test('a front that went through yesterday, and one near the end of the forecast, are both found', () => {
    const fronts = detectFronts(air((h) => step(-20, -12)(h) + step(92, -14)(h)));
    assert.deepEqual(fronts.map((front) => front.kind), ['cold', 'cold']);
    assert.ok(Math.abs(fronts[0].t - (NOW - 20 * HOUR)) <= 2 * HOUR);
    assert.ok(Math.abs(fronts[1].t - (NOW + 92 * HOUR)) <= 2 * HOUR);
});

test('a cold front and the warm-up after it are two fronts', () => {
    const fronts = detectFronts(air((h) => step(10, -14)(h) + step(60, 14)(h)));
    assert.deepEqual(fronts.map((front) => front.kind), ['cold', 'warm']);
});

test('frontAt: approaching for most of a day before a front, passed for a day or two after a cold one', () => {
    const t = NOW + 30 * HOUR;
    const fronts = [{ kind: 'cold', t, changeF: -15 }];
    assert.equal(frontAt(fronts, t - (FRONT_AHEAD_HOURS + 1) * HOUR), null);
    assert.deepEqual(frontAt(fronts, t - 6 * HOUR), { state: 'approaching', kind: 'cold', t, changeF: -15 });
    assert.equal(frontAt(fronts, t + 2 * HOUR).state, 'passed');
    assert.equal(frontAt(fronts, t + (FRONT_BEHIND_HOURS - 1) * HOUR).state, 'passed');
    assert.equal(frontAt(fronts, t + FRONT_BEHIND_HOURS * HOUR), null);
    assert.equal(frontAt([], t), null);
    assert.equal(frontAt(null, t), null);
    // Between two fronts, the nearer one counts.
    const two = [{ kind: 'cold', t: NOW, changeF: -10 }, { kind: 'warm', t: NOW + 30 * HOUR, changeF: 10 }];
    assert.equal(frontAt(two, NOW + 5 * HOUR).kind, 'cold');
    assert.equal(frontAt(two, NOW + 25 * HOUR).kind, 'warm');
});

// ---------------------------------------------------------------------------
// From observations and the forecast as the app holds them
// ---------------------------------------------------------------------------

const hourlyPeriods = (tempAt, extra = () => ({})) => Array.from({ length: 108 }, (_, i) => ({
    startTime: new Date(NOW + i * HOUR).toISOString(),
    endTime: new Date(NOW + (i + 1) * HOUR).toISOString(),
    temperature: Math.round(tempAt(i)),
    temperatureUnit: 'F',
    probabilityOfPrecipitation: { value: 0 },
    windSpeed: '10 mph',
    shortForecast: 'Sunny',
    icon: 'https://api.weather.gov/icons/land/day/skc?size=small',
    ...extra(i),
}));

test('airSeries joins the station to the forecast, taking out the gap between them', () => {
    const observed = air().filter((point) => point.t <= NOW);
    // The forecast cell runs 9°F colder than the station (a lake up the hill): not a front.
    const outlook = outlookFrom(hourlyPeriods((i) => 51 + daily(NOW + i * HOUR)), []);
    const series = airSeries(observed, outlook, NOW);
    assert.equal(series.filter((point) => point.t === NOW).length, 1);
    assert.ok(Math.abs(series.find((point) => point.t === NOW + 5 * HOUR).v - (60 + daily(NOW + 5 * HOUR))) < 1);
    assert.deepEqual(detectFronts(series), []);
    // A real front in the forecast still shows.
    const cold = outlookFrom(hourlyPeriods((i) => 51 + daily(NOW + i * HOUR) - (i >= 28 ? 14 : 0)), []);
    const [front] = detectFronts(airSeries(observed, cold, NOW));
    assert.equal(front.kind, 'cold');
    assert.ok(Math.abs(front.t - (NOW + 28 * HOUR)) <= 2 * HOUR);
});

test('without an hour-by-hour forecast only the fronts already through can be told', () => {
    const observed = air(step(-20, -12)).filter((point) => point.t <= NOW);
    const halfDays = [{ startTime: new Date(NOW).toISOString(), endTime: new Date(NOW + 12 * HOUR).toISOString(), temperature: 40, shortForecast: 'Sunny', windSpeed: '5 mph' }];
    const series = airSeries(observed, outlookFrom(null, halfDays), NOW);
    assert.equal(series[series.length - 1].t, NOW);
    assert.deepEqual(detectFronts(series).map((front) => front.kind), ['cold']);
    assert.deepEqual(detectFronts(airSeries([], [], NOW)), []);
});

test('rainAhead: the next spell of likely rain, when it is dry now', () => {
    const rain = (from, to, more = {}) => (i) => (i >= from && i < to
        ? { shortForecast: 'Rain', icon: 'https://api.weather.gov/icons/land/day/rain,80?size=small', probabilityOfPrecipitation: { value: 80 }, ...more }
        : {});
    const spell = rainAhead(outlookFrom(hourlyPeriods(() => 60, rain(6, 11)), []), NOW + 10 * 60_000);
    assert.deepEqual(spell, { start: NOW + 6 * HOUR, end: NOW + 11 * HOUR, storm: null, snow: false });

    assert.equal(rainAhead(outlookFrom(hourlyPeriods(() => 60), []), NOW), null); // dry all the way
    assert.equal(rainAhead(outlookFrom(hourlyPeriods(() => 60, rain(0, 5)), []), NOW), null); // raining now: not on the way
    assert.equal(rainAhead(outlookFrom(hourlyPeriods(() => 60, rain(60, 70)), []), NOW), null); // too far off to say
    // A slight chance of rain is not rain on the way.
    const slight = (i) => (i >= 6 && i < 11 ? { shortForecast: 'Slight Chance Rain Showers', icon: 'https://api.weather.gov/icons/land/day/rain_showers,20?size=small', probabilityOfPrecipitation: { value: 20 } } : {});
    assert.equal(rainAhead(outlookFrom(hourlyPeriods(() => 60, slight), []), NOW), null);
    // Likely thunderstorms and snow are named for what they are.
    const storms = rain(6, 9, { shortForecast: 'Showers And Thunderstorms', icon: 'https://api.weather.gov/icons/land/day/tsra,80?size=small' });
    assert.equal(rainAhead(outlookFrom(hourlyPeriods(() => 60, storms), []), NOW).storm, NOW + 6 * HOUR);
    // Days of rain with a few hours of thunder late on: the storms are timed, not the whole spell.
    const lateStorms = (i) => (i >= 30 && i < 33 ? storms(7) : rain(6, 40)(i));
    assert.deepEqual(rainAhead(outlookFrom(hourlyPeriods(() => 60, lateStorms), []), NOW),
        { start: NOW + 6 * HOUR, end: NOW + 40 * HOUR, storm: NOW + 30 * HOUR, snow: false });
    const snow = rain(6, 9, { shortForecast: 'Snow', icon: 'https://api.weather.gov/icons/land/day/snow,80?size=small' });
    assert.equal(rainAhead(outlookFrom(hourlyPeriods(() => 30, snow), []), NOW).snow, true);
    assert.equal(rainAhead(null, NOW), null);
});

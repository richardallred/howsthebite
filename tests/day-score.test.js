import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hazardAt } from '../js/core/alerts.js';
import { bestStretch, dayParts, stretchOf } from '../js/core/day-score.js';
import { HOUR_MS } from '../js/core/util.js';

const day = (scores, pastHours = 0) => scores.map((score, i) => (i < pastHours ? { t: i * HOUR_MS, past: true } : { t: i * HOUR_MS, score }));

test('a day is scored by its best two hours still to come, the earliest winning a tie', () => {
    const hours = day([90, 90, 40, 70, 80, 75, 30, 80, 75]);
    assert.deepEqual(bestStretch(hours), { start: 0, end: 2 * HOUR_MS, score: 90, top: hours[0] });
    // Hours gone by do not count, and a single spike does not beat two good hours.
    const later = day([90, 90, 40, 95, 20, 80, 82], 2);
    assert.equal(bestStretch(later).score, 81);
    assert.equal(bestStretch(later).start, 5 * HOUR_MS);
    // One hour left: that hour is the day.
    assert.equal(bestStretch(day([50, 60, 70], 2)).score, 70);
    assert.equal(bestStretch(day([50, 60], 2)), null);
});

test('a stretch averages the hours whose middle falls inside it, leaving out those gone by', () => {
    const hours = day([10, 20, 30, 40, 50], 1);
    const stretch = stretchOf(hours, 0, 3 * HOUR_MS);
    assert.equal(stretch.score, 25); // 20 and 30; the first hour has passed
    assert.equal(stretch.top.score, 30);
    assert.equal(stretchOf(hours, 0, HOUR_MS), null);
});

test('the parts of a day follow the sun, and the clock where it does not rise or set', () => {
    const start = 0;
    const end = 24 * HOUR_MS;
    const parts = dayParts({ start, end, sunrise: 6 * HOUR_MS, sunset: 20 * HOUR_MS });
    assert.deepEqual(parts.map((part) => part.id), ['dawn', 'morning', 'afternoon', 'dusk', 'night']);
    assert.deepEqual(parts.map((part) => part.start / HOUR_MS), [5, 7.5, 13, 18.5, 21]);
    assert.equal(parts[4].end, end);
    // A short winter day has no room for morning and afternoon.
    assert.deepEqual(dayParts({ start, end, sunrise: 10 * HOUR_MS, sunset: 13 * HOUR_MS }).map((part) => part.id), ['dawn', 'dusk', 'night']);
    assert.deepEqual(dayParts({ start, end }).map((part) => part.start / HOUR_MS), [5, 8, 12, 17, 20]);
});

test('a warning caps only the hours it is in effect, and an open-ended one only for a few hours', () => {
    const now = 100 * HOUR_MS;
    const items = [
        { event: 'Lake Wind Advisory', level: 'caution', onset: null, ends: null },
        { event: 'Severe Thunderstorm Warning', level: 'danger', onset: now + HOUR_MS, ends: now + 3 * HOUR_MS },
    ];
    assert.equal(hazardAt(items, now, now), null);
    assert.equal(hazardAt(items, now + 2 * HOUR_MS, now), 'Severe Thunderstorm Warning');
    assert.equal(hazardAt(items, now + 3 * HOUR_MS, now), null);
    const open = [{ event: 'Tornado Warning', level: 'danger', onset: null, ends: null }];
    assert.equal(hazardAt(open, now + 2 * HOUR_MS, now), 'Tornado Warning');
    assert.equal(hazardAt(open, now + 4 * HOUR_MS, now), null);
});

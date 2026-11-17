import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pointTime, spanWords, timeTicks } from '../js/ui/charts.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TZ = 'America/Chicago';
const END = Date.parse('2026-06-15T15:00:00Z'); // 10:00 in Chicago, a Monday

test('two days get midnight and noon ticks', () => {
    const ticks = timeTicks(END - 48 * HOUR, END, TZ);
    assert.deepEqual(ticks.map((t) => t.label), ['noon', 'Sun', 'noon', 'Mon']);
});

test('a week gets one tick a day, at local midnight', () => {
    const ticks = timeTicks(END - 7 * DAY, END, TZ);
    assert.equal(ticks.length, 7);
    assert.ok(ticks.every((t) => t.major && !t.label.includes('noon')));
    assert.equal(new Date(ticks[0].t).toISOString(), '2026-06-09T05:00:00.000Z'); // midnight CDT
});

test('a month gets about weekly dates, a year the months', () => {
    assert.deepEqual(timeTicks(END - 30 * DAY, END, TZ).map((t) => t.label), ['May 22', 'Jun 1', 'Jun 8', 'Jun 15']);
    const months = timeTicks(END - 365 * DAY, END, TZ).map((t) => t.label);
    assert.equal(months.length, 12);
    assert.equal(months[0], 'Jul');
    assert.equal(months.at(-1), 'Jun');
});

test('windows and times are put in words that suit them', () => {
    assert.equal(spanWords(48 * HOUR), '48 hours');
    assert.equal(spanWords(7 * DAY), '7 days');
    assert.equal(spanWords(364 * DAY), 'year');
    assert.equal(pointTime(END, TZ, { span: 48 * HOUR }), 'Mon 10:00 AM');
    assert.equal(pointTime(END, TZ, { span: 7 * DAY }), 'Jun 15, 10:00 AM');
    // Daily means are dated by the day USGS gave, not shifted by the time zone.
    assert.equal(pointTime(Date.parse('2026-06-14T12:00:00Z'), 'Pacific/Guam', { daily: true }), 'Sun, Jun 14');
});

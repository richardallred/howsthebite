// The conditions in a sentence (js/core/summary.js): under the place's name and in search results.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { conditionsSummary } from '../js/core/summary.js';

const BASE = {
    name: 'Kentucky Lake, Kentucky',
    dateText: 'Sunday, November 23',
    score: 82,
    band: 'Excellent',
    bestHours: '3–5 PM',
    waterTempF: 57.68,
    measured: true,
    trend: 'Down 6.5°F in 14 days',
};

test('a sensor reading with a trend: the rating, the best hours and the water', () => {
    const { lede, description } = conditionsSummary(BASE);
    assert.equal(lede, 'Excellent fishing today, best 3–5 PM. Water 57.7°F, down 6.5°F in 14 days.');
    assert.equal(description, 'Kentucky Lake, Kentucky fishing forecast for Sunday, November 23: excellent, 82 out of 100, best 3–5 PM. '
        + 'Water temperature 57.7°F, down 6.5°F in 14 days. With the wind, the weather and what to throw.');
});

test('the part a search result shows carries the place, the date, the score and the water', () => {
    const { description } = conditionsSummary({ ...BASE, name: 'Susquehanna River at Harrisburg, Pennsylvania' });
    const shown = description.slice(0, 160);
    for (const part of ['Susquehanna River at Harrisburg, Pennsylvania', 'November 23', '82 out of 100', 'Water temperature 57.7°F']) {
        assert.ok(shown.includes(part), `${part} is past what a search result shows: ${shown}`);
    }
});

test('an estimated water temperature is rounded, said to be an estimate, and given no trend', () => {
    const { lede, description } = conditionsSummary({ ...BASE, waterTempF: 51.6, measured: false });
    assert.equal(lede, 'Excellent fishing today, best 3–5 PM. Water about 52°F, estimated from the air.');
    assert.match(description, /Water temperature about 52°F, estimated from the air\./);
    assert.doesNotMatch(description, /Down|down/);
});

test('a sensor that is not on the place\'s own water is said to be nearby, with no trend claimed for the place', () => {
    const { lede, description } = conditionsSummary({ ...BASE, waterTempF: 57.4, sensorMiles: 58.5 });
    assert.equal(lede, 'Excellent fishing today, best 3–5 PM. The nearest water sensor, 59 miles away, reads 57.4°F.');
    assert.match(description, /best 3–5 PM\. The nearest water sensor, 59 miles away, reads 57\.4°F\. With/);
    assert.doesNotMatch(description, /Water temperature 57/);
    // Close by, it is the place's water; a mile is a mile.
    assert.match(conditionsSummary({ ...BASE, sensorMiles: 2.4 }).lede, /Water 57\.7°F, down 6\.5°F in 14 days\.$/);
    assert.match(conditionsSummary({ ...BASE, sensorMiles: 3.2, trend: null }).lede, /The nearest water sensor, 3 miles away, reads 57\.7°F\.$/);
});

test('a sensor with no trend yet gives the reading alone', () => {
    assert.equal(conditionsSummary({ ...BASE, trend: null }).lede, 'Excellent fishing today, best 3–5 PM. Water 57.7°F.');
});

test('a day held down throughout has no best hours to name', () => {
    const { lede, description } = conditionsSummary({ ...BASE, score: 22, band: 'Very poor', flat: true });
    assert.equal(lede, 'Very poor fishing today, much the same all day. Water 57.7°F, down 6.5°F in 14 days.');
    assert.match(description, /: very poor, 22 out of 100, much the same all day\./);
});

test('late in the day, with no hours left to pick from, it speaks of now', () => {
    const { lede, description } = conditionsSummary({ ...BASE, bestHours: null });
    assert.equal(lede, 'Excellent fishing right now. Water 57.7°F, down 6.5°F in 14 days.');
    assert.match(description, /: excellent, 82 out of 100\. Water/);
});

test('with no place to name and no water reading it still makes a sentence', () => {
    const { lede, description } = conditionsSummary({ ...BASE, name: null, waterTempF: null });
    assert.equal(lede, 'Excellent fishing today, best 3–5 PM.');
    assert.equal(description, 'Fishing forecast for Sunday, November 23: excellent, 82 out of 100, best 3–5 PM. With the wind, the weather and what to throw.');
});

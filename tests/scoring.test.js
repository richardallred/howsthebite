import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    FACTOR_MAX, bandFor, bitePhrase, estimateWaterTemp, scoreAirTemp, scoreConditions,
    scoreMoon, scorePressure, scoreSky, scoreWaterTemp, scoreWind,
} from '../js/core/scoring.js';

const FULL_MOON = new Date(Date.UTC(2000, 0, 21, 4, 40));

const ideal = {
    airTempF: 70,
    waterTempF: 70,
    pressureInHg: 30.1,
    pressureChange3h: -0.04,
    windMph: 10,
    sky: 'clear',
    date: FULL_MOON,
};

test('factor maximums add up to 100', () => {
    assert.equal(Object.values(FACTOR_MAX).reduce((a, b) => a + b, 0), 100);
});

test('ideal conditions score 100 and terrible conditions score near zero', () => {
    assert.equal(scoreConditions(ideal).score, 100);

    const awful = scoreConditions({
        airTempF: 10, waterTempF: 33, waterEstimated: true, pressureInHg: 30.9,
        pressureChange3h: 0.1, windMph: 35, sky: 'storm',
        date: new Date(FULL_MOON.getTime() + 7.38 * 86400000), // last quarter
    });
    assert.ok(awful.score <= 10, `expected <= 10, got ${awful.score}`);
    assert.equal(awful.band.key, 'terrible');
});

test('no factor exceeds its maximum or drops below zero', () => {
    const temps = [-20, 33, 45, 58, 66, 70, 80, 92, 110];
    const deltas = [null, -15, -3, -0.5, 0, 0.5, 3, 15];
    for (const t of temps) {
        for (const d of deltas) {
            for (const result of [scoreWaterTemp(t, { change24h: d }), scoreAirTemp(t, { change24h: d })]) {
                assert.ok(result.points >= 0);
            }
            assert.ok(scoreWaterTemp(t, { change24h: d }).points <= FACTOR_MAX.water);
            assert.ok(scoreAirTemp(t, { change24h: d }).points <= FACTOR_MAX.air);
        }
    }
    for (const p of [28.5, 29.6, 29.85, 30.1, 30.35, 30.6, 31.2]) {
        for (const d of [null, -0.2, -0.04, 0, 0.04, 0.2]) {
            const { points } = scorePressure(p, { change3h: d });
            assert.ok(points >= 0 && points <= FACTOR_MAX.pressure);
        }
    }
});

test('slowly falling pressure beats steady, which beats rising fast', () => {
    const falling = scorePressure(30.1, { change3h: -0.04 }).points;
    const steady = scorePressure(30.1, { change3h: 0.005 }).points;
    const risingFast = scorePressure(30.1, { change3h: 0.09 }).points;
    assert.ok(falling > steady && steady > risingFast);
    assert.equal(falling, FACTOR_MAX.pressure);
});

test('pressure trend text reports the real change in inHg', () => {
    assert.match(scorePressure(30.1, { change3h: -0.04 }).trend, /Falling · −0\.04 inHg in 3 hr/);
    assert.match(scorePressure(30.1, { change3h: 0 }).trend, /Steady/);
    assert.equal(scorePressure(30.1, {}).trend, null);
});

test('a missing barometer scores as neutral instead of failing', () => {
    const result = scorePressure(null, { change3h: null });
    assert.equal(result.points, 9);
    assert.match(result.note, /No barometer/);
    assert.equal(scoreConditions({ ...ideal, pressureInHg: null, pressureChange3h: null }).score, 91);
});

test('estimated water temperature gets no trend bonus and is labelled', () => {
    const real = scoreWaterTemp(60, { change24h: 0.2 });
    const estimated = scoreWaterTemp(60, { estimated: true, change24h: 0.2 });
    assert.equal(real.points, 18);
    assert.equal(estimated.points, 16);
    assert.match(estimated.note, /estimated/);
    assert.equal(estimated.trend, null);
});

test('wind bands', () => {
    assert.equal(scoreWind(10).points, 17);
    assert.equal(scoreWind(6).points, 13);
    assert.equal(scoreWind(18).points, 8);
    assert.equal(scoreWind(2).points, 4);
    assert.equal(scoreWind(23).points, 4);
    assert.equal(scoreWind(0.5).points, 0);
    assert.equal(scoreWind(30).points, 0);
});

test('sky score by sky class', () => {
    assert.equal(scoreSky('clear').points, 15);
    assert.equal(scoreSky('partly').points, 12);
    assert.equal(scoreSky('overcast').points, 8);
    assert.equal(scoreSky('light-precip').points, 4);
    assert.equal(scoreSky('precip').points, 2);
    assert.equal(scoreSky('storm').points, 0);
    assert.equal(scoreSky('unknown').points, 8); // unknown is neutral
    assert.equal(scoreSky(undefined).points, 8);
});

test('moon scores highest at new/full and lowest at the quarters', () => {
    const quarter = new Date(FULL_MOON.getTime() + 7.38 * 86400000);
    assert.equal(scoreMoon(FULL_MOON).points, 15);
    assert.ok(scoreMoon(quarter).points <= 6);
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

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseInterval, parseSurfFeet, parseWaterTempF, parseWaveGrid, waveHeightAt } from '../js/api/coast-api.js';
import {
    FACTOR_WEIGHTS, HAZARD_CAP, bestWindows, scoreConditions, scoreLight, scoreTide, scoreWaterTemp, scoreWaves, temperatureZone,
} from '../js/core/scoring.js';
import { SALT_FISH, SALT_GROUP_IDS, saltSpeciesOptions } from '../js/core/species.js';
import { tideAt, tideCurve, upcomingTides } from '../js/core/tides.js';

const HOUR = 3600_000;
const T0 = Date.UTC(2026, 5, 15, 6); // a low tide; then a high every 12 h, a low in between
const TIDES = Array.from({ length: 12 }, (_, i) => ({ t: T0 + i * 6 * HOUR, heightFt: i % 2 ? 5 : 1, type: i % 2 ? 'H' : 'L' }));
const CHARLESTON = { lat: 32.78, lon: -79.93 };

const inshore = {
    mode: 'inshore', ...CHARLESTON, speciesGroup: 'warmsalt', waterTempF: 76, pressureInHg: 30, pressureChange3h: 0,
    windMph: 8, sky: 'partly', tides: TIDES, date: new Date(T0 + 9 * HOUR), // mid-way down the ebb, late morning
};
const points = (result, id) => result.factors.find((factor) => factor.id === id)?.points;

// --- Tide maths ----------------------------------------------------------------

test('tide height follows a cosine between a low and the next high', () => {
    const low = tideAt(TIDES, T0);
    assert.equal(low.heightFt, 1);
    assert.equal(low.movement, 0);
    assert.equal(low.slack, true);

    const mid = tideAt(TIDES, T0 + 3 * HOUR);
    assert.ok(Math.abs(mid.heightFt - 3) < 1e-9);
    assert.equal(mid.direction, 'rising');
    assert.ok(Math.abs(mid.movement - 1) < 1e-9);
    assert.equal(mid.slack, false);
    assert.equal(mid.next.type, 'H');

    const ebbing = tideAt(TIDES, T0 + 7 * HOUR);
    assert.equal(ebbing.direction, 'falling');
    assert.ok(ebbing.heightFt < 5 && ebbing.heightFt > 4);
});

test('times outside the predictions give no tide rather than a guess', () => {
    assert.equal(tideAt(TIDES, T0 - HOUR), null);
    assert.equal(tideAt(TIDES, TIDES.at(-1).t + HOUR), null);
    assert.equal(tideAt(null, T0), null);
    assert.equal(tideAt([], T0), null);
});

test('tide curve and upcoming tides', () => {
    const curve = tideCurve(TIDES, T0, T0 + 12 * HOUR, 60);
    assert.equal(curve.length, 13);
    assert.ok(Math.abs(Math.max(...curve.map((point) => point.v)) - 5) < 1e-9);
    assert.deepEqual(upcomingTides(TIDES, T0 + HOUR, 2).map((tide) => tide.type), ['H', 'L']);
});

// --- Salt-water factors --------------------------------------------------------

test('each style of fishing has weights that add up to 100', () => {
    for (const [mode, weights] of Object.entries(FACTOR_WEIGHTS)) {
        assert.equal(Object.values(weights).reduce((a, b) => a + b, 0), 100, mode);
    }
});

test('tide: running water scores full marks, slack scores least, direction does not matter', () => {
    const flood = scoreTide(TIDES, T0 + 3 * HOUR);
    const ebb = scoreTide(TIDES, T0 + 9 * HOUR);
    const slackHigh = scoreTide(TIDES, T0 + 6 * HOUR);
    const slackLow = scoreTide(TIDES, T0 + 12 * HOUR);
    assert.equal(flood.share, 1);
    assert.equal(ebb.share, 1);
    assert.match(flood.note, /Incoming tide at full flow/);
    assert.match(ebb.note, /Outgoing tide at full flow/);
    assert.ok(Math.abs(slackHigh.share - 0.4) < 1e-9);
    assert.match(slackHigh.note, /Slack water at high tide/);
    assert.match(slackLow.note, /Slack water at low tide/);
    assert.equal(scoreTide(null, T0), null);
});

test('waves: flat costs almost nothing, heavy surf nearly everything', () => {
    assert.ok(scoreWaves(0).share >= 0.9);
    assert.equal(scoreWaves(2).share, 1);
    assert.ok(scoreWaves(5).share < 0.6);
    assert.ok(scoreWaves(9).share < 0.1);
    assert.match(scoreWaves(9).note, /Dangerous surf/);
    assert.equal(scoreWaves(null), null);
});

test('salt-water temperature curves follow the measured thresholds', () => {
    // Snook stop feeding near 58°F; pompano avoid water under 68°F.
    assert.ok(scoreWaterTemp(57, { group: 'tropical' }).share < 0.15);
    assert.match(scoreWaterTemp(57, { group: 'tropical' }).note, /shut snook down/);
    assert.equal(scoreWaterTemp(80, { group: 'tropical' }).share, 1);
    // Red drum feed poorly under 60°F; seatrout are cold-stunned under 45°F.
    assert.equal(scoreWaterTemp(72, { group: 'warmsalt' }).share, 1);
    assert.ok(scoreWaterTemp(55, { group: 'warmsalt' }).share < 0.5);
    assert.match(scoreWaterTemp(44, { group: 'warmsalt' }).note, /Cold-stun range for seatrout/);
    // Large striped bass avoid water above 77°F.
    assert.equal(scoreWaterTemp(60, { group: 'coolsalt' }).share, 1);
    assert.ok(scoreWaterTemp(78, { group: 'coolsalt' }).share <= 0.3);
    // Surfperch bite all year: cold costs little on the southern Pacific coast.
    assert.ok(scoreWaterTemp(55, { group: 'pacwarm' }).share >= 0.7);
    assert.equal(scoreWaterTemp(52, { group: 'paccold' }).share, 1);
    assert.equal(temperatureZone(57, 'tropical'), 'cold');
    assert.equal(temperatureZone(60, 'coolsalt'), 'prime');
});

test('salt-water light: dawn and dusk equal, night about as good as day', () => {
    const light = (hourUtc, water) => scoreLight({ time: Date.UTC(2026, 5, 15, hourUtc), ...CHARLESTON, sky: 'clear', water });
    // Charleston in June: sunrise about 10:10 UTC, sunset about 00:30 UTC, solar noon about 17:20 UTC.
    const [dawn, noon, dusk, night] = [light(10.5, 'salt'), light(17, 'salt'), light(24.2, 'salt'), light(5, 'salt')];
    assert.equal(dawn.share, 1);
    assert.equal(dusk.share, 1);
    assert.ok(Math.abs(night.share - noon.share) <= 0.1);
    assert.ok(night.share > light(5, 'fresh').share); // night is not marked down the way it is in fresh water
    assert.match(night.note, /about as good as daytime/);
});

// --- Overall -------------------------------------------------------------------

test('inshore: the factors, and a slack tide costing about a sixth of the score', () => {
    const running = scoreConditions(inshore);
    assert.deepEqual(running.factors.map((factor) => factor.id), ['water', 'tide', 'light', 'wind', 'pressure']);
    assert.equal(points(running, 'tide'), FACTOR_WEIGHTS.inshore.tide);
    assert.equal(running.available, 100);

    const slack = scoreConditions({ ...inshore, date: new Date(T0 + 12 * HOUR) });
    assert.ok(running.score - slack.score >= 12 && running.score - slack.score <= 22, `${running.score} vs ${slack.score}`);
});

test('surf: wave height is a factor and a limiting one', () => {
    const base = { ...inshore, mode: 'surf' };
    const fair = scoreConditions({ ...base, waveFt: 2 });
    assert.deepEqual(fair.factors.map((factor) => factor.id), ['water', 'waves', 'tide', 'light', 'wind', 'pressure']);
    assert.equal(points(fair, 'waves'), FACTOR_WEIGHTS.surf.waves);

    const heavy = scoreConditions({ ...base, waveFt: 9 });
    assert.ok(heavy.score < 25);
    assert.equal(heavy.cap.reason, 'Held down by the surf');

    // Unknown wave height is left out, and the rest rescaled.
    const unknown = scoreConditions(base);
    assert.equal(unknown.available, 100 - FACTOR_WEIGHTS.surf.waves);
    assert.ok(Math.abs(unknown.score - fair.score) <= 4);
});

test('without tide predictions the tide is left out, and salt water has no flow or moon factor', () => {
    const result = scoreConditions({ ...inshore, tides: null, flow: { cfs: 9000, percentiles: { 5: 1, 10: 2, 25: 3, 50: 4, 75: 5, 90: 6, 95: 7 } } });
    assert.deepEqual(result.factors.map((factor) => factor.id), ['water', 'light', 'wind', 'pressure']);
    assert.equal(result.available, 100 - FACTOR_WEIGHTS.inshore.tide);
});

test('storms cap a salt-water score too', () => {
    assert.equal(scoreConditions({ ...inshore, sky: 'storm' }).score, HAZARD_CAP);
});

test('best windows in salt water need moving water as well as low light', () => {
    const windows = bestWindows(inshore, { start: T0 + 9 * HOUR, hours: 36 });
    assert.ok(windows.length >= 1);
    for (const window of windows) {
        const middle = tideAt(TIDES, (window.start + window.end) / 2);
        assert.ok(middle.movement > 0.5, 'a window should not sit on slack water');
    }
});

// --- Regional salt-water fish --------------------------------------------------

const KEY = Object.fromEntries(SALT_FISH.map((fish) => [fish.name, fish.key]));
const counts = (byName) => Object.fromEntries(Object.entries(byName).map(([name, count]) => [KEY[name], count]));
const labels = (byName, mode, lat, lon) => saltSpeciesOptions(byName && counts(byName), mode, lat, lon).map((option) => option.label);

test('every salt-water fish has a known group and at least one style of fishing', () => {
    for (const fish of SALT_FISH) {
        assert.ok(SALT_GROUP_IDS.includes(fish.group));
        assert.ok(fish.modes.length > 0 && fish.modes.every((mode) => mode === 'inshore' || mode === 'surf'));
    }
});

test('the fish offered depend on the coast and on the style of fishing', () => {
    const gulf = { redfish: 220, seatrout: 180, flounder: 60, snook: 40, tarpon: 15, whiting: 90, pompano: 30 };
    assert.deepEqual(labels(gulf, 'inshore', 27.8, -82.6), ['Redfish & seatrout', 'Snook & tarpon']);
    assert.deepEqual(labels(gulf, 'surf', 27.8, -82.6), ['Redfish & whiting', 'Pompano']);

    const northeast = { striper: 900, bluefish: 400, fluke: 250, weakfish: 40 };
    assert.deepEqual(labels(northeast, 'inshore', 41.05, -71.86), ['Striped bass & bluefish']);
});

test('reservoir striped bass do not create a salt-water fishery in the South', () => {
    // 400 striped bass records around Galveston are inland; a few bluefish do not qualify the group either.
    assert.deepEqual(labels({ redfish: 220, seatrout: 180, striper: 400, bluefish: 3 }, 'inshore', 29.3, -94.8), ['Redfish & seatrout']);
    // North of Cape Lookout they run in salt water and count.
    assert.deepEqual(labels({ redfish: 220, seatrout: 180, striper: 500 }, 'inshore', 35.96, -75.62), ['Striped bass', 'Redfish & seatrout']);
});

test('Pacific and Atlantic fish stay on their own coasts', () => {
    const mixed = { halibut: 80, surfperch: 60, redfish: 60, snook: 50, salmon: 70, rockfish: 40 };
    assert.deepEqual(labels(mixed, 'inshore', 34.0, -118.5), ['Halibut']); // no redfish or snook in California; too far south for the cold group
    assert.deepEqual(labels(mixed, 'inshore', 44.6, -124.05), ['Salmon & rockfish']);
    assert.deepEqual(labels(mixed, 'inshore', 27.8, -82.6), ['Redfish', 'Snook']);
});

test('with too few records the coast decides, and Hawaii gets no borrowed mainland fish', () => {
    assert.deepEqual(labels(null, 'inshore', 29.3, -94.8), ['Redfish & seatrout', 'Snook & tarpon']);
    assert.deepEqual(labels(null, 'surf', 29.3, -94.8), ['Redfish & whiting', 'Pompano']);
    assert.deepEqual(labels({ redfish: 3 }, 'inshore', 41, -72), ['Striped bass & bluefish']);
    assert.deepEqual(labels(null, 'surf', 34, -118.5), ['Halibut & surfperch']);
    assert.deepEqual(labels(null, 'surf', 44.6, -124), ['Surfperch']);
    const hawaii = saltSpeciesOptions(null, 'inshore', 21.3, -157.86);
    assert.deepEqual(hawaii, [{ id: 'tropical', label: 'Reef & shore fish', targets: [] }]);
});

// --- Reading the coastal services ----------------------------------------------

test('surf heights and water temperatures are read out of forecast wording', () => {
    assert.equal(parseSurfFeet('2 to 3 feet.'), 3);
    assert.equal(parseSurfFeet('Around 2 feet'), 2);
    assert.equal(parseSurfFeet('1 foot or less'), 1);
    assert.equal(parseSurfFeet('4 to 7 feet.'), 7);
    assert.equal(parseSurfFeet('No Surf Zone Forecast issued for this area.'), null);
    assert.equal(parseSurfFeet(null), null);

    assert.equal(parseWaterTempF('in the upper 70s'), 78);
    assert.equal(parseWaterTempF('in the mid 60s'), 65);
    assert.equal(parseWaterTempF('lower 50s'), 52);
    assert.equal(parseWaterTempF('around 72 degrees'), 72);
    assert.equal(parseWaterTempF(null), null);
    assert.equal(parseWaterTempF('N/A'), null);
});

test('forecast intervals and wave grids', () => {
    const start = Date.UTC(2026, 10, 13, 10);
    assert.deepEqual(parseInterval('2026-11-13T10:00:00+00:00/PT4H'), [start, start + 4 * HOUR]);
    assert.deepEqual(parseInterval('2026-11-13T10:00:00+00:00/P1DT6H'), [start, start + 30 * HOUR]);
    assert.equal(parseInterval('nonsense'), null);

    const cell = (elevation, metres) => ({
        properties: {
            elevation: { value: elevation },
            waveHeight: { values: metres.map((value, i) => ({ validTime: `${new Date(start + i * 6 * HOUR).toISOString().slice(0, 19)}+00:00/PT6H`, value })) },
        },
    });
    const sea = parseWaveGrid(cell(0, [0.61, 0.91, 1.22, 0.91]));
    assert.equal(sea.length, 4);
    assert.ok(Math.abs(sea[0].heightFt - 2) < 0.01);
    assert.ok(Math.abs(waveHeightAt(sea, start + 13 * HOUR) - 4) < 0.01);
    assert.equal(waveHeightAt(sea, start + 100 * HOUR), null);
    // A land cell carries zeros for the whole week: that is "no data", not a calm sea.
    assert.deepEqual(parseWaveGrid(cell(7, [0, 0, 0, 0])), []);
    assert.deepEqual(parseWaveGrid(cell(0, [0, 0, 0, 0])), []);
    assert.deepEqual(parseWaveGrid({}), []);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { scoreWaterTemp } from '../js/core/scoring.js';
import { SPORT_FISH, chooseSpecies, regionalSpecies, speciesOptions } from '../js/core/species.js';

const KEY = {
    largemouth: 2394563, bluegill: 2394503, catfish: 5202520,
    walleye: 2382172, pike: 2346633, muskie: 2346634, smallmouth: 5211250, perch: 2382004, sauger: 2382152,
    rainbow: 5204019, brown: 8215487, coho: 5204034, chinook: 5204024,
};
const counts = (byName) => Object.fromEntries(Object.entries(byName).map(([name, count]) => [KEY[name], count]));
const labels = (byName, lat = 40) => speciesOptions(regionalSpecies(byName && counts(byName), lat)).map((option) => option.label);

test('every listed fish belongs to a known group and has a unique key', () => {
    assert.equal(new Set(SPORT_FISH.map((fish) => fish.key)).size, SPORT_FISH.length);
    for (const fish of SPORT_FISH) assert.ok(['warm', 'cool', 'cold'].includes(fish.group));
    for (const key of Object.values(KEY)) assert.ok(SPORT_FISH.some((fish) => fish.key === key));
});

// The record counts below are real GBIF answers (openly licensed records since 1990) from November 2026.

test('Minneapolis: everything lives there', () => {
    assert.deepEqual(labels({ largemouth: 4495, bluegill: 4089, walleye: 3229, pike: 3562, muskie: 291, smallmouth: 652, perch: 3434, sauger: 146, rainbow: 2232, brown: 2762 }, 44.98),
        ['All species', 'Bass & panfish', 'Walleye & pike', 'Trout']);
});

test('Miami and New Orleans: bass and panfish only, and a few stray records do not change that', () => {
    assert.deepEqual(labels({ largemouth: 335, bluegill: 290, catfish: 43 }, 25.76), ['Bass & panfish']);
    // New Orleans: 2 sauger, 5 smallmouth, 1 perch and 10 trout among 1,400 records.
    assert.deepEqual(labels({ largemouth: 522, bluegill: 353, catfish: 140, sauger: 2, smallmouth: 5, perch: 1, rainbow: 3, brown: 3 }, 29.95),
        ['Bass & panfish']);
});

test('Anchorage: pike, trout and salmon, but no bass', () => {
    assert.deepEqual(labels({ largemouth: 1, pike: 49, rainbow: 96, coho: 97, chinook: 15 }, 61.22),
        ['All species', 'Pike', 'Trout & salmon']);
});

test('the cool-water group is named for the fish actually recorded', () => {
    const warm = { largemouth: 2000, bluegill: 1500 };
    assert.deepEqual(labels({ ...warm, smallmouth: 250, walleye: 23, perch: 6 }, 32.78), ['All species', 'Bass & panfish', 'Smallmouth']); // like Dallas: walleye under a tenth
    assert.deepEqual(labels({ ...warm, perch: 44 }, 32.08), ['All species', 'Bass & panfish', 'Perch']); // Savannah
    assert.deepEqual(labels({ ...warm, walleye: 453, smallmouth: 434, perch: 263, muskie: 8 }, 35.6), ['All species', 'Bass & panfish', 'Walleye & smallmouth']);
    assert.deepEqual(labels({ ...warm, sauger: 32 }, 35.15), ['All species', 'Bass & panfish', 'Sauger']); // Memphis
});

test('one enormous trout survey does not hide the other fish', () => {
    // Bozeman: 2,600 rainbow trout records beside 20 walleye, 5 pike and 14 perch.
    assert.deepEqual(labels({ largemouth: 7, bluegill: 8, walleye: 20, pike: 5, perch: 14, rainbow: 2608, brown: 74 }, 45.68),
        ['All species', 'Bass & panfish', 'Walleye & pike', 'Trout']);
});

test('thinly surveyed country still gets bass, since they live in every state but Alaska', () => {
    // Elko, Nevada: 4 bass records in all.
    assert.ok(labels({ largemouth: 3, bluegill: 1, walleye: 3, smallmouth: 1, pike: 1, rainbow: 21, brown: 2 + 75 }, 40.83).includes('Bass & panfish'));
});

test('too few records, or none: fall back on latitude rather than offering everything', () => {
    assert.equal(regionalSpecies(null, 40).known, false);
    assert.deepEqual(labels(null, 44), ['All species', 'Bass & panfish', 'Walleye & pike', 'Trout']);
    assert.deepEqual(labels(null, 24.56), ['Bass & panfish']); // Key West
    assert.deepEqual(labels({ smallmouth: 5, largemouth: 1 }, 21.31), ['Bass & panfish']); // Honolulu: 6 records
    assert.deepEqual(labels(null, 71.29), ['All species', 'Pike', 'Trout & salmon']); // Utqiagvik
    assert.equal(regionalSpecies(counts({ largemouth: 500, walleye: 100 }), 44).known, true);
});

test('the saved preference is used where it is offered, otherwise the most general choice', () => {
    const north = speciesOptions(regionalSpecies(counts({ largemouth: 400, walleye: 120, pike: 100, rainbow: 150 }), 45));
    assert.equal(chooseSpecies(north, 'cool').id, 'cool');
    assert.equal(chooseSpecies(north, 'any').id, 'any');

    const gulf = speciesOptions(regionalSpecies(counts({ largemouth: 900, bluegill: 700 }), 30));
    assert.deepEqual(chooseSpecies(gulf, 'cool'), { id: 'warm', label: 'Bass & panfish', targets: ['bass', 'panfish', 'catfish'] });
    assert.equal(chooseSpecies(gulf, 'any').id, 'warm');

    const noWalleye = speciesOptions(regionalSpecies(counts({ largemouth: 900, bluegill: 700, rainbow: 96 }), 29.8));
    assert.equal(chooseSpecies(noWalleye, 'cool').id, 'any');
    assert.equal(chooseSpecies(noWalleye, 'cold').id, 'cold');
});

test('the water note names the local fish', () => {
    assert.match(scoreWaterTemp(66, { group: 'cool', label: 'Smallmouth & perch' }).note, /^Prime range for smallmouth & perch$/);
    assert.match(scoreWaterTemp(66, { group: 'cool' }).note, /walleye, pike and smallmouth/);
    assert.match(scoreWaterTemp(68, { group: 'any', label: 'All species' }).note, /most species/);
});

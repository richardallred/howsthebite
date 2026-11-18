import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { lakesNear, nearbyWater, riverName, riversFromStations, saltWaterName, saltWaterNear } from '../js/core/nearby-water.js';

const ASHEVILLE = [35.6, -82.55];

test('lakes: the best-known win over a nearer pond, far ones are left out, at most two', () => {
    const rows = [
        ['Beaver Pond', 35.61, -82.55, 1, 0],
        ['Lake Julian', 35.4753, -82.5369, 2, 0],
        ['Famous Lake', 35.75, -82.55, 40, 0],
        ['Far Lake', 36.2, -82.55, 90, 0],
    ];
    assert.deepEqual(lakesNear(rows, ...ASHEVILLE).map((lake) => lake.name), ['Famous Lake', 'Lake Julian']);
    assert.equal(lakesNear(rows, ...ASHEVILLE)[0].kind, 'lake');
});

test('lakes: a big lake is measured to its edge and placed on the town\'s side of its middle', () => {
    // 1,000 km² is a circle about 11 miles across its radius; its middle is 30 miles north.
    const [lake] = lakesNear([['Big Lake', 36.035, -82.55, 10, 1000]], ...ASHEVILLE);
    assert.ok(lake.miles > 18 && lake.miles < 21, `edge at ${lake.miles} mi`);
    assert.ok(lake.lat < 36.035 && lake.lat > 35.6, 'moved toward the town');
    assert.equal(lake.detail, '247,100 acres');
});

test('river names come from gauge names; a creek gauge named for a street is not a river', () => {
    assert.equal(riverName('French Broad River at Asheville, NC'), 'French Broad River');
    assert.equal(riverName('Pigeon R near Canton, NC'), 'Pigeon River');
    assert.equal(riverName('W F Pigeon R above Lake Logan near Hazelwood, NC'), 'W F Pigeon River');
    assert.equal(riverName('Mississippi River above 37th Ave Ne in Fridley, MN'), 'Mississippi River');
    assert.equal(riverName('Waller Creek at Red River, Austin, TX'), null);
    assert.equal(riverName('Reed Creek at Asheville, NC'), null);
    assert.equal(riverName('Lake Norman near Mooresville, NC'), null);
});

test('rivers: the biggest by flow first, placed at their nearest gauge, creeks and far ones left out', () => {
    const stations = [
        { name: 'Little River near Town', kind: 'river', lat: 35.61, lon: -82.55, flow: { cfs: 12 } },
        { name: 'French Broad River at Marshall, NC', kind: 'river', lat: 35.8, lon: -82.66, flow: { cfs: 2400 } },
        { name: 'French Broad River at Asheville, NC', kind: 'river', lat: 35.61, lon: -82.57, flow: { cfs: 1900 } },
        { name: 'Swannanoa River at Biltmore, NC', kind: 'river', lat: 35.57, lon: -82.54, flow: { cfs: 180 } },
        { name: 'Hominy Creek near West Asheville, NC', kind: 'river', lat: 35.56, lon: -82.6, flow: { cfs: 5000 } },
        { name: 'Pigeon R near Hepco, NC', kind: 'river', lat: 35.9, lon: -83.1, flow: { cfs: 9000 } },
    ];
    const rivers = riversFromStations(stations, ...ASHEVILLE);
    assert.deepEqual(rivers.map((r) => [r.name, r.lat]), [['French Broad River', 35.61], ['Swannanoa River', 35.57]]);
});

test('salt water is named for the bay or sound in a tide station\'s name', () => {
    assert.equal(saltWaterName('Gandy Bridge, Old Tampa Bay'), 'Old Tampa Bay');
    assert.equal(saltWaterName('East Bay, Tampa Bay'), 'Tampa Bay');
    assert.equal(saltWaterName('McKay Bay Entrance'), 'McKay Bay');
    assert.equal(saltWaterName('Galveston Bay Entrance, North Jetty'), 'Galveston Bay');
    assert.equal(saltWaterName('Fort Sumter'), null);
});

test('salt water: the bays with the most tide stations first, each at its nearest, in inshore mode', () => {
    const tides = JSON.parse(readFileSync(new URL('../data/coops-stations.json', import.meta.url)));
    const salt = saltWaterNear(tides, 27.95, -82.46); // Tampa
    assert.equal(salt.length, 2);
    assert.ok(salt.every((water) => water.kind === 'salt' && water.mode === 'inshore' && /Bay$/.test(water.name)));
    assert.deepEqual(saltWaterNear(tides, 39.74, -104.99), []); // Denver
});

test('the bundled lake list has the lakes people mean, under the names they use', () => {
    const lakes = JSON.parse(readFileSync(new URL('../data/lakes.json', import.meta.url)));
    assert.ok(lakes.length > 3000);
    assert.deepEqual(lakesNear(lakes, 35.23, -80.84).map((lake) => lake.name).sort(), ['Lake Norman', 'Lake Wylie']); // Charlotte
    assert.ok(lakesNear(lakes, 35.78, -78.64).some((lake) => lake.name === 'Falls Lake')); // Raleigh, not "Brinkley Lake"
});

test('the row: lakes, rivers, salt water, each nearest first, empty kinds left out', () => {
    const groups = nearbyWater({
        lakes: [{ name: 'Lake Far', miles: 20.4, kind: 'lake' }, { name: 'Lake Near', miles: 0.2, kind: 'lake' }],
        salt: [{ name: 'Tampa Bay', miles: 2.6, kind: 'salt', mode: 'inshore' }],
        state: 'Florida',
    });
    assert.deepEqual(groups.map((g) => [g.label, g.places.map((p) => [p.label, p.name, p.miles])]), [
        ['Lakes', [['Lake Near', 'Lake Near, Florida', 1], ['Lake Far', 'Lake Far, Florida', 20]]],
        ['Salt water', [['Tampa Bay', 'Tampa Bay, Florida', 3]]],
    ]);
});

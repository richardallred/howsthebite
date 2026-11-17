import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lakesFromNhd, nearbyLakesUrl, nearbyWater, riverName, riversFromStations } from '../js/core/nearby-water.js';
import { pointFor } from '../functions/api/nearby-lakes.js';

const lake = (name, ftype, areasqkm, rings) => ({ attributes: { GNIS_NAME: name, FTYPE: ftype, AREASQKM: areasqkm }, geometry: { rings } });
const square = (lat, lon, d = 0.01) => [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]];

test('the NHD query asks for named lakes and reservoirs in a box around the town, biggest first', () => {
    const url = new URL(nearbyLakesUrl(35.6, -82.55));
    assert.match(url.searchParams.get('where'), /gnis_name IS NOT NULL AND ftype IN \(390,436\)/);
    assert.equal(url.searchParams.get('orderByFields'), 'areasqkm DESC');
    const [w, s, e, n] = url.searchParams.get('geometry').split(',').map(Number);
    assert.ok(w < -82.55 && e > -82.55 && s < 35.6 && n > 35.6);
});

test('lakes: unnamed, other types and far ones are left out; a big lake beats a near pond; placed at the near shore', () => {
    const answer = {
        features: [
            lake('Lake Big', 436, 20, square(35.75, -82.55, 0.05)),
            lake('Lake Small', 390, 0.2, square(35.62, -82.55)),
            lake('Noname', 390, 5, square(35.61, -82.55)),
            lake('Swampy', 466, 5, square(35.61, -82.55)),
            lake('Far Lake', 390, 50, square(36.4, -82.55)),
            lake('Lake Small', 390, 0.1, square(35.65, -82.55)), // a second polygon of the same name
            lake('Lake Mid', 390, 2, square(35.7, -82.55)),
            lake('Lake Tiny', 390, 0.1, square(35.8, -82.55)),
        ],
    };
    const lakes = lakesFromNhd(answer, 35.6, -82.55);
    assert.deepEqual(lakes.map((l) => l.name), ['Lake Big', 'Lake Mid', 'Lake Small']);
    assert.equal(lakes[0].detail, 'Reservoir · 4,942 acres');
    assert.equal(lakes[0].lat, 35.7); // the south shore, the side facing the town
    assert.equal(lakes[2].lat, 35.61);
});

test('river names come from gauge names, abbreviations included', () => {
    assert.equal(riverName('French Broad River at Asheville, NC'), 'French Broad River');
    assert.equal(riverName('Pigeon R near Canton, NC'), 'Pigeon River');
    assert.equal(riverName('North Fork Swannanoa River near Black Mountain'), 'North Fork Swannanoa River');
    assert.equal(riverName('Reed Creek at Asheville, NC'), null);
    assert.equal(riverName('Lake Norman near Mooresville, NC'), null);
    assert.equal(riverName('Cove Creek near Lake Lure, NC'), null);
});

test('rivers: one per river at its nearest gauge, nearest first, lake gauges and far ones left out', () => {
    const stations = [
        { name: 'French Broad River at Marshall, NC', kind: 'river', lat: 35.8, lon: -82.66 },
        { name: 'French Broad River at Asheville, NC', kind: 'river', lat: 35.61, lon: -82.57 },
        { name: 'Swannanoa River at Biltmore, NC', kind: 'river', lat: 35.57, lon: -82.54 },
        { name: 'Lake Julian River Intake', kind: 'lake', lat: 35.48, lon: -82.53 },
        { name: 'Hominy Creek near West Asheville, NC', kind: 'river', lat: 35.56, lon: -82.6 },
        { name: 'Pigeon R near Hepco, NC', kind: 'river', lat: 35.9, lon: -83.1 },
    ];
    const rivers = riversFromStations(stations, 35.6, -82.55);
    assert.deepEqual(rivers.map((r) => [r.name, r.lat]), [['French Broad River', 35.61], ['Swannanoa River', 35.57]]);
    assert.equal(rivers[0].kind, 'river');
});

test('the chips: lakes then rivers, each nearest first, named with the state, whole miles', () => {
    const chips = nearbyWater({
        lakes: [{ name: 'Lake Far', miles: 20.4, kind: 'lake' }, { name: 'Lake Near', miles: 0.2, kind: 'lake' }],
        rivers: [{ name: 'Swannanoa River', miles: 2.6, kind: 'river' }],
        state: 'North Carolina',
    });
    assert.deepEqual(chips.map((c) => [c.label, c.name, c.miles]), [
        ['Lake Near', 'Lake Near, North Carolina', 1],
        ['Lake Far', 'Lake Far, North Carolina', 20],
        ['Swannanoa River', 'Swannanoa River, North Carolina', 3],
    ]);
});

test('the proxy snaps the point so a town shares one cached answer, and refuses bad points', () => {
    assert.deepEqual(pointFor('https://x/api/nearby-lakes?lat=35.601&lon=-82.554'), { lat: 35.6, lon: -82.56 });
    assert.equal(pointFor('https://x/api/nearby-lakes?lat=51.5&lon=0.1'), null);
    assert.equal(pointFor('https://x/api/nearby-lakes?lat=abc&lon=-82'), null);
});

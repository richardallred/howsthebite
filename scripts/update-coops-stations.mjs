// Rebuilds data/coops-stations.json: the NOAA CO-OPS stations the app can use for salt water.
//
// NOAA's station service has no "nearest to this point" search, so the app carries a
// compact list and finds the nearest station itself. Stations rarely change; run this
// a couple of times a year:
//
//   node scripts/update-coops-stations.mjs
//
// Each row is [id, name, latitude, longitude, flags], where flags is the sum of
//   1  has tide predictions
//   2  measures water temperature
// Great Lakes stations are left out (no tide; fresh water is covered by USGS).

import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json';
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'coops-stations.json');

async function list(type) {
    const response = await fetch(`${API}?type=${type}`, { headers: { 'user-agent': 'station-list-builder/1.0' } });
    if (!response.ok) throw new Error(`${type}: HTTP ${response.status}`);
    const { stations } = await response.json();
    if (!Array.isArray(stations) || stations.length < 100) throw new Error(`${type}: unexpectedly short list`);
    return stations;
}

const [tides, temps] = await Promise.all([list('tidepredictions'), list('watertemp')]);

const byId = new Map();
const add = (station, flag) => {
    const lat = Number(station.lat);
    const lon = Number(station.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !station.id) return;
    const row = byId.get(station.id) ?? [String(station.id), String(station.name ?? '').trim(), Number(lat.toFixed(4)), Number(lon.toFixed(4)), 0];
    row[4] |= flag;
    byId.set(station.id, row);
};
for (const station of tides) add(station, 1);
for (const station of temps) if (!station.greatlakes && station.tidal !== false) add(station, 2);

const rows = [...byId.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
await writeFile(out, `${JSON.stringify(rows)}\n`);
const count = (flag) => rows.filter((row) => row[4] & flag).length;
console.log(`Wrote ${rows.length} stations (${count(1)} with tide predictions, ${count(2)} with water temperature) to data/coops-stations.json`);

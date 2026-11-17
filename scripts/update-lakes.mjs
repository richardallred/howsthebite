// Rebuilds data/lakes.json: the best-known US lakes and reservoirs, for "Nearby water".
//
// The list comes from Wikidata (public domain, CC0): every lake or reservoir in the United
// States that has an article on the English Wikipedia. Having an article is a fair sign
// that people know the lake by name; the number of Wikipedias that write about it says
// how widely. Names are the ones people use ("Jordan Lake", not the official "B. Everett
// Jordan Lake"). Lakes rarely change; run this once in a while:
//
//   node scripts/update-lakes.mjs
//
// Each row is [name, latitude, longitude, sitelinks, area in km² (0 when unknown)].

import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SPARQL = 'https://query.wikidata.org/sparql';
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'lakes.json');

// Lakes and everything that is a kind of lake (reservoirs, oxbows, crater lakes…), in the US,
// with a place on the map and an English Wikipedia article, and its area with the unit.
const QUERY = `
SELECT ?item ?name ?c ?s ?area ?unit WHERE {
  ?item wdt:P17 wd:Q30 ;
        wdt:P31/wdt:P279* wd:Q23397 ;
        wdt:P625 ?c ;
        wikibase:sitelinks ?s .
  ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> .
  OPTIONAL { ?item p:P2046/psv:P2046 [ wikibase:quantityAmount ?area ; wikibase:quantityUnit ?unit ] }
  ?item rdfs:label ?name . FILTER(LANG(?name) = "en")
}`;

const response = await fetch(`${SPARQL}?${new URLSearchParams({ query: QUERY })}`, {
    headers: { accept: 'application/sparql-results+json', 'user-agent': 'howsthebite-lake-list/1.0 (scripts/update-lakes.mjs)' },
});
if (!response.ok) throw new Error(`Wikidata answered ${response.status}`);
const { results } = await response.json();

// km² per unit, for the units lake areas are given in.
const KM2_PER = {
    Q712226: 1, // square kilometre
    Q25343: 1e-6, // square metre
    Q35852: 0.01, // hectare
    Q81292: 0.00404686, // acre
    Q232291: 2.58999, // square mile
};

// Salt water that Wikidata files under lakes (Pearl Harbor is a lagoon): offered as salt water instead.
const SALT = /\b(?:Harbor|Harbour|Bay|Sound|Inlet|Estuary)\b/i;

const byItem = new Map();
for (const row of results.bindings) {
    const point = /^Point\(([-\d.eE]+) ([-\d.eE]+)\)$/.exec(row.c.value); // a few are on the Moon or Mars
    if (!point) continue;
    const lon = Number(point[1]);
    const lat = Number(point[2]);
    if (!(lat > 17 && lat < 72 && lon > -180 && lon < -64)) continue;
    const name = row.name.value.trim();
    if (SALT.test(name)) continue;
    const perUnit = KM2_PER[row.unit?.value.split('/').pop()];
    const km2 = row.area && perUnit ? Number(row.area.value) * perUnit : 0;
    const known = byItem.get(row.item.value);
    if (known) { // an item with several points or areas: keep the first point and the largest area
        known[4] = Math.max(known[4], Number(km2.toFixed(1)));
        continue;
    }
    byItem.set(row.item.value, [name, Number(lat.toFixed(4)), Number(lon.toFixed(4)), Number(row.s.value), Number(km2.toFixed(1))]);
}

const rows = [...byItem.values()].sort((a, b) => b[3] - a[3] || (a[0] < b[0] ? -1 : 1));
if (rows.length < 3000) throw new Error(`Only ${rows.length} lakes: Wikidata's answer looks incomplete`);
await writeFile(out, `${JSON.stringify(rows)}\n`);
console.log(`Wrote ${rows.length} lakes (${rows.filter((row) => row[4]).length} with an area) to data/lakes.json`);

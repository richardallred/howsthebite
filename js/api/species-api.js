// Species occurrence counts from GBIF (the Global Biodiversity Information Facility):
// how often each sport fish has been recorded in the region around a place.
// Key-less and CORS-enabled. Docs: https://techdocs.gbif.org/en/openapi/v1/occurrence

import { API } from '../config.js';
import { SPORT_FISH } from '../core/species.js';
import { fetchJson } from './http.js';

// The region is a box about 140 miles across, centred on a 0.5° grid: wide enough to
// describe "around here", and coarse enough that the exact spot is never sent.
const GRID_DEGREES = 0.5;
const HALF_HEIGHT_DEGREES = 1;
const HALF_WIDTH_DEGREES = 1.3;
const SINCE_YEAR = 1990; // fish ranges shift: a century-old museum record says little about today

const snap = (value) => Math.round(value / GRID_DEGREES) * GRID_DEGREES;

/** Identifies the region a coordinate falls in; two places with the same key share an answer. */
export const speciesRegionKey = (lat, lon) => `${snap(lat).toFixed(1)},${snap(lon).toFixed(1)}`;

/**
 * Records per species key for the region around a coordinate: { [gbifSpeciesKey]: count }.
 * Species with no records are simply absent.
 */
export async function fetchSpeciesCounts(lat, lon, { signal } = {}) {
    const [centreLat, centreLon] = [snap(lat), snap(lon)];
    const url = new URL(API.GBIF);
    const set = (name, value) => url.searchParams.append(name, value);
    set('limit', 0); // counts only, no records
    set('facet', 'speciesKey');
    set('facetLimit', SPORT_FISH.length + 5);
    set('hasCoordinate', 'true');
    set('occurrenceStatus', 'PRESENT');
    set('year', `${SINCE_YEAR},${new Date().getFullYear()}`);
    // Openly licensed records only (no non-commercial restriction).
    set('license', 'CC0_1_0');
    set('license', 'CC_BY_4_0');
    set('decimalLatitude', `${(centreLat - HALF_HEIGHT_DEGREES).toFixed(1)},${(centreLat + HALF_HEIGHT_DEGREES).toFixed(1)}`);
    set('decimalLongitude', `${(centreLon - HALF_WIDTH_DEGREES).toFixed(1)},${(centreLon + HALF_WIDTH_DEGREES).toFixed(1)}`);
    for (const fish of SPORT_FISH) set('taxonKey', fish.key);

    // A short timeout: this refines the choices on offer and must never hold up the conditions.
    const data = await fetchJson(url, { signal, timeoutMs: 5000 });
    const facet = (data.facets ?? []).find((entry) => entry.field === 'SPECIES_KEY');
    return Object.fromEntries((facet?.counts ?? []).map((entry) => [entry.name, entry.count]));
}

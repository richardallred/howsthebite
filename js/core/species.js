// Which groups of sport fish actually live around a place.
//
// The evidence is occurrence records: how many times each species has been recorded
// (by agencies, museums and surveys) in the surrounding region since 1990. A group is
// offered only when its fish make up a real share of those records, so nobody is
// offered walleye in south Florida or bass in Alaska.

/** GBIF species keys for the fish the score knows about, and the group each belongs to. */
export const SPORT_FISH = [
    { key: 2394563, group: 'warm', name: 'largemouth bass' },
    { key: 5211245, group: 'warm', name: 'spotted bass' },
    { key: 2394503, group: 'warm', name: 'bluegill' },
    { key: 2394526, group: 'warm', name: 'black crappie' },
    { key: 2394534, group: 'warm', name: 'white crappie' },
    { key: 5202520, group: 'warm', name: 'channel catfish' },

    // Listed in the order they are named on the button.
    { key: 2382172, group: 'cool', name: 'walleye' },
    { key: 2346633, group: 'cool', name: 'pike' },
    { key: 2346634, group: 'cool', name: 'muskie' },
    { key: 5211250, group: 'cool', name: 'smallmouth' },
    { key: 2382004, group: 'cool', name: 'perch' },
    { key: 2382152, group: 'cool', name: 'sauger' },

    { key: 5204019, group: 'cold', name: 'trout' }, // rainbow
    { key: 8215487, group: 'cold', name: 'trout' }, // brown
    { key: 2351271, group: 'cold', name: 'trout' }, // brook
    { key: 5711980, group: 'cold', name: 'trout' }, // cutthroat
    { key: 2351327, group: 'cold', name: 'trout' }, // lake trout
    { key: 5204034, group: 'cold', name: 'salmon' }, // coho
    { key: 5204024, group: 'cold', name: 'salmon' }, // chinook
];

export const GROUP_IDS = ['warm', 'cool', 'cold'];

/** The usual labels: for the far north of the lower 48, and wherever the records cannot refine them. */
export const DEFAULT_LABELS = { any: 'All species', warm: 'Bass & panfish', cool: 'Walleye & pike', cold: 'Trout' };

// Below this many records in all, the region is too thinly surveyed to judge from records.
const MIN_RECORDS = 20;
// Cool- and cold-water fish count as living here with at least 5 records that are either 3% of
// the region's total or 25 outright. A handful of strays (an escaped pet, a misidentified
// specimen) is not a fishery, and one enormous trout survey must not hide everything else.
const MIN_GROUP_RECORDS = 5;
const MIN_GROUP_SHARE = 0.03;
const ENOUGH_ON_ITS_OWN = 25;
// A species is named on the button with a tenth of its group's records, or 25 outright.
const NAMED_SHARE = 0.1;
const NAMED_ON_ITS_OWN = 25;
const MIN_NAMED_RECORDS = 3;

const ALASKA_LATITUDE = 54.5;
const DEEP_SOUTH_LATITUDE = 31; // Florida, the Gulf coast, south Texas, Hawaii

const capitalise = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// The fish each group stands for when the records cannot say more (also used for lure advice).
const DEFAULT_NAMES = { warm: ['bass', 'panfish', 'catfish'], cool: ['walleye', 'pike'], cold: ['trout'] };

/** The group's fish that are actually recorded here, leading ones first: ['walleye', 'pike'], ['smallmouth'], ['trout', 'salmon']. */
function namesFor(group, counts, groupTotal) {
    if (group === 'warm') return DEFAULT_NAMES.warm;
    const byName = new Map();
    for (const fish of SPORT_FISH) {
        if (fish.group === group) byName.set(fish.name, (byName.get(fish.name) ?? 0) + (Number(counts[fish.key]) || 0));
    }
    const named = [...byName]
        .filter(([, count]) => count >= MIN_NAMED_RECORDS && (count >= NAMED_SHARE * groupTotal || count >= NAMED_ON_ITS_OWN))
        .map(([name]) => name);
    if (!named.length) named.push([...byName].sort((a, b) => b[1] - a[1])[0][0]);
    return named;
}

/** "Walleye & pike", "Smallmouth", "Trout & salmon": the two leading names. */
const labelOf = (id, names) => (id === 'warm' ? DEFAULT_LABELS.warm : capitalise(names.slice(0, 2).join(' & ')));

const group = (id, available, names, records = 0) => ({ available, label: labelOf(id, names), names, records });

/**
 * What to assume where the records cannot say (too few of them, or the lookup failed):
 * no walleye, pike or trout in the far south, and the Alaskan mix in Alaska.
 */
function assumedFor(lat) {
    const alaska = lat >= ALASKA_LATITUDE;
    const farSouth = lat < DEEP_SOUTH_LATITUDE;
    return {
        warm: group('warm', !alaska, DEFAULT_NAMES.warm),
        cool: group('cool', !farSouth, alaska ? ['pike'] : DEFAULT_NAMES.cool),
        cold: group('cold', !farSouth, alaska ? ['trout', 'salmon'] : DEFAULT_NAMES.cold),
    };
}

/**
 * @param {Record<string, number>|null} counts  records per GBIF species key for the region
 * @param {number} lat  latitude of the place, for the fallback and for Alaska
 * @returns {{ known: boolean, groups: Record<'warm'|'cool'|'cold', { available: boolean, label: string, names: string[], records: number }> }}
 *   `known` is false when the answer is the latitude-based assumption rather than records.
 *   `names` lists the group's fish recorded here, leading ones first.
 */
export function regionalSpecies(counts, lat) {
    const assumed = assumedFor(lat);
    if (!counts) return { known: false, groups: assumed };

    const totals = Object.fromEntries(GROUP_IDS.map((id) => [id, 0]));
    for (const fish of SPORT_FISH) totals[fish.group] += Number(counts[fish.key]) || 0;
    const total = GROUP_IDS.reduce((sum, id) => sum + totals[id], 0);
    if (total < MIN_RECORDS) return { known: false, groups: assumed };

    const judged = (id) => {
        const records = totals[id];
        const available = records >= MIN_GROUP_RECORDS && (records >= MIN_GROUP_SHARE * total || records >= ENOUGH_ON_ITS_OWN);
        return group(id, available, available ? namesFor(id, counts, records) : DEFAULT_NAMES[id], records);
    };
    return {
        known: true,
        groups: {
            // Bass, sunfish and catfish live in every state but Alaska, including thinly
            // surveyed country where few records exist, so this one is not left to the counts.
            warm: group('warm', assumed.warm.available, DEFAULT_NAMES.warm, totals.warm),
            cool: judged('cool'),
            cold: judged('cold'),
        },
    };
}

/**
 * The choices to offer for a region, most general first.
 * With one group of fish around, that group is the only choice ("all species" would mean the same thing).
 * @returns {Array<{ id: 'any'|'warm'|'cool'|'cold', label: string, targets: string[] }>}  `targets` are the fish to suggest lures for
 */
export function speciesOptions(region) {
    const available = GROUP_IDS.filter((id) => region.groups[id].available)
        .map((id) => ({ id, label: region.groups[id].label, targets: region.groups[id].names }));
    if (available.length === 1) return available;
    // "All species" stands for the leading fish of each group that lives here.
    return [{ id: 'any', label: DEFAULT_LABELS.any, targets: available.map((option) => option.targets[0]) }, ...available];
}

/** The option to score with: the saved preference when it is offered here, otherwise the most general one. */
export function chooseSpecies(options, preferred) {
    return options.find((option) => option.id === preferred) ?? options[0];
}

// ---------------------------------------------------------------------------
// Salt water
// ---------------------------------------------------------------------------

/**
 * Salt-water sport fish, the temperature group each is scored with (SPECIES_GROUPS in
 * scoring.js) and the styles of fishing that catch it. Listed in the order they are named.
 */
export const SALT_FISH = [
    { key: 2369643, group: 'tropical', name: 'snook', modes: ['inshore'] },
    { key: 5203123, group: 'tropical', name: 'tarpon', modes: ['inshore'] },
    { key: 5210681, group: 'tropical', name: 'pompano', modes: ['surf'] },

    { key: 2400222, group: 'warmsalt', name: 'redfish', modes: ['inshore', 'surf'] },
    { key: 2400015, group: 'warmsalt', name: 'seatrout', modes: ['inshore'] },
    { key: 2408881, group: 'warmsalt', name: 'flounder', modes: ['inshore'] },
    { key: 2400093, group: 'warmsalt', name: 'whiting', modes: ['surf'] }, // southern kingfish
    { key: 2400086, group: 'warmsalt', name: 'whiting', modes: ['surf'] }, // gulf kingfish
    { key: 2400079, group: 'warmsalt', name: 'whiting', modes: ['surf'] }, // northern kingfish

    { key: 2394612, group: 'coolsalt', name: 'striper', modes: ['inshore', 'surf'] },
    { key: 5208090, group: 'coolsalt', name: 'bluefish', modes: ['inshore', 'surf'] },
    { key: 2408866, group: 'coolsalt', name: 'fluke', modes: ['inshore', 'surf'] }, // summer flounder
    { key: 2399985, group: 'coolsalt', name: 'weakfish', modes: ['inshore'] },

    { key: 2408903, group: 'pacwarm', name: 'halibut', modes: ['inshore', 'surf'] }, // California halibut
    { key: 2389248, group: 'pacwarm', name: 'surfperch', modes: ['surf'] }, // barred surfperch
    { key: 2400088, group: 'pacwarm', name: 'corbina', modes: ['surf'] },
    { key: 2400438, group: 'pacwarm', name: 'croaker', modes: ['surf'] }, // spotfin croaker
    { key: 2399665, group: 'pacwarm', name: 'croaker', modes: ['surf'] }, // yellowfin croaker
    { key: 2387731, group: 'pacwarm', name: 'bay bass', modes: ['inshore'] }, // kelp (calico) bass
    { key: 2387722, group: 'pacwarm', name: 'bay bass', modes: ['inshore'] }, // spotted sand bass

    { key: 2389252, group: 'paccold', name: 'surfperch', modes: ['surf'] }, // redtail surfperch
    { key: 5204034, group: 'paccold', name: 'salmon', modes: ['inshore'] }, // coho
    { key: 5204024, group: 'paccold', name: 'salmon', modes: ['inshore'] }, // Chinook
    { key: 2335569, group: 'paccold', name: 'rockfish', modes: ['inshore'] }, // black rockfish
];

export const SALT_GROUP_IDS = ['tropical', 'warmsalt', 'coolsalt', 'pacwarm', 'paccold'];

const DISPLAY_NAMES = { striper: 'striped bass' };
const display = (name) => DISPLAY_NAMES[name] ?? name;
const saltLabel = (names) => capitalise(names.slice(0, 2).map(display).join(' & '));

/** Every fish of a group that a style of fishing catches, in naming order, without repeats. */
const saltNames = (groupId, mode) => [...new Set(SALT_FISH.filter((fish) => fish.group === groupId && fish.modes.includes(mode)).map((fish) => fish.name))];

const PACIFIC_LONGITUDE = -115;
const isHawaii = (lat, lon) => lon < PACIFIC_LONGITUDE && lat < 25;

// Where each group can live at all. Records alone mislead at the edges: a 140-mile box
// reaches inland reservoirs and neighbouring waters, and names get misapplied.
const SALT_RANGE = {
    tropical: (lat, lon) => lon >= PACIFIC_LONGITUDE && lat <= 36, // pompano reach the Carolinas in summer
    warmsalt: (lat, lon) => lon >= PACIFIC_LONGITUDE && lat <= 41,
    coolsalt: (lat, lon) => (lon >= PACIFIC_LONGITUDE ? lat >= 28 : lat >= 36 && lat <= 46), // Pacific: the striped bass of San Francisco Bay and Oregon
    pacwarm: (lat, lon) => lon < PACIFIC_LONGITUDE && lat >= 25 && lat <= 38.5,
    paccold: (lat, lon) => lon < PACIFIC_LONGITUDE && lat >= 34.5,
};
// Striped bass are stocked in reservoirs across the South; those records say nothing about
// the coast. They count only where stripers run in salt water.
const STRIPER_KEY = 2394612;
const stripersRunHere = (lat, lon) => (lon >= PACIFIC_LONGITUDE ? lat >= 34 : true);

/** What to assume about a coast from its position alone, when records cannot say. */
function assumedSaltGroups(lat, lon) {
    if (lon < PACIFIC_LONGITUDE) {
        if (lat < 25) return []; // Hawaii: handled separately
        return lat < 36 ? ['pacwarm'] : ['paccold'];
    }
    if (lat < 30) return ['warmsalt', 'tropical'];
    if (lat < 36) return ['warmsalt'];
    if (lat < 38.5) return ['coolsalt', 'warmsalt'];
    return ['coolsalt'];
}

/**
 * The salt-water choices to offer at a place for a style of fishing, best recorded first.
 * There is no "all species" here: the fish of different coasts want too different water,
 * so the leading local group is the default.
 *
 * @param {Record<string, number>|null} counts  records per GBIF species key for the region
 * @param {'inshore'|'surf'} mode
 * @returns {Array<{ id: string, label: string, targets: string[] }>}  never empty
 */
export function saltSpeciesOptions(counts, mode, lat, lon) {
    const option = (id, names) => ({ id, label: saltLabel(names), targets: names });
    // Hawaii's shore fish (jacks, bonefish, goatfish) are not in the list: score warm-water
    // conditions for them, and offer no lure advice rather than the wrong advice.
    if (isHawaii(lat, lon)) return [{ id: 'tropical', label: 'Reef & shore fish', targets: [] }];
    const assumed = () => assumedSaltGroups(lat, lon)
        .map((id) => option(id, saltNames(id, mode)))
        .filter((entry) => entry.targets.length);

    const fish = SALT_FISH.filter((entry) => entry.modes.includes(mode)
        && SALT_RANGE[entry.group](lat, lon)
        && (entry.key !== STRIPER_KEY || stripersRunHere(lat, lon)));
    const total = counts ? fish.reduce((sum, entry) => sum + (Number(counts[entry.key]) || 0), 0) : 0;
    if (total < MIN_RECORDS) return assumed();

    const options = [];
    for (const id of SALT_GROUP_IDS) {
        const byName = new Map();
        for (const entry of fish) {
            if (entry.group === id) byName.set(entry.name, (byName.get(entry.name) ?? 0) + (Number(counts[entry.key]) || 0));
        }
        const records = [...byName.values()].reduce((sum, count) => sum + count, 0);
        if (records < MIN_GROUP_RECORDS || !(records >= MIN_GROUP_SHARE * total || records >= ENOUGH_ON_ITS_OWN)) continue;
        const named = [...byName]
            .filter(([, count]) => count >= MIN_NAMED_RECORDS && (count >= NAMED_SHARE * records || count >= NAMED_ON_ITS_OWN))
            .map(([name]) => name);
        options.push({ ...option(id, named.length ? named : [[...byName].sort((a, b) => b[1] - a[1])[0][0]]), records });
    }
    if (!options.length) return assumed();
    return options.sort((a, b) => b.records - a.records).map(({ records, ...rest }) => rest); // eslint-disable-line no-unused-vars
}

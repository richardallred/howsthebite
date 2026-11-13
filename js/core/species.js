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

/** "Walleye & pike", "Smallmouth", "Trout & salmon": the group's two leading names found here. */
function labelFor(group, counts, groupTotal) {
    if (group === 'warm') return DEFAULT_LABELS.warm;
    const byName = new Map();
    for (const fish of SPORT_FISH) {
        if (fish.group === group) byName.set(fish.name, (byName.get(fish.name) ?? 0) + (Number(counts[fish.key]) || 0));
    }
    const named = [...byName]
        .filter(([, count]) => count >= MIN_NAMED_RECORDS && (count >= NAMED_SHARE * groupTotal || count >= NAMED_ON_ITS_OWN))
        .map(([name]) => name);
    if (!named.length) named.push([...byName].sort((a, b) => b[1] - a[1])[0][0]);
    return capitalise(named.slice(0, 2).join(' & '));
}

const group = (available, label, records = 0) => ({ available, label, records });

/**
 * What to assume where the records cannot say (too few of them, or the lookup failed):
 * no walleye, pike or trout in the far south, and the Alaskan mix in Alaska.
 */
function assumedFor(lat) {
    const alaska = lat >= ALASKA_LATITUDE;
    const farSouth = lat < DEEP_SOUTH_LATITUDE;
    return {
        warm: group(!alaska, DEFAULT_LABELS.warm),
        cool: group(!farSouth, alaska ? 'Pike' : DEFAULT_LABELS.cool),
        cold: group(!farSouth, alaska ? 'Trout & salmon' : DEFAULT_LABELS.cold),
    };
}

/**
 * @param {Record<string, number>|null} counts  records per GBIF species key for the region
 * @param {number} lat  latitude of the place, for the fallback and for Alaska
 * @returns {{ known: boolean, groups: Record<'warm'|'cool'|'cold', { available: boolean, label: string, records: number }> }}
 *   `known` is false when the answer is the latitude-based assumption rather than records.
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
        return group(available, available ? labelFor(id, counts, records) : DEFAULT_LABELS[id], records);
    };
    return {
        known: true,
        groups: {
            // Bass, sunfish and catfish live in every state but Alaska, including thinly
            // surveyed country where few records exist, so this one is not left to the counts.
            warm: group(assumed.warm.available, DEFAULT_LABELS.warm, totals.warm),
            cool: judged('cool'),
            cold: judged('cold'),
        },
    };
}

/**
 * The choices to offer for a region, most general first.
 * With one group of fish around, that group is the only choice ("all species" would mean the same thing).
 * @returns {Array<{ id: 'any'|'warm'|'cool'|'cold', label: string }>}
 */
export function speciesOptions(region) {
    const available = GROUP_IDS.filter((id) => region.groups[id].available).map((id) => ({ id, label: region.groups[id].label }));
    if (available.length === 1) return available;
    return [{ id: 'any', label: DEFAULT_LABELS.any }, ...available];
}

/** The option to score with: the saved preference when it is offered here, otherwise the most general one. */
export function chooseSpecies(options, preferred) {
    return options.find((option) => option.id === preferred) ?? options[0];
}

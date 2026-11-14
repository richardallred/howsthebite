// Where each fish is in its year: pre-spawn, spawn, summer, the fall feed, winter.
//
// The same water temperature means different things in spring and fall. At 55°F in April
// largemouth bass are moving toward their spawning flats; at 55°F in November they are
// chasing shad before winter. So a phase is found from two things:
//
//   * which half of the year it is: the water warming (mid-January to July) or cooling
//     (August to January). Near the turns, the measured trend decides: a fortnight of
//     clearly warming water in January is an early spring, as it often is in Florida;
//   * the water temperature, against thresholds for that fish.
//
// The thresholds are a synthesis of widely published seasonal patterns (see the README), not
// figures from one source, and have not been checked against catch data. They are rules of
// thumb: fish in one lake run a week or two ahead of fish in the next. Northern-hemisphere
// dates throughout; the app covers the US.

const DAY_MS = 24 * 60 * 60 * 1000;

function dayOfYear(date) {
    const start = Date.UTC(date.getFullYear(), 0, 1);
    const today = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    return Math.floor((today - start) / DAY_MS) + 1;
}

const WARMING_FROM = 15; // mid-January: the far south's bass and crappie spawn from January
const COOLING_FROM = 213; // 1 August
const EARLY_SPRING_UNTIL = 74; // mid-March: a clear warming trend before this starts spring early
const LATE_SUMMER = [182, 273]; // July to September: the trend says whether the turn has come
const DECISIVE_F = 3; // a two-week change this large overrides the calendar near the turns

/**
 * 'warming' or 'cooling': which half of the year the water is in.
 * @param {Date} date
 * @param {import('./water-trend.js').WaterTrend|null} [trend]
 */
export function seasonHalf(date, trend = null) {
    const day = dayOfYear(date);
    const calendar = day >= WARMING_FROM && day < COOLING_FROM ? 'warming' : 'cooling';
    const change = trend?.change14 ?? (trend?.days >= 10 ? trend?.change7 : null);
    if (typeof change !== 'number' || Math.abs(change) < DECISIVE_F) return calendar;
    const measured = change > 0 ? 'warming' : 'cooling';
    if (day < EARLY_SPRING_UNTIL && measured === 'warming') return 'warming';
    if (day >= LATE_SUMMER[0] && day <= LATE_SUMMER[1]) return measured;
    return calendar;
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------
//
// Each fish has a list of steps, tried in order; the first that fits wins. A step can
// require a half of the year (`half`), a water temperature below a value (`below`) and
// a set of months (`months`, 1–12). A phase has a label, what the fish are doing, and
// what they are eating where that is worth matching (`forage`).

const phase = (label, pattern, forage = null) => ({ label, pattern, forage });
const step = (id, conditions = {}) => ({ id, ...conditions });
const SPRING_MONTHS = [1, 2, 3, 4, 5, 6];

const SEASONS = {
    // ----- Fresh water ---------------------------------------------------------
    bass: {
        phases: {
            winter: phase('Winter', 'Bass hold deep on steep banks, channel bends and bluff ends and feed in short spells, often on sunny afternoons'),
            prespawn: phase('Pre-spawn', 'Bass are moving from deep water toward the spawning flats, staging on points and feeding hard as the water warms', 'crawfish'),
            spawn: phase('Spawn', 'Bass are on beds in shallow, sheltered pockets. Bedding fish bite to drive off intruders, not to feed'),
            postspawn: phase('Post-spawn', 'Females are recovering on the first drop off the spawning flats while males guard fry; the shad and bluegill spawns draw bass shallow at dawn', 'shad and bluegill'),
            summer: phase('Summer', 'Most bass hold offshore on ledges, humps and deep grass edges by day, and feed shallow early, late and at night'),
            fall: phase('Fall feed', 'Shad move into the creek arms as the water cools and bass follow, roaming shallow and chasing hard', 'shad'),
            latefall: phase('Late fall', 'Bass bunch up on bait near deeper water and feed heavily before winter, best on stable, sunny days', 'shad'),
        },
        steps: [
            step('winter', { below: 50 }),
            step('prespawn', { half: 'warming', below: 60 }),
            step('spawn', { half: 'warming', below: 72, months: SPRING_MONTHS }),
            step('postspawn', { half: 'warming', below: 78, months: [3, 4, 5, 6, 7] }),
            step('summer', { half: 'warming' }),
            step('summer', { half: 'cooling', months: [7, 8] }),
            step('latefall', { half: 'cooling', below: 60 }),
            step('latefall', { half: 'cooling', months: [12, 1] }),
            step('fall', { half: 'cooling', below: 78 }),
            step('summer'),
        ],
    },
    smallmouth: {
        phases: {
            winter: phase('Winter', 'Smallmouth hold near deep rock, bluff walls and river holes and take small, slow baits'),
            prespawn: phase('Pre-spawn', 'Smallmouth move up onto rocky points and flats near their spawning areas and feed heavily', 'crawfish'),
            spawn: phase('Spawn', 'Smallmouth nest on gravel and rock in 3 to 10 feet; males guard the nests'),
            summer: phase('Summer', 'Smallmouth hold on deep rock humps, points and current seams and roam after baitfish', 'crawfish and minnows'),
            fall: phase('Fall feed', 'Smallmouth gang up on baitfish and crawfish as the water cools: often the year\'s best fishing for big fish', 'baitfish'),
            latefall: phase('Late fall', 'Smallmouth drop to deeper rock near wintering holes and still feed in warm spells'),
        },
        steps: [
            step('winter', { below: 46 }),
            step('prespawn', { half: 'warming', below: 58 }),
            step('spawn', { half: 'warming', below: 68, months: SPRING_MONTHS }),
            step('summer', { half: 'warming' }),
            step('latefall', { half: 'cooling', below: 54 }),
            step('fall', { half: 'cooling', below: 70 }),
            step('summer'),
        ],
    },
    panfish: {
        phases: {
            winter: phase('Winter', 'Crappie and bluegill school in deep basins and along channel edges and feed slowly'),
            prespawn: phase('Crappie pre-spawn', 'Crappie move toward spawning areas, staging on brush and channel edges near the shallows'),
            spawn: phase('Crappie spawn', 'Crappie spawn in 2 to 6 feet around reeds, brush and docks; bluegill are feeding in the shallows'),
            bluegill: phase('Bluegill spawn', 'Bluegill nest in colonies on firm, shallow bottoms and guard them fiercely; crappie have moved back to deeper brush'),
            summer: phase('Summer', 'Panfish hold along deeper weed edges, brush piles and docks and bite best early and late'),
            fall: phase('Fall', 'Crappie roam open water with the shad before settling on deep brush; bluegill feed along weed edges', 'shad'),
        },
        steps: [
            step('winter', { below: 50 }),
            step('prespawn', { half: 'warming', below: 58 }),
            step('spawn', { half: 'warming', below: 66, months: SPRING_MONTHS }),
            step('bluegill', { half: 'warming', below: 82, months: [3, 4, 5, 6, 7, 8] }),
            step('summer', { half: 'warming' }),
            step('fall', { half: 'cooling', below: 76 }),
            step('summer'),
        ],
    },
    catfish: {
        phases: {
            winter: phase('Winter', 'Catfish gather in deep holes and channel bends and feed slowly; blue catfish keep feeding on dead shad'),
            prespawn: phase('Pre-spawn', 'Catfish feed heavily before spawning, especially where spring rain brings food into the water: one of the best times of year'),
            spawn: phase('Spawn', 'Channel catfish are spawning in holes, undercut banks and rock; the bite slows until it ends'),
            summer: phase('Summer', 'Catfish feed most at night and in low light, and around current that carries oxygen'),
            fall: phase('Fall feed', 'Catfish feed hard on dying shad and baitfish as the water cools', 'shad'),
        },
        steps: [
            step('winter', { below: 50 }),
            step('prespawn', { half: 'warming', below: 70 }),
            step('spawn', { half: 'warming', below: 82, months: [4, 5, 6, 7] }),
            step('summer', { half: 'warming' }),
            step('fall', { half: 'cooling', below: 80 }),
            step('summer'),
        ],
    },
    walleye: {
        phases: {
            winter: phase('Winter', 'Walleye hold deep near the bottom and feed in short spells at dawn and dusk'),
            spawn: phase('Spawn', 'Walleye are running up rivers and onto rocky shoals to spawn. Many states close walleye fishing during the spawn: check before you go'),
            postspawn: phase('Post-spawn', 'Females are recovering and start feeding again in shallow bays that warm first; males linger near the spawning rock'),
            earlysummer: phase('Early summer', 'Walleye feed shallow along new weed growth and mid-depth flats: the year\'s most dependable bite', 'minnows and leeches'),
            summer: phase('Summer', 'Walleye go deeper by day to mid-lake humps, deep weed lines and basin edges, and rise to feed in low light'),
            fall: phase('Fall feed', 'As lakes turn over and cool, walleye move to rocky points and shorelines and feed heavily, especially after dark', 'baitfish'),
            latefall: phase('Late fall', 'The biggest walleye gather on deep drops near spawning areas and in the rivers'),
        },
        steps: [
            step('winter', { below: 40 }),
            step('spawn', { half: 'warming', below: 50, months: [2, 3, 4, 5] }),
            step('winter', { months: [12, 1], below: 50 }),
            step('postspawn', { half: 'warming', below: 58 }),
            step('earlysummer', { half: 'warming', below: 68 }),
            step('summer', { half: 'warming' }),
            step('latefall', { half: 'cooling', below: 50 }),
            step('fall', { half: 'cooling', below: 66 }),
            step('summer'),
        ],
    },
    pike: {
        phases: {
            winter: phase('Winter', 'Pike cruise the remaining weeds and shallow bays and scavenge as much as they chase'),
            spawn: phase('Spawn', 'Pike spawn in flooded marsh and shallow bays right after ice-out'),
            postspawn: phase('Post-spawn', 'Pike linger in the shallow bays and new weed growth that warm first, hungry after the spawn'),
            summer: phase('Summer', 'Bigger pike move to deeper, cooler water along weed edges and mid-lake structure; smaller fish stay shallow'),
            fall: phase('Fall feed', 'Cooling water pulls big pike back to weed edges and points to feed before winter: the season for big baits'),
        },
        steps: [
            step('winter', { below: 40 }),
            step('spawn', { half: 'warming', below: 50, months: [2, 3, 4, 5] }),
            step('winter', { months: [12, 1], below: 50 }),
            step('postspawn', { half: 'warming', below: 62 }),
            step('summer', { half: 'warming' }),
            step('winter', { half: 'cooling', below: 42 }),
            step('fall', { half: 'cooling', below: 66 }),
            step('summer'),
        ],
    },
    perch: {
        phases: {
            winter: phase('Winter', 'Perch roam in big schools near the bottom of basins and flats'),
            spawn: phase('Spawn', 'Perch crowd shallow, weedy bays and brush to spawn'),
            summer: phase('Summer', 'Perch school along weed edges and sand flats'),
            fall: phase('Fall', 'Perch school on the edges of weed flats and feed heavily before winter'),
        },
        steps: [
            step('winter', { below: 44 }),
            step('spawn', { half: 'warming', below: 54, months: [2, 3, 4, 5] }),
            step('winter', { months: [12, 1] }),
            step('summer', { half: 'warming' }),
            step('fall', { half: 'cooling', below: 66 }),
            step('summer'),
        ],
    },
    sauger: {
        phases: {
            winter: phase('Winter', 'Sauger gather below dams and in deep river holes: from late fall to the spawn is their best season'),
            spawn: phase('Spawn', 'Sauger are moving upstream to spawn below dams and over gravel'),
            summer: phase('Summer', 'Sauger scatter along deep river channels and feed most in low light'),
            fall: phase('Fall', 'Sauger begin moving toward the tailwaters below the dams'),
        },
        steps: [
            step('spawn', { half: 'warming', below: 52, months: [1, 2, 3, 4, 5] }),
            step('winter', { below: 50 }),
            step('winter', { months: [12, 1, 2] }),
            step('summer', { half: 'warming' }),
            step('fall', { half: 'cooling', below: 66 }),
            step('summer'),
        ],
    },
    trout: {
        phases: {
            winter: phase('Winter', 'Trout hold in slow, deep water and feed little; midday, when the water is warmest, is often best'),
            spring: phase('Spring', 'Warming water brings insect hatches and active trout; rainbows spawn in early spring'),
            summer: phase('Summer', 'Trout seek cold water (spring inflows, deep pools, shaded runs) and feed early and late'),
            fall: phase('Fall', 'Brown and brook trout spawn and turn aggressive; other trout feed heavily before winter. Leave fish on gravel nests (redds) alone'),
        },
        steps: [
            step('winter', { below: 42 }),
            step('winter', { months: [1, 2] }),
            step('spring', { half: 'warming', below: 62 }),
            step('summer', { half: 'warming' }),
            step('fall', { half: 'cooling', below: 62, months: [9, 10, 11, 12] }),
            step('summer'),
        ],
    },
    salmon: {
        phases: {
            run: phase('Spawning run', 'Salmon are running up the rivers to spawn; they feed little and strike from aggression'),
            spring: phase('Spring', 'Spring chinook run some rivers; elsewhere salmon follow bait in open water'),
            openwater: phase('Open water', 'Salmon roam open water after baitfish, often deep where the water is cold'),
        },
        steps: [
            step('run', { half: 'cooling', months: [8, 9, 10, 11] }),
            step('spring', { half: 'warming', months: [3, 4, 5, 6] }),
            step('openwater'),
        ],
    },

    // ----- Salt water ------------------------------------------------------------
    seatrout: {
        phases: {
            winter: phase('Winter', 'Seatrout gather in deep holes, channels, creeks and rivers where the water is warmest, and feed in short windows, often on sunny afternoons'),
            spring: phase('Spring', 'Seatrout move onto shallow grass flats and shell bars as the water warms; big fish feed on mullet', 'mullet and shrimp'),
            summer: phase('Summer', 'Seatrout spawn through the warm months: shallow at dawn, dusk and night, then on deeper grass edges and channels', 'shrimp and pinfish'),
            fall: phase('Fall feed', 'Seatrout feed heavily on shrimp and mullet leaving the marsh: often the best seatrout fishing of the year', 'shrimp'),
            latefall: phase('Late fall', 'Seatrout move into creeks, rivers and deeper bays ahead of winter'),
        },
        steps: [
            step('winter', { below: 58 }),
            step('winter', { months: [1] }),
            step('spring', { half: 'warming', below: 76 }),
            step('summer', { half: 'warming' }),
            step('latefall', { half: 'cooling', below: 65 }),
            step('fall', { half: 'cooling', below: 80 }),
            step('summer'),
        ],
    },
    redfish: {
        phases: {
            winter: phase('Winter', 'Redfish school on shallow mud flats and in creeks that warm in the afternoon sun; the water is at its clearest, so they spook easily'),
            spring: phase('Spring', 'Redfish spread across the flats and marsh, feeding on crabs and baitfish as the water warms', 'crabs and baitfish'),
            summer: phase('Summer', 'Redfish feed shallow early, late and at night, and slide to deeper edges, docks and passes in the heat of the day'),
            fall: phase('Fall run', 'Big breeding redfish ("bull reds") gather at passes, inlets and the surf to spawn, and slot fish feed hard on shrimp and mullet leaving the marsh', 'mullet and shrimp'),
            latefall: phase('Late fall', 'Redfish begin to school up on the flats and in the creeks for winter'),
        },
        steps: [
            step('winter', { below: 60 }),
            step('winter', { months: [1] }),
            step('spring', { half: 'warming', below: 80 }),
            step('summer', { half: 'warming' }),
            step('latefall', { half: 'cooling', below: 68 }),
            step('fall', { half: 'cooling', months: [8, 9, 10, 11, 12] }),
            step('winter'),
        ],
    },
    flounder: {
        phases: {
            winter: phase('Winter', 'Most flounder have moved offshore to spawn; the few left inshore hold in deep channels near the inlets'),
            spring: phase('Spring', 'Flounder come back through the inlets and spread into the bays and creeks'),
            summer: phase('Summer', 'Flounder lie along channel edges, docks, creek mouths and drop-offs throughout the bays', 'mud minnows and finger mullet'),
            fall: phase('Fall run', 'Flounder head for the inlets on their way offshore and stage at the mouths, especially on a falling tide: the year\'s best flounder fishing', 'finger mullet'),
        },
        steps: [
            step('winter', { below: 52 }),
            step('winter', { months: [1, 2] }),
            step('spring', { half: 'warming', below: 70 }),
            step('summer', { half: 'warming' }),
            step('fall', { half: 'cooling', below: 74 }),
            step('summer'),
        ],
    },
    halibut: {
        phases: {
            spawn: phase('Spring and summer', 'California halibut move into shallow bays, harbors and the surf to spawn and feed', 'anchovies and sardines'),
            offseason: phase('Fall and winter', 'Most halibut are in deeper water off the beaches; fewer are inshore'),
        },
        steps: [step('spawn', { months: [3, 4, 5, 6, 7, 8, 9] }), step('offseason')],
    },
    snook: {
        phases: {
            winter: phase('Winter', 'Snook hide in warm-water refuges (residential canals, rivers, deep backcountry creeks) and feed in short windows'),
            spring: phase('Spring', 'Snook move out of the backcountry toward the passes and flats, feeding heavily on whitebait', 'whitebait'),
            summer: phase('Summer', 'Snook spawn in the passes and inlets and cruise the beach troughs close to the sand. Florida closes harvest for part of the summer', 'whitebait'),
            fall: phase('Fall mullet run', 'Snook follow the fall mullet run back toward the backcountry, rivers and canals and feed hard', 'finger mullet'),
        },
        steps: [
            step('winter', { below: 70 }),
            step('winter', { months: [12, 1, 2] }),
            step('spring', { half: 'warming', below: 80, months: [3, 4, 5] }),
            step('summer', { half: 'warming' }),
            step('fall', { half: 'cooling', months: [9, 10, 11] }),
            step('summer'),
        ],
    },
    striper: {
        phases: {
            winter: phase('Winter', 'Holdover stripers sit in rivers, deep holes and warm-water outflows and feed slowly'),
            spring: phase('Spring run', 'Stripers push into rivers and bays on their way to spawn and feed heavily on herring and menhaden. Spawning rivers often have special rules', 'herring and menhaden'),
            summer: phase('Summer', 'Stripers feed most at night and at dawn, around rips, reefs, jetties and deeper channels'),
            fall: phase('Fall run', 'Stripers migrate along the coast and blitz bait schools (menhaden, mullet, sand eels): the best striper fishing of the year', 'small baitfish'),
        },
        steps: [
            step('winter', { below: 45 }),
            step('winter', { months: [1, 2] }),
            step('spring', { half: 'warming', below: 66 }),
            step('summer', { half: 'warming' }),
            step('winter', { half: 'cooling', below: 48, months: [12, 1] }),
            step('fall', { half: 'cooling', below: 70 }),
            step('summer'),
        ],
    },
    bluefish: {
        phases: {
            winter: phase('Winter', 'Bluefish winter offshore and off the Carolinas and Florida; farther north they are gone'),
            spring: phase('Spring', 'Bluefish arrive with the warming water, hungry after their migration'),
            summer: phase('Summer', 'Bluefish roam rips, inlets and the surf after bait schools'),
            fall: phase('Fall run', 'Bluefish blitz bait along the beaches as they migrate south', 'mullet and menhaden'),
        },
        steps: [
            step('winter', { below: 52 }),
            step('winter', { months: [1, 2] }),
            step('spring', { half: 'warming', below: 66 }),
            step('summer', { half: 'warming' }),
            step('fall', { half: 'cooling', below: 72 }),
            step('summer'),
        ],
    },
    pompano: {
        phases: {
            winter: phase('Winter', 'Most pompano have moved south or offshore; few are in the surf'),
            spring: phase('Spring run', 'Pompano move north along the beaches, feeding on sand fleas in the wash', 'sand fleas'),
            summer: phase('Summer', 'Pompano scatter along the beaches; early mornings in the first trough are best', 'sand fleas'),
            fall: phase('Fall run', 'Pompano school along the beaches as they migrate south: the year\'s best surf pompano fishing', 'sand fleas'),
        },
        steps: [
            step('winter', { below: 65 }),
            step('winter', { months: [1] }),
            step('spring', { half: 'warming', below: 78 }),
            step('summer', { half: 'warming' }),
            step('fall', { half: 'cooling', below: 80, months: [9, 10, 11, 12] }),
            step('summer'),
        ],
    },
    whiting: {
        phases: {
            cold: phase('Cold water', 'Whiting have moved to deeper troughs and inlets'),
            peak: phase('Peak season', 'Whiting school in the surf troughs and near inlets: their best season', 'shrimp and sand fleas'),
            summer: phase('Summer', 'Whiting are still in the surf but bite best early in the morning and on cooler days'),
        },
        steps: [step('cold', { below: 55 }), step('peak', { below: 74 }), step('summer')],
    },
    surfperch: {
        phases: {
            peak: phase('Peak season', 'Barred surfperch gather in the surf to mate and bear live young: the best surfperch fishing of the year', 'sand crabs'),
            summer: phase('Summer', 'Surfperch are scattered; corbina and croaker feed in the shallow wash', 'sand crabs'),
        },
        steps: [step('peak', { months: [12, 1, 2, 3, 4] }), step('summer')],
    },
};

/** Fish that share another fish's seasons. */
const ALIASES = { muskie: 'pike', fluke: 'flounder', corbina: 'surfperch', croaker: 'surfperch' };

const seasonsFor = (target) => SEASONS[target] ?? SEASONS[ALIASES[target]] ?? null;

/**
 * @typedef {object} SeasonalPhase
 * @property {string} id
 * @property {string} label     e.g. 'Pre-spawn'
 * @property {string} pattern   what the fish are doing, as a sentence without the full stop
 * @property {string|null} forage
 * @property {'warming'|'cooling'} half
 */

/**
 * The phase a fish is in.
 * @param {string} target
 * @param {{ date: Date, waterTempF: number, trend?: import('./water-trend.js').WaterTrend|null }} c
 * @returns {SeasonalPhase|null}  null for a fish with no seasons, or without a date
 */
export function seasonalPhase(target, { date, waterTempF, trend = null }) {
    const seasons = seasonsFor(target);
    if (!seasons || !(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    const half = seasonHalf(date, trend);
    const month = date.getMonth() + 1;
    const found = seasons.steps.find((entry) => (!entry.half || entry.half === half)
        && (entry.below === undefined || waterTempF < entry.below)
        && (!entry.months || entry.months.includes(month)));
    const id = found?.id ?? seasons.steps[seasons.steps.length - 1].id;
    return { id, ...seasons.phases[id], half };
}

export const knownSeasons = (target) => Boolean(seasonsFor(target));

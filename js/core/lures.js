// What to tie on, given the conditions.
//
// Unlike the score, this is not built on measured catch rates: almost nobody has measured
// lure choice against conditions. The rules follow what state fishery agencies publish in
// their "how to catch" guides, filled in from the angling press where agencies are silent
// (sources in the README). The page says so. Perch and salmon are general practice only.
//
// Each fish has a list of rules. A rule applies when its `when` matches the conditions;
// the heaviest applicable rules win.

import { temperatureZone } from './scoring.js';

/**
 * Conditions, already reduced to the handful of categories anglers think in.
 * @typedef {object} LureConditions
 * @property {number} waterTempF
 * @property {'cold'|'cool'|'prime'|'warm'|'hot'} [zone]  water temperature relative to the fish's own range (worked out per fish)
 * @property {'low'|'bright'|'dark'} light   low = dawn, dusk or heavy cloud; dark = night
 * @property {'clear'|'normal'|'stained'|'muddy'} clarity
 * @property {'calm'|'light'|'windy'} wind
 * @property {'fresh'|'inshore'|'surf'} [mode]
 * @property {'rising'|'falling'|'slack'|null} [tide]   salt water only
 * @property {'flat'|'moderate'|'rough'|null} [surf]    surf fishing only
 */

const always = () => true;
const cold = (c) => c.zone === 'cold';
const coolish = (c) => c.zone === 'cold' || c.zone === 'cool';
const hot = (c) => c.zone === 'warm' || c.zone === 'hot';
const lowLight = (c) => c.light === 'low';
const dark = (c) => c.light === 'dark';
const bright = (c) => c.light === 'bright';
const dirty = (c) => c.clarity === 'stained' || c.clarity === 'muddy';
const clear = (c) => c.clarity === 'clear';
const windy = (c) => c.wind === 'windy';
const calm = (c) => c.wind === 'calm' || c.wind === 'light';
const moving = (c) => c.tide === 'rising' || c.tide === 'falling';
const rising = (c) => c.tide === 'rising';
const falling = (c) => c.tide === 'falling';
const fromBeach = (c) => c.mode === 'surf';
const rough = (c) => c.surf === 'rough';

const all = (...tests) => (c) => tests.every((test) => test(c));
const any = (...tests) => (c) => tests.some((test) => test(c));
const not = (test) => (c) => !test(c);

/** rule(weight, when, name, search phrase, how to fish it, why now) */
const rule = (weight, when, name, query, how, why) => ({ weight, when, name, query, how, why });
/** Advice that replaces every lure for that fish when it applies, and has nothing to shop for. */
const instead = (when, name, how, why) => ({ weight: 100, when, name, query: null, how, why, exclusive: true });

const RULES = {
    // ----- Fresh water ---------------------------------------------------------
    bass: [
        rule(9, cold, 'Suspending jerkbait', 'suspending jerkbait',
            'Twitch it down, then let it hang for a long count, 10 seconds or more in the coldest water. Bites come on the pause.',
            'Cold bass will not chase, so keep it in front of them'),
        rule(8, cold, 'Jig with a low-action trailer', 'football jig',
            'Drag it slowly along the bottom. Leave the topwater at home.',
            'In cold water bass feed on slow, easy meals near the bottom'),
        rule(8, (c) => c.zone === 'cool', 'Spinnerbait or crankbait', 'spinnerbait 3/8 oz',
            'Cover shallow structure at a steady pace; start slower early in spring.',
            'As the water warms toward spawning, bass move shallow and will chase'),
        rule(7, (c) => c.zone === 'cool', 'Paddle-tail swimbait', 'paddle tail swimbait',
            'A slow, steady retrieve across points and flats.',
            'A natural baitfish shape for bass that are on the move'),
        rule(10, all(not(coolish), any(lowLight, dark), calm), 'Topwater popper or prop bait', 'topwater popper bass',
            'Work it on the surface with pauses and short jerks.',
            'Warm water, low light and a calm surface bring bass up to feed on top'),
        rule(9, all(windy, not(cold)), 'Spinnerbait or crankbait', 'spinnerbait 3/8 oz',
            'A steady retrieve along the windy bank; your speed sets the depth.',
            'Wind and chop suit lures that flash and move water'),
        rule(9, all(dirty, not(cold)), 'Large-blade spinnerbait', 'colorado blade spinnerbait chartreuse',
            'Slow and steady near shallow cover, in bright colours.',
            'In stained or muddy water bass find a lure by its vibration'),
        rule(7, all(dirty, not(cold)), 'Rattling or wide-bill crankbait', 'rattling crankbait',
            'Bump it into wood and rock in shallow water.',
            'Noise and a wide wobble carry in off-colour water'),
        rule(8, all(bright, not(coolish), not(dirty)), 'Plastic worm or jig', 'texas rig soft plastic worm',
            'Fish it slowly in deeper, cooler water and in shade.',
            'Bright sun and warm water push bass deeper'),
        rule(7, all(bright, clear, not(cold)), 'Finesse worm on a shaky head', 'shaky head jig finesse worm green pumpkin',
            'Small and slow on light line, in natural colours.',
            'Clear water under a high sun calls for a smaller, subtler offering'),
        rule(7, all(hot, bright), 'Deep-running crankbait', 'deep diving crankbait',
            'Work deeper structure where the water is cooler.',
            'By day in summer the better bass sit deep'),
        rule(3, always, 'Plastic worm', 'soft plastic worm bass',
            'Cast to cover and work it back slowly along the bottom.',
            'A dependable choice in most conditions'),
    ],
    panfish: [
        instead(dark, 'Wait for daylight',
            'Bluegill and other sunfish are best early and late in the day.',
            'Sunfish feed by sight and bite poorly after dark'),
        rule(7, (c) => c.zone === 'cool' || c.zone === 'cold', 'Minnow or small shad-shaped plastic under a slip float', 'crappie jig slip bobber',
            'Hang it 6 to 20 feet down beside brush and deeper cover.',
            'Crappie school in deeper water before they spawn'),
        rule(7, not(cold), 'Worm or tiny jig under a small bobber', '1/32 oz panfish jig',
            'Shallow when fish are spawning; 10 feet or more on a slip bobber in summer.',
            'The standard way to catch bluegill, and it rarely fails'),
        rule(4, always, 'Small tube or grub on a 1/32 oz jighead', 'crappie tube jig',
            'Natural colours most of the time; pink, orange or chartreuse for crappie on beds.',
            'A small bait kept at the depth of the school'),
    ],
    catfish: [
        rule(8, all(any(dark, lowLight, dirty), not(coolish)), 'Prepared "stink" bait on the bottom', 'catfish dip bait',
            'A slip sinker keeps it on the bottom while the fish runs with it.',
            'Catfish feed by smell, best in low light and on stable or rising water'),
        rule(8, all(any(dark, lowLight, dirty), coolish), 'Cut bait on the bottom', 'catfish circle hooks slip sinker',
            'Fish it on a slip-sinker rig and give it time.',
            'In cool water catfish take cut bait over prepared baits'),
    ],
    walleye: [
        rule(9, cold, 'Jig and minnow', 'walleye jig 1/4 oz',
            'A 1/8 to 1/4 oz jig on the bottom. The slower the better.',
            'Cold walleye hug the bottom and take slow, small baits'),
        rule(6, cold, 'Blade bait', 'blade bait',
            'Lift it 6 to 18 inches off the bottom and let it drop.',
            'A subtle vibration for sluggish fish'),
        rule(10, all(not(cold), any(lowLight, dark)), 'Shallow-running minnow crankbait', 'shallow minnow crankbait',
            'Cast or troll it over riffles and shallows.',
            'Walleye move shallow to feed in low light and after dark'),
        rule(8, all(not(cold), bright), 'Nightcrawler or leech on a slip-sinker rig or crawler harness', 'crawler harness',
            'Keep it near the bottom along deep weed edges, at about 1 mph.',
            'By day in the warm months walleye hold deeper'),
        rule(7, all(not(cold), bright), 'Trolled crankbait', 'walleye crankbait',
            'Bright patterns in stained water; silver, gold, blue or black in clear water.',
            'Covers the deeper water walleye use by day'),
        rule(7, all(not(cold), windy), 'Heavier jig, 1/4 oz or more', 'walleye jig 3/8 oz',
            'Just heavy enough to keep touching the bottom.',
            'Wind and current lift a light jig out of the strike zone'),
        rule(5, not(cold), 'Light jig with a twister tail', 'walleye jig 1/8 oz twister tail',
            'Swim it just off the bottom.',
            'A simple search bait for active fish'),
    ],
    pike: [
        instead(dark, 'Wait for daylight',
            'Come back when there is light on the water.',
            'Pike hunt by sight and bite poorly at night'),
        rule(9, cold, 'Dead bait on a quick-strike rig', 'quick strike rig',
            'Under a float or on the bottom in shallow bays, with an occasional lift.',
            'From ice-out until the water reaches about 50°F, pike scavenge rather than chase'),
        rule(8, not(cold), 'Spoon', 'pike spoon',
            'Slow and steady, then stop and let it flutter. Use a steel or fluorocarbon leader.',
            'In the one study that compared them, spoons out-caught spinnerbaits for pike'),
        rule(7, not(cold), 'Minnow-shaped plug or jerkbait', 'pike jerkbait',
            'Perch or sucker patterns are traditional. Use a leader.',
            'Looks like the fish pike eat'),
    ],
    smallmouth: [
        rule(8, cold, 'Small plastic grub on a jighead, fished slowly', '3 inch grub jig',
            'Crawl it along the bottom. Expect few bites.',
            'Smallmouth are hard to catch below about 50°F'),
        rule(8, not(cold), 'Plastic grub on a jighead', '3 inch grub jig',
            'Hop it over rock and gravel.',
            'Smallmouth take smaller lures than largemouth do'),
        rule(7, not(cold), 'Small crankbait', 'small crankbait smallmouth',
            'Bounce it off rocky bottom.',
            'Imitates the crayfish and minnows smallmouth feed on'),
        rule(6, not(cold), 'Inline spinner', 'inline spinner 1/8 oz',
            'Cast across current seams and retrieve steadily.',
            'A good search lure in rivers'),
    ],
    perch: [
        rule(6, always, 'Small jig tipped with a minnow or worm', 'perch jig small',
            'Fish it within a foot of the bottom; move until you find the school.',
            'Perch feed near the bottom in schools'),
    ],
    sauger: [
        rule(6, always, 'Jig and minnow', 'walleye jig 1/4 oz',
            'Keep it on the bottom in current breaks and below dams.',
            'Sauger sit deep in river current'),
    ],
    trout: [
        instead((c) => c.zone === 'hot', 'Give the trout a rest',
            'Fish for something else today, or come back at first light after a cool night.',
            'Water this warm stresses trout, and many die after being released'),
        rule(9, dirty, 'Worm with extra split shot', 'trout worm hooks size 8 split shot',
            'Keep it within inches of the bottom. Heavier line is fine in murky water.',
            'In high, off-colour water trout hold near the bottom and find food by smell'),
        rule(8, all(clear, bright, not(dirty)), 'Small bait on a 2 to 4 lb leader', '4 lb fluorocarbon leader',
            'Stay low and quiet, and leave the split shot off unless the water is up.',
            'Low, clear water under a bright sky makes trout wary'),
        rule(7, not(dirty), 'Small spinner or spoon', 'inline spinner 1/8 oz',
            'Cast slightly upstream and retrieve at a moderate pace; vary how long you let it sink.',
            'The first thing to try in normal flows'),
        rule(5, not(dirty), 'Bait drifted slowly', 'trout worm hooks size 8',
            'Switch to it when spinners and spoons draw nothing.',
            'A slower presentation for fish that will not chase'),
        rule(4, always, 'Bait under a bobber, or floating bait off the bottom', 'floating trout bait',
            'In lakes: a bobber 1.5 to 3 feet above the hook when fish cruise high, or a weight 1.5 feet above a floating bait when they are deep.',
            'The standard approach for trout in lakes and ponds'),
    ],
    salmon: [
        rule(6, always, 'Spoon or large spinner', 'salmon spoon lure',
            'Cast across and swing it through holding water, or troll it.',
            'Flash draws strikes from salmon'),
    ],

    // ----- Salt water ------------------------------------------------------------
    seatrout: [
        rule(9, cold, 'Slow-sinking, fish-shaped plug', 'suspending twitchbait',
            'Work it very slowly through deep channels and holes.',
            'Cold seatrout drop into deep water and will not chase'),
        rule(9, all(not(cold), lowLight), 'Walk-the-dog topwater plug', 'topwater walking lure saltwater',
            'Walk it over shallow grass.',
            'Seatrout feed on top at dawn, at dusk and under cloud'),
        rule(8, all(not(cold), dark), 'Jig under dock or bridge lights', 'soft plastic jig head 1/4 oz saltwater',
            'Cast to the edge of the light and swim it through.',
            'At night seatrout gather where lights draw bait'),
        rule(8, not(cold), 'Popping cork with live shrimp or a soft-plastic shrimp', 'popping cork rig',
            'Pop it now and then over grass flats: shallow early and late, the deeper edges at midday.',
            'The standard way to find seatrout over grass'),
        rule(5, not(cold), 'Soft plastic on a jighead', 'soft plastic shrimp',
            'Hot pink, root beer, dark red and white are the traditional colours.',
            'Covers water between the grass beds'),
    ],
    redfish: [
        rule(9, all(fromBeach, any(rising, dark)), 'Cut mullet or crab on a fish-finder rig', 'fish finder rig circle hook 8/0',
            'A 3 to 8 oz sinker, cast into the sloughs between the bars.',
            'Surf redfish work the sloughs on a rising tide and after dark'),
        rule(7, fromBeach, 'Cut mullet or crab on a fish-finder rig', 'fish finder rig circle hook 8/0',
            'A 3 to 8 oz sinker, cast into the sloughs between the bars.',
            'The standard bait for redfish in the surf'),
                rule(6, fromBeach, 'Heavy spoon or slow-sinking plug', 'casting spoon 2 oz',
            'Cast along the slough and retrieve just off the bottom.',
            'A way to cover water when bait is not drawing bites'),
        rule(9, all(not(fromBeach), moving), 'Gold spoon, weedless in grass', 'gold weedless spoon 1/4 oz',
            'A 1/4 to 1/2 oz spoon bounced along the bottom of flats and marsh edges. Gold, copper and silver are the standards.',
            'Redfish feed across the flats while the tide is moving'),
        rule(7, not(fromBeach), 'Soft plastic on a 1/4 oz jighead, tipped with shrimp', 'paddle tail jighead 1/4 oz',
            'Hop it along the bottom beside oysters and creek mouths. Chartreuse and smoke are traditional.',
            'A dependable choice around structure'),
        rule(6, not(fromBeach), 'Live bait under a popping cork', 'popping cork rig',
            'Set the cork so the bait rides near the bottom next to structure.',
            'Keeps a bait in front of fish holding in one place'),
    ],
    flounder: [
        rule(9, moving, 'Bucktail jig tipped with squid or a minnow', 'bucktail jig 1 oz white',
            'Drag it slowly and keep it on the bottom. Pause before you set the hook. White and chartreuse are the standards.',
            'Flounder lie in wait for bait carried past on a moving tide'),
        rule(7, always, 'Swimbait on a jighead', 'flounder swimbait jig head',
            'A 1/4 to 1 oz head, heavy enough to stay on the bottom.',
            'Covers the bottom where flounder lie'),
        rule(6, always, 'Carolina rig with a live minnow', 'flounder rig',
            'Ease it along the bottom beside drop-offs and creek mouths.',
            'Natural bait for fish that will not move far'),
    ],
    snook: [
        instead((c) => c.waterTempF <= 58, 'Leave the snook alone',
            'Try redfish or seatrout instead, or wait for a run of warm days.',
            'Snook stop feeding at about 58°F and can die if the cold lasts'),
        rule(10, all(dark, falling), 'Live pinfish or shrimp on a circle hook', 'circle hook 4/0',
            'Cast up-current of a bridge, or to the edge of a dock light, and let it sweep through.',
            'Snook feed at night through the first hours of the outgoing tide'),
        rule(8, (c) => c.waterTempF < 65, 'Soft-plastic grub or minnow plug, worked slowly', 'soft plastic jerkbait',
            'Slow everything down.',
            'Snook turn sluggish below about 65°F'),
        rule(7, dark, 'Live bait around bridge and dock lights', 'circle hook 4/0',
            'Fish the shadow line, where the light ends.',
            'Snook hunt the edges of lit water at night'),
        rule(7, not(dark), 'Live shrimp or pinfish on a circle hook', 'circle hook 4/0',
            'Free-line it beside mangroves, docks and bridge pilings.',
            'Live bait is the most dependable way to catch snook'),
        rule(6, always, 'Soft-plastic jerkbait or minnow plug', 'soft plastic jerkbait',
            'Work it along mangrove edges, docks and passes.',
            'Covers the structure snook hold on'),
    ],
    striper: [
        rule(10, all(any(dark, lowLight), moving), 'Live or soft-plastic eel', 'soft plastic eel',
            'Fish it slowly. Black on dark nights.',
            'Striped bass feed best in low light on a moving tide'),
        rule(8, any(dark, lowLight), 'Swimming minnow plug', 'minnow plug striped bass',
            'A slow, steady retrieve across current.',
            'A low-light standard for stripers in shallow water'),
        rule(7, always, 'Bucktail jig', 'bucktail jig',
            'Keep it near the bottom and work it slowly. White by day, chartreuse in rough or dirty water.',
            'Works at every depth and in any light'),
        rule(6, bright, 'Pencil popper', 'pencil popper',
            'Use it when you can see fish feeding on top.',
            'Active stripers will come up for a surface lure'),
    ],
    bluefish: [
        rule(9, any(dirty, rough), 'Cut bait on a fish-finder rig', 'fish finder rig wire leader',
            'On the bottom, with a wire or heavy mono leader.',
            'In murky water bluefish find food by smell'),
        rule(9, not(any(dirty, rough)), 'Metal spoon or diamond jig', 'casting spoon 2 oz',
            'Cast far and retrieve fast and steady. Use a wire or heavy mono leader.',
            'In clean water bluefish run down fast-moving flash'),
        rule(7, not(any(dirty, rough)), 'Popper', 'saltwater popper',
            'White or powder blue when mullet are running.',
            'Bluefish feeding near the surface will hit on top'),
    ],
    pompano: [
        rule(9, always, 'Pompano rig with sand fleas, clam or shrimp', 'pompano rig',
            'Fish it in the white water close in, not far out, with a 4 to 6 oz pyramid sinker.',
            'Pompano feed in the wash, best on an incoming tide at first and last light'),
        rule(6, always, 'Pompano jig', 'pompano jig',
            'Short hops along the bottom. Pink, chartreuse and yellow are the standards.',
            'A way to search the beach for a school'),
    ],
    whiting: [
        rule(8, always, 'Two-hook bottom rig with cut shrimp', 'double drop bottom rig',
            'Small hooks (No. 1 to 1/0), on the bottom in the sloughs.',
            'Whiting feed on the bottom close to the beach, best on an incoming tide'),
        rule(5, always, 'Scented bait strips on the same rig', 'scented bait strips',
            'A stand-in when you have no fresh shrimp.',
            'Stays on the hook in the surf'),
    ],
    surfperch: [
        rule(9, always, 'Scented sandworm or grub on a Carolina rig', 'surfperch rig scented sandworm',
            'A 1/2 to 1 oz egg sinker, cast just past the breaking waves. Fish are often within 30 feet of the sand.',
            'Surf fish feed in the wash from the incoming to the high tide, best early and near dusk in mild surf'),
        rule(7, always, 'Sand crabs, mussels or marine worms on a two-hook rig', 'pyramid sinker 3 oz surf rig',
            'Size 4 or 2 hooks above a 2 to 6 oz pyramid sinker.',
            'The natural food of the surf zone'),
    ],
};

/** Fish that share a list with another fish. */
const ALIASES = { muskie: 'pike', fluke: 'flounder', halibut: 'flounder', corbina: 'surfperch', croaker: 'surfperch' };

/** Whose temperature range each fish is judged against (see SPECIES_GROUPS in scoring.js). */
const THERMAL_GROUP = {
    bass: 'warm', panfish: 'warm', catfish: 'warm',
    walleye: 'cool', pike: 'cool', muskie: 'cool', smallmouth: 'cool', perch: 'cool', sauger: 'cool',
    trout: 'cold', salmon: 'cold',
    snook: 'tropical', pompano: 'tropical',
    seatrout: 'warmsalt', redfish: 'warmsalt', flounder: 'warmsalt', whiting: 'warmsalt',
    striper: 'coolsalt', bluefish: 'coolsalt', fluke: 'coolsalt',
    halibut: 'pacwarm', corbina: 'pacwarm', croaker: 'pacwarm', surfperch: 'pacwarm',
};

/** How each fish is named on the page, where that differs from its id. */
const TARGET_LABELS = { striper: 'striped bass', seatrout: 'speckled trout' };

export const knownTarget = (target) => (ALIASES[target] ?? target) in RULES;

function matching(target, conditions) {
    // "Cold" means something different to a trout than to a bass.
    const forThisFish = { ...conditions, zone: temperatureZone(conditions.waterTempF, THERMAL_GROUP[target]) };
    const rules = (RULES[ALIASES[target] ?? target] ?? [])
        .filter((entry) => entry.when(forThisFish))
        .sort((a, b) => b.weight - a.weight);
    return rules[0]?.exclusive ? [rules[0]] : rules;
}

/**
 * Up to `limit` recommendations for the fish in `targets` (most important first).
 * The first fish gets two picks, the others one each, and any room left goes back to the first.
 *
 * @param {string[]} targets
 * @param {LureConditions} conditions
 * @returns {Array<{ target: string, name: string, how: string, why: string, query: string|null }>}
 *   `query` is what a shopper would search for; null when the advice is not a product.
 */
export function recommendLures(targets, conditions, { limit = 3 } = {}) {
    const lists = targets.filter(knownTarget).map((target) => ({ target, rules: matching(target, conditions) }));
    const picks = [];
    const taken = new Set();
    const take = (list) => {
        const next = list.rules.find((entry) => !taken.has(entry.name));
        if (!next || picks.length >= limit) return false;
        taken.add(next.name);
        picks.push({ target: TARGET_LABELS[list.target] ?? list.target, name: next.name, how: next.how, why: next.why, query: next.query, weight: next.weight });
        return true;
    };

    lists.forEach((list, index) => {
        take(list);
        if (index === 0) take(list);
    });
    let added = true;
    while (picks.length < limit && added) {
        added = false;
        for (const list of lists) added = take(list) || added;
    }
    // Keep each fish's picks together, in the order the fish were given.
    const order = new Map(lists.map((list, index) => [TARGET_LABELS[list.target] ?? list.target, index]));
    return picks
        .sort((a, b) => order.get(a.target) - order.get(b.target) || b.weight - a.weight)
        .map(({ weight, ...pick }) => pick); // eslint-disable-line no-unused-vars
}

/**
 * One line on colour. Tradition has rules for it; the two studies that tested lure colour
 * against catch rate (largemouth bass, and pike) found it made no difference, so the line says both.
 */
export function colourAdvice({ clarity, light }) {
    const tested = 'The two studies that tested lure colour found no effect on catch rate, so do not agonise over it.';
    if (light === 'dark') return `Colour: tradition says black after dark, for the silhouette. ${tested}`;
    if (clarity === 'muddy' || clarity === 'stained') return `Colour: tradition says bright, vivid colours (chartreuse, white) and plenty of vibration in off-colour water. ${tested}`;
    if (clarity === 'clear') return `Colour: tradition says natural colours and lighter line in clear water. ${tested}`;
    return `Colour: natural patterns that match the local bait are the usual advice. ${tested}`;
}

const TURBIDITY_STAINED_FNU = 10;
const TURBIDITY_MUDDY_FNU = 50;

/**
 * Reduce raw readings to LureConditions.
 * @param {object} raw
 * @param {number} raw.waterTempF
 * @param {'dawn'|'dusk'|'day'|'night'} raw.phase   from the light factor
 * @param {string} raw.sky                          sky class
 * @param {number} raw.windMph
 * @param {number|null} [raw.turbidityFnu]          measured, where a station has it
 * @param {number|null} [raw.flowPercentile]        river flow against normal, the next-best clue to clarity
 * @param {'fresh'|'inshore'|'surf'} [raw.mode]
 * @param {'rising'|'falling'|'slack'|null} [raw.tide]
 * @param {number|null} [raw.waveFt]
 */
export function lureConditions({
    waterTempF, phase, sky, windMph, turbidityFnu = null, flowPercentile = null, mode = 'fresh', tide = null, waveFt = null,
}) {
    let light = 'bright';
    if (phase === 'night') light = 'dark';
    else if (phase === 'dawn' || phase === 'dusk' || ['overcast', 'light-precip', 'precip', 'storm'].includes(sky)) light = 'low';

    let clarity = 'normal';
    if (typeof turbidityFnu === 'number') {
        clarity = turbidityFnu >= TURBIDITY_MUDDY_FNU ? 'muddy' : turbidityFnu >= TURBIDITY_STAINED_FNU ? 'stained' : 'clear';
    } else if (typeof flowPercentile === 'number') {
        if (flowPercentile > 90) clarity = 'muddy';
        else if (flowPercentile > 75) clarity = 'stained';
        else if (flowPercentile < 25) clarity = 'clear';
    }

    const wind = windMph >= 12 ? 'windy' : windMph >= 4 ? 'light' : 'calm';
    let surf = null;
    if (typeof waveFt === 'number') surf = waveFt > 4 ? 'rough' : waveFt >= 1 ? 'moderate' : 'flat';
    return { waterTempF, light, clarity, wind, mode, tide, surf };
}

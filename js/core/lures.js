// What to tie on, given the season and the conditions.
//
// Unlike the score, this is not built on measured catch rates: almost nobody has measured
// lure choice against conditions. The rules follow what state fishery agencies publish in
// their "how to catch" guides, filled in from the angling press where
// agencies are silent (sources in the README). The page says so.
//
// Three layers decide what is suggested:
//
//   1. The season. Each fish is placed in a phase of its year (pre-spawn, spawn, the fall
//      feed…) from the date, the water temperature and which way it has been heading for
//      the last week or two (see season.js). Some rules apply only in certain phases, and
//      others are favoured in them.
//   2. The moment: light, wind, water clarity, and in salt water the tide and the surf.
//   3. What has changed lately: a cold snap or warm spell in the water, a cold front just
//      through or one on its way, a lake rising into new cover or falling away from it.
//      These do not add rules; they push presentations up or down (slow and deep after a
//      sudden chill, shallow when the lake rises), through tags on each rule.

import { temperatureZone } from './scoring.js';
import { seasonalPhase } from './season.js';

/**
 * Conditions, already reduced to the handful of categories anglers think in.
 * @typedef {object} LureConditions
 * @property {number} waterTempF
 * @property {'cold'|'cool'|'prime'|'warm'|'hot'} [zone]  water temperature relative to the fish's own range (worked out per fish)
 * @property {import('./season.js').SeasonalPhase|null} [season]  the fish's phase of the year (worked out per fish)
 * @property {'low'|'bright'|'dark'} light   low = dawn, dusk or heavy cloud; dark = night
 * @property {'clear'|'normal'|'stained'|'muddy'} clarity
 * @property {'calm'|'light'|'windy'} wind
 * @property {'fresh'|'inshore'|'surf'} [mode]
 * @property {'rising'|'falling'|'slack'|null} [tide]   salt water only
 * @property {'flat'|'moderate'|'rough'|null} [surf]    surf fishing only
 * @property {Date|null} [date]                          the local date, for the season
 * @property {import('./water-trend.js').WaterTrend|null} [trend]  the last few weeks of water temperature
 * @property {'approaching'|'passed'|null} [front]
 * @property {'rising'|'falling'|null} [level]          a lake or reservoir, fresh water only
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
const season = (...ids) => (c) => ids.includes(c.season?.id);

const all = (...tests) => (c) => tests.every((test) => test(c));
const any = (...tests) => (c) => tests.some((test) => test(c));
const not = (test) => (c) => !test(c);

// Presentation tags, which the recent changes (SITUATIONS) push up or down:
//   slow, finesse, reaction (fast, flashy or loud), topwater, bottom, shallow, deep, bait (natural or live bait)

/**
 * rule(weight, when, name, search phrase, how to fish it, why now, { best, tags })
 * `best` lists the seasonal phases in which the rule is favoured.
 */
const rule = (weight, when, name, query, how, why, { best = [], tags = [] } = {}) => ({ weight, when, name, query, how, why, best, tags });
/** A rule for certain phases of the fish's year only (and favoured in them). */
const during = (phases, weight, when, name, query, how, why, tags = []) => rule(weight, all(season(...phases), when), name, query, how, why, { best: phases, tags });
/** Advice that replaces every lure for that fish when it applies, and has nothing to shop for. */
const instead = (when, name, how, why) => ({ weight: 100, when, name, query: null, how, why, best: [], tags: [], exclusive: true });

/** Added to a rule's weight in the phases it lists as `best`. */
const SEASON_BONUS = 3;
/** Bass phases outside winter: muddy water calls for vibration in all of them. */
const WARM_PHASES = ['prespawn', 'spawn', 'postspawn', 'summer', 'fall', 'latefall'];

const RULES = {
    // ----- Fresh water ---------------------------------------------------------
    bass: [
        // Winter and the coldest water
        rule(9, any(cold, season('prespawn', 'latefall')), 'Suspending jerkbait', 'suspending jerkbait',
            'Twitch it down, then let it hang: 10 seconds or more in the coldest water. Bites come on the pause.',
            'Cool-water bass will not chase far, so keep the bait in front of them',
            { best: ['prespawn', 'latefall', 'winter'], tags: ['slow'] }),
        rule(8, cold, 'Jig with a low-action trailer', 'football jig',
            'Drag it slowly along the bottom. Leave the topwater at home.',
            'In cold water bass feed on slow, easy meals near the bottom', { best: ['winter'], tags: ['bottom', 'slow', 'deep'] }),
        during(['winter'], 7, always, 'Blade bait or jigging spoon', 'blade bait',
            'Over deep schools on channel bends and bluff ends: lift it a foot or two and let it fall back on a slack line.',
            'Winter bass bunch up deep and strike a fluttering fall', ['deep', 'slow']),
        during(['winter', 'summer'], 6, not(dark), 'Drop-shot finesse worm', 'drop shot rig bass',
            'Hold it in place over fish on deep structure, shaking the line rather than moving the weight.',
            'A small bait that stays in front of bass that will not move far', ['finesse', 'deep', 'slow']),

        // Pre-spawn
        during(['prespawn'], 9, always, 'Lipless crankbait', 'lipless crankbait 1/2 oz',
            'Rip it free from the tops of new grass on flats next to spawning pockets. Red and orange are the early-spring tradition.',
            'Pre-spawn bass feed hard on the flats they are about to spawn on', ['reaction', 'shallow']),
        during(['prespawn'], 8, always, 'Jig with a craw trailer', 'bass jig craw trailer',
            'Drag and hop it on rock and gravel along the first drop off the spawning flats.',
            'Crawfish come out as the water warms, and bass key on them', ['bottom', 'slow']),
        during(['prespawn', 'fall'], 7, always, 'Squarebill crankbait', 'squarebill crankbait',
            'Bang it off stumps, rock and dock posts in 1 to 5 feet.',
            'Deflecting off cover sets off bass that have moved shallow', ['reaction', 'shallow']),
        during(['prespawn'], 6, always, 'Spinnerbait', 'spinnerbait 3/8 oz',
            'Slow-roll it along banks that catch the afternoon sun.',
            'The warmest banks hold the most active pre-spawn bass', ['reaction', 'shallow']),
        during(['prespawn', 'latefall'], 7, always, 'Paddle-tail swimbait', 'paddle tail swimbait',
            'A slow, steady retrieve across points and flats.',
            'A natural baitfish shape for bass moving between deep and shallow water'),

        // Spawn and post-spawn
        during(['spawn'], 10, always, 'Soft-plastic lizard or creature bait', 'soft plastic lizard bass',
            'Pitch it past a bed you can see and ease it into the middle; wait for the bass to pick it up, and let bedding fish go quickly.',
            'Bass guarding beds strike to drive off intruders, not to feed', ['slow', 'shallow', 'finesse']),
        during(['spawn', 'postspawn'], 8, always, 'Wacky-rigged stick worm', 'wacky rig stick worm',
            'Cast to shallow cover and let it fall on a slack line; most bites come as it sinks.',
            'A slow, shimmying fall that shallow bass find hard to refuse', ['finesse', 'slow', 'shallow']),
        rule(10, all(not(coolish), any(lowLight, dark), calm), 'Topwater popper or prop bait', 'topwater popper bass',
            'Work it on the surface with pauses and short jerks.',
            'Warm water, low light and a calm surface bring bass up to feed on top',
            { best: ['postspawn', 'summer', 'fall'], tags: ['topwater', 'shallow'] }),
        during(['postspawn', 'summer', 'fall'], 7, not(dark), 'Swim jig or bladed jig', 'bladed swim jig',
            'Swim it along grass edges and over shallow flats.',
            'Covers the grass edges where bass ambush bluegill and shad', ['reaction', 'shallow']),

        // Summer
        during(['summer'], 8, not(dark), 'Carolina- or Texas-rigged worm on offshore structure', 'carolina rig bass',
            'Drag it across ledges, humps and points 10 to 25 feet down.',
            'In summer many bass live offshore on structure next to deep water', ['bottom', 'deep', 'slow']),
        during(['summer'], 9, dark, 'Black spinnerbait or a big dark worm', 'colorado blade spinnerbait black',
            'Slow-roll the spinnerbait along shallow cover, or crawl the worm. Black for the silhouette.',
            'In the heat of summer bass feed most after dark', ['shallow']),
        during(['summer', 'postspawn'], 7, all(calm, not(dark)), 'Hollow-body frog', 'hollow body frog',
            'Walk it over matted grass and lily pads, and wait a beat before setting the hook.',
            'Bass bury under matted cover for shade and blow up on a frog crossing the top', ['topwater', 'shallow']),
        rule(7, all(hot, bright), 'Deep-running crankbait', 'deep diving crankbait',
            'Work deeper structure where the water is cooler.',
            'By day in summer the better bass sit deep', { best: ['summer'], tags: ['deep', 'reaction'] }),

        // Fall
        during(['fall'], 9, always, 'Lipless crankbait', 'lipless crankbait 1/2 oz',
            'Burn it across flats and creek-arm points, especially where shad are flicking at the surface.',
            'In fall bass follow the shad into the creek arms and chase them hard', ['reaction', 'shallow']),
        during(['fall', 'latefall'], 8, always, 'White spinnerbait', 'spinnerbait white 3/8 oz',
            'Run it along banks, wood and the backs of creeks; willow-leaf blades for flash.',
            'Matches the shad bass are feeding on as the water cools', ['reaction', 'shallow']),
        during(['fall'], 7, not(windy), 'Walking topwater bait', 'topwater walking bait',
            'Walk it over schooling fish and shallow flats; on cloudy days, all day.',
            'Fall bass push shad to the surface and hit on top later into the day', ['topwater', 'shallow']),

        // Any season: wind, colour and light
        rule(9, all(windy, not(cold)), 'Spinnerbait or crankbait', 'spinnerbait 3/8 oz',
            'A steady retrieve along the windy bank; your speed sets the depth.',
            'Wind and chop suit lures that flash and move water', { tags: ['reaction'] }),
        rule(9, all(dirty, not(cold)), 'Large-blade spinnerbait', 'colorado blade spinnerbait chartreuse',
            'Slow and steady near shallow cover, in bright colours.',
            'In stained or muddy water bass find a lure by its vibration', { best: WARM_PHASES, tags: ['reaction', 'shallow'] }),
        rule(7, all(dirty, not(cold)), 'Rattling or wide-bill crankbait', 'rattling crankbait',
            'Bump it into wood and rock in shallow water.',
            'Noise and a wide wobble carry in off-colour water', { best: WARM_PHASES, tags: ['reaction'] }),
        rule(8, all(bright, not(coolish), not(dirty)), 'Plastic worm or jig', 'texas rig soft plastic worm',
            'Fish it slowly in deeper, cooler water and in shade.',
            'Bright sun and warm water push bass deeper', { best: ['summer'], tags: ['slow', 'bottom', 'deep'] }),
        rule(7, all(bright, clear, not(cold)), 'Finesse worm on a shaky head', 'shaky head jig finesse worm green pumpkin',
            'Small and slow on light line, in natural colours.',
            'Clear water under a high sun calls for a smaller, subtler offering', { tags: ['finesse', 'slow'] }),
        rule(3, always, 'Plastic worm', 'soft plastic worm bass',
            'Cast to cover and work it back slowly along the bottom.',
            'A dependable choice in most conditions', { tags: ['slow', 'bottom'] }),
    ],
    panfish: [
        instead(dark, 'Wait for daylight',
            'Bluegill and other sunfish are best early and late in the day.',
            'Sunfish feed by sight and bite poorly after dark'),
        during(['winter'], 8, always, 'Small jig held over deep schools', 'crappie jig 1/16 oz',
            'Find schools on the sonar over channel edges and basins and hold the jig just above them. Through the ice, a tiny jig tipped with a wax worm.',
            'Winter panfish school tight in deep water and will not chase far', ['slow', 'deep', 'finesse']),
        during(['prespawn'], 8, always, 'Minnow or shad-shaped plastic under a slip float', 'crappie jig slip bobber',
            'Hang it 6 to 12 feet down beside brush and channel edges near the spawning flats.',
            'Pre-spawn crappie stage on the first deep cover outside the spawning areas', ['slow']),
        during(['prespawn', 'fall'], 6, always, 'Small crankbait, trolled or cast', 'crappie crankbait',
            'Pull it along channel edges at 1 to 1.5 mph.',
            'Covers water to find roaming crappie', ['reaction']),
        during(['spawn'], 9, always, 'Tiny jig under a float near shallow cover', '1/32 oz panfish jig',
            'Set the float 1 to 3 feet deep and drift it past reeds, brush and docks in 2 to 6 feet.',
            'Spawning crappie hold tight to shallow cover', ['shallow']),
        during(['bluegill'], 9, always, 'Worm or cricket on a small hook near the beds', 'panfish hooks size 8',
            'Look for clusters of pale, saucer-shaped beds in shallow water and fish around their edges.',
            'Bluegill nest in colonies and bite readily while guarding them', ['shallow', 'bait']),
        during(['fall'], 8, always, 'Small swimbait counted down to the school', 'crappie swimbait 1/16 oz jighead',
            'Find shad and crappie in open water on the sonar or under feeding birds, count the jig down to them and swim it back.',
            'Fall crappie roam open water with the shad', ['reaction']),
        rule(7, not(cold), 'Worm or tiny jig under a small bobber', '1/32 oz panfish jig',
            'Shallow when fish are spawning; 10 feet or more on a slip bobber in summer.',
            'The standard way to catch bluegill, and it rarely fails', { best: ['summer'], tags: ['bait'] }),
        rule(5, not(cold), 'Small inline spinner', 'inline spinner 1/16 oz',
            'Cast along weed edges and retrieve just fast enough to turn the blade.',
            'A quick way to find active sunfish', { tags: ['reaction'] }),
        rule(4, always, 'Small tube or grub on a 1/32 oz jighead', 'crappie tube jig',
            'Natural colours most of the time; pink, orange or chartreuse for crappie on beds.',
            'A small bait kept at the depth of the school', { tags: ['finesse'] }),
    ],
    catfish: [
        during(['winter'], 9, always, 'Cut shad on the bottom in deep holes', 'catfish circle hooks slip sinker',
            'Anchor over deep holes and channel bends with fresh-cut shad or skipjack, and give it time.',
            'Winter catfish, blue catfish above all, hold deep and scavenge dead baitfish', ['bottom', 'slow', 'deep', 'bait']),
        during(['prespawn'], 9, always, 'Cut bait or nightcrawlers where muddy water enters', 'catfish rig slip sinker',
            'Fish creek mouths and inflows after rain, on the bottom just out of the current.',
            'Pre-spawn catfish feed heavily on what spring rain washes in', ['bottom', 'bait']),
        during(['spawn'], 8, always, 'Prepared bait close to rock and undercut banks', 'catfish dip bait',
            'Fish slowly along riprap, rocky banks and undercuts; expect a slower bite.',
            'Spawning channel catfish hold in holes and cavities and feed less', ['bottom', 'slow', 'bait']),
        rule(8, all(any(dark, lowLight, dirty), not(coolish)), 'Prepared "stink" bait on the bottom', 'catfish dip bait',
            'A slip sinker keeps it on the bottom while the fish runs with it.',
            'Catfish feed by smell, best in low light and on stable or rising water', { best: ['summer'], tags: ['bottom', 'bait'] }),
        rule(8, all(any(dark, lowLight, dirty), coolish), 'Cut bait on the bottom', 'catfish circle hooks slip sinker',
            'Fish it on a slip-sinker rig and give it time.',
            'In cool water catfish take cut bait over prepared baits', { tags: ['bottom', 'bait'] }),
        during(['summer'], 7, not(dark), 'Bait drifted along channel drops', 'santee cooper rig',
            'Drift or anchor along channel drops in 10 to 25 feet by day; move up onto shallow flats after dark.',
            'By day in summer catfish hold deeper, near current', ['bottom', 'deep', 'bait']),
        during(['fall'], 9, always, 'Cut shad near bait schools and below dams', 'cut bait catfish rig',
            'Fish fresh-cut shad near schools of bait, below dams and on flats next to the channel.',
            'Cooling water and dying shad set off a fall feeding binge', ['bottom', 'bait']),
        rule(4, always, 'Nightcrawlers on the bottom', 'catfish hooks slip sinker',
            'A gob of nightcrawlers on a slip-sinker rig.',
            'A dependable bait for channel catfish anywhere', { tags: ['bottom', 'bait'] }),
    ],
    walleye: [
        during(['spawn'], 10, always, 'Jig and minnow in the current', 'walleye jig 1/4 oz',
            'Below dams and over rocky spawning areas: a 1/8 to 3/8 oz jig, just heavy enough to tick the bottom. Check the season first: many states close it during the spawn.',
            'Walleye crowd the rivers and rocky shoals to spawn, and the males keep feeding', ['slow', 'bottom']),
        rule(9, cold, 'Jig and minnow', 'walleye jig 1/4 oz',
            'A 1/8 to 1/4 oz jig on the bottom. The slower the better.',
            'Cold walleye hug the bottom and take slow, small baits', { best: ['winter', 'latefall'], tags: ['slow', 'bottom'] }),
        rule(6, cold, 'Blade bait', 'blade bait',
            'Lift it 6 to 18 inches off the bottom and let it drop.',
            'A subtle vibration for sluggish fish', { best: ['winter', 'latefall'], tags: ['deep'] }),
        during(['winter'], 8, always, 'Jigging spoon tipped with a minnow head', 'walleye jigging spoon',
            'Snap it up a foot or two and let it fall back on a tight line near the bottom, through the ice or in open water.',
            'Winter walleye strike an erratic fall near the bottom', ['deep']),
        rule(10, all(any(not(cold), season('spawn', 'postspawn', 'fall', 'latefall')), any(lowLight, dark)),
            'Shallow-running minnow crankbait', 'shallow minnow crankbait',
            'Cast or troll it over rocky shorelines, riffles and shallow flats.',
            'Walleye move shallow to feed in low light and after dark',
            { best: ['spawn', 'postspawn', 'earlysummer', 'fall'], tags: ['reaction', 'shallow'] }),
        during(['postspawn'], 8, always, 'Light jig with a plastic or minnow in shallow bays', 'walleye jig 1/8 oz',
            'Slow and light in bays and along shorelines that warm first; many bites are light taps.',
            'Post-spawn females recover in the warmest shallow water', ['slow', 'shallow', 'finesse']),
        during(['earlysummer'], 9, always, 'Leech or nightcrawler on a live-bait rig', 'live bait rig walleye',
            'Drag it slowly along weed edges and breaks in 8 to 15 feet.',
            'Early-summer walleye feed along new weeds and mid-depth flats', ['slow', 'bottom', 'bait']),
        rule(8, all(not(cold), bright), 'Nightcrawler or leech on a slip-sinker rig or crawler harness', 'crawler harness',
            'Keep it near the bottom along deep weed edges, at about 1 mph.',
            'By day in the warm months walleye hold deeper', { best: ['summer'], tags: ['bottom', 'deep', 'bait'] }),
        rule(7, all(not(cold), bright), 'Trolled crankbait', 'walleye crankbait',
            'Bright patterns in stained water; silver, gold, blue or black in clear water.',
            'Covers the deeper water walleye use by day', { best: ['summer', 'fall'], tags: ['reaction', 'deep'] }),
        during(['fall', 'latefall'], 9, always, 'Jig and a big minnow on rocky points', 'walleye jig 3/8 oz',
            'Rocky points and drop-offs in 10 to 25 feet: a 3 to 4 inch minnow on a 1/4 oz jig.',
            'Fall walleye feed hard on rocky structure before winter', ['slow', 'bottom']),
        rule(7, all(not(cold), windy), 'Heavier jig, 1/4 oz or more', 'walleye jig 3/8 oz',
            'Just heavy enough to keep touching the bottom.',
            'Wind and current lift a light jig out of the strike zone', { tags: ['bottom'] }),
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
            'Until the water reaches about 50°F, pike scavenge rather than chase', { best: ['winter'], tags: ['slow', 'bait'] }),
        during(['winter'], 7, always, 'Tip-up or float with a sucker minnow', 'tip up ice fishing',
            'Set it over weed edges in 6 to 15 feet, under the ice or from the bank.',
            'Winter pike take an easy meal', ['slow', 'bait']),
        during(['spawn', 'postspawn'], 9, always, 'Small spoon or suspending jerkbait in shallow bays', 'pike jerkbait',
            'Work the warmest, shallowest bays and back channels slowly. Use a leader.',
            'Pike stay in the shallow bays that warm first, around the spawn', ['shallow', 'slow']),
        rule(8, not(cold), 'Spoon', 'pike spoon',
            'Slow and steady, then stop and let it flutter. Use a steel or fluorocarbon leader.',
            'In the one study that compared them, spoons out-caught spinnerbaits for pike', { best: ['postspawn', 'summer'], tags: ['reaction'] }),
        during(['summer'], 8, always, 'Inline spinner with a large blade', 'pike inline spinner large',
            'Run it over the tops of deep weed beds and along weed edges, with a leader.',
            'Summer pike hold along deep weed edges and chase flash', ['reaction']),
        during(['fall'], 9, always, 'Large swimbait or glide bait', 'pike swimbait 6 inch',
            'Big baits, slow, along weed edges and points, on a steel leader.',
            'Big pike want a big meal before winter', ['slow']),
        rule(7, not(cold), 'Minnow-shaped plug or jerkbait', 'pike jerkbait',
            'Perch or sucker patterns are traditional. Use a leader.',
            'Looks like the fish pike eat', { best: ['fall'] }),
    ],
    smallmouth: [
        rule(8, cold, 'Small plastic grub on a jighead, fished slowly', '3 inch grub jig',
            'Crawl it along the bottom. Expect few bites.',
            'Smallmouth are hard to catch below about 50°F', { best: ['winter'], tags: ['slow', 'bottom'] }),
        during(['winter', 'latefall'], 8, always, 'Blade bait', 'blade bait',
            'Hop it along deep rock and river holes, letting it fall on a tight line.',
            'A tight vibration that cold smallmouth react to', ['deep']),
        during(['winter', 'latefall'], 7, always, 'Hair jig under a float', 'hair jig 1/16 oz',
            'Suspend it 8 to 12 feet down off bluff walls and steep rock, barely moving.',
            'A cold-water classic for smallmouth: tiny, slow and natural', ['finesse', 'slow']),
        during(['prespawn', 'latefall'], 9, always, 'Suspending jerkbait', 'suspending jerkbait',
            'Jerk, jerk and pause over rocky points and flats; longer pauses in colder water.',
            'Smallmouth in cool water suspend and hit a paused jerkbait', ['slow']),
        during(['prespawn', 'spawn', 'summer', 'fall'], 8, always, 'Tube bait on the bottom', 'tube bait smallmouth',
            'Drag and hop it over gravel and rock in 3 to 15 feet. Let nesting males go quickly.',
            'Looks like a crawfish, the smallmouth\'s favourite meal', ['bottom', 'slow']),
        during(['summer'], 8, not(dark), 'Drop-shot with a small minnow bait', 'drop shot rig',
            'Over rock humps and points in 15 to 30 feet.',
            'Summer smallmouth hold on deep rock and pick at small baits', ['finesse', 'deep']),
        during(['summer', 'fall'], 8, all(lowLight, calm), 'Walking topwater bait', 'topwater walking bait',
            'Walk it over rocky flats and points at first and last light.',
            'Smallmouth push bait to the surface in low light', ['topwater', 'shallow']),
        rule(8, not(cold), 'Plastic grub on a jighead', '3 inch grub jig',
            'Hop it over rock and gravel.',
            'Smallmouth take smaller lures than largemouth do', { tags: ['bottom'] }),
        rule(7, not(cold), 'Small crankbait', 'small crankbait smallmouth',
            'Bounce it off rocky bottom.',
            'Imitates the crawfish and minnows smallmouth feed on', { best: ['fall'], tags: ['reaction'] }),
        rule(6, not(cold), 'Inline spinner', 'inline spinner 1/8 oz',
            'Cast across current seams and retrieve steadily.',
            'A good search lure in rivers', { tags: ['reaction'] }),
    ],
    perch: [
        during(['spawn'], 8, always, 'Small minnow under a float along the weeds', 'perch float rig',
            'Shallow, weedy bays and brush in 3 to 8 feet.',
            'Perch crowd the shallows to spawn', ['shallow', 'bait']),
        during(['winter'], 8, always, 'Small jigging spoon tipped with a minnow head', 'perch jigging spoon',
            'Jig it on the bottom, then hold it still just above; move until you find the school.',
            'Winter perch roam in big schools near the bottom', ['bottom', 'slow']),
        during(['fall'], 7, always, 'Drop-shot with a minnow or piece of worm', 'drop shot rig',
            'Along the edges of weed flats in 10 to 20 feet.',
            'Fall perch school on weed edges and feed heavily', ['bottom']),
        rule(6, always, 'Small jig tipped with a minnow or worm', 'perch jig small',
            'Fish it within a foot of the bottom; move until you find the school.',
            'Perch feed near the bottom in schools', { tags: ['bottom'] }),
    ],
    sauger: [
        during(['winter', 'spawn'], 9, always, 'Jig and minnow below the dam', 'walleye jig 3/8 oz',
            'Fish the slack water and current breaks below the dam, slowly, on the bottom.',
            'Sauger gather below the dams from late fall until the spawn', ['slow', 'bottom']),
        during(['winter', 'spawn', 'fall'], 7, always, 'Three-way rig with a minnow or floating plug', 'three way swivel rig',
            'Drift or troll it slowly along the bottom of the river channel.',
            'Keeps a bait just off the bottom in current', ['bottom']),
        rule(6, always, 'Jig and minnow', 'walleye jig 1/4 oz',
            'Keep it on the bottom in current breaks and below dams.',
            'Sauger sit deep in river current', { tags: ['bottom'] }),
    ],
    trout: [
        instead((c) => c.zone === 'hot', 'Give the trout a rest',
            'Fish for something else today, or come back at first light after a cool night.',
            'Water this warm stresses trout, and many die after being released'),
        rule(9, dirty, 'Worm with extra split shot', 'trout worm hooks size 8 split shot',
            'Keep it within inches of the bottom. Heavier line is fine in murky water.',
            'In high, off-colour water trout hold near the bottom and find food by smell', { tags: ['bottom', 'bait'] }),
        rule(8, all(clear, bright, not(dirty)), 'Small bait on a 2 to 4 lb leader', '4 lb fluorocarbon leader',
            'Stay low and quiet, and leave the split shot off unless the water is up.',
            'Low, clear water under a bright sky makes trout wary', { tags: ['finesse'] }),
        during(['winter'], 8, not(dirty), 'Egg pattern or small nymph drifted deep', 'trout egg flies',
            'Drift it slowly along the bottom of deep, slow pools, best around midday when the water is warmest.',
            'Winter trout hold in slow water and take small, easy meals', ['slow', 'bottom', 'finesse']),
        rule(7, not(dirty), 'Small spinner or spoon', 'inline spinner 1/8 oz',
            'Cast slightly upstream and retrieve at a moderate pace; vary how long you let it sink.',
            'The first thing to try in normal flows', { best: ['spring'], tags: ['reaction'] }),
        during(['spring', 'summer'], 7, all(not(dirty), any(lowLight, calm)), 'Dry fly or small nymph when insects hatch', 'trout flies assortment',
            'Watch for rising fish and match the size and colour of what is hatching. A casting bubble works on spinning gear.',
            'Hatches bring trout up to feed', ['finesse']),
        during(['summer'], 8, lowLight, 'Small spoon or spinner at first light', 'trout spoon 1/8 oz',
            'Fish the first and last hours of light in deep, shaded water and where cold springs enter. Land and release fish quickly.',
            'Summer trout feed when the water is coolest', ['reaction']),
        during(['fall'], 9, not(dirty), 'Minnow-shaped jerkbait or streamer', 'trout jerkbait',
            'Twitch or swing it past undercut banks and logjams. Leave fish on gravel nests alone.',
            'Fall brown and brook trout turn aggressive around their spawn', ['reaction']),
        rule(5, not(dirty), 'Bait drifted slowly', 'trout worm hooks size 8',
            'Switch to it when spinners and spoons draw nothing.',
            'A slower presentation for fish that will not chase', { tags: ['slow', 'bait'] }),
        rule(4, always, 'Bait under a bobber, or floating bait off the bottom', 'floating trout bait',
            'In lakes: a bobber 1.5 to 3 feet above the hook when fish cruise high, or a weight 1.5 feet above a floating bait when they are deep.',
            'The standard approach for trout in lakes and ponds', { tags: ['bait'] }),
    ],
    salmon: [
        during(['run'], 9, always, 'Spinner or spoon swung through holding water', 'salmon spinner',
            'Cast across and slightly downstream and swing it through deep runs and tailouts.',
            'Running salmon rarely feed but strike flash from aggression', ['reaction']),
        during(['run'], 8, always, 'Cured eggs or a yarn ball drifted near the bottom', 'salmon egg loop hooks',
            'Drift it through the deep runs and holes where salmon rest. Many runs have bait and season limits: check first.',
            'Running salmon still take a drifting egg', ['bottom', 'slow', 'bait']),
        during(['spring', 'openwater'], 8, always, 'Flasher and fly or spoon, trolled at depth', 'salmon flasher',
            'Troll at the depth of the bait and the coldest water: often 40 to 120 feet by midsummer.',
            'Salmon in open water follow baitfish in cold, deep water', ['deep']),
        rule(6, always, 'Spoon or large spinner', 'salmon spoon lure',
            'Cast across and swing it through holding water, or troll it.',
            'Flash draws strikes from salmon', { tags: ['reaction'] }),
    ],

    // ----- Salt water ------------------------------------------------------------
    seatrout: [
        rule(9, cold, 'Slow-sinking, fish-shaped plug', 'suspending twitchbait',
            'Work it very slowly through deep channels and holes.',
            'Cold seatrout drop into deep water and will not chase', { best: ['winter'], tags: ['slow', 'deep'] }),
        during(['winter', 'latefall'], 8, always, 'Soft plastic on a light jighead, crawled through deep holes', 'soft plastic jig head 1/8 oz saltwater',
            'Crawl it along the bottom of deep holes, creek bends and channel edges; afternoons after sunny days often bite best.',
            'Cold seatrout stack up in the deepest, warmest water', ['slow', 'bottom', 'deep']),
        during(['spring'], 8, not(dark), 'Suspending twitchbait over shallow grass', 'suspending twitchbait',
            'Twitch and pause it over sand holes on shallow grass flats.',
            'Big spring seatrout prowl the flats for mullet', ['shallow']),
        rule(9, all(not(cold), lowLight), 'Walk-the-dog topwater plug', 'topwater walking lure saltwater',
            'Walk it over shallow grass.',
            'Seatrout feed on top at dawn, at dusk and under cloud', { best: ['spring', 'summer', 'fall'], tags: ['topwater', 'shallow'] }),
        rule(8, all(not(cold), dark), 'Jig under dock or bridge lights', 'soft plastic jig head 1/4 oz saltwater',
            'Cast to the edge of the light and swim it through.',
            'At night seatrout gather where lights draw bait', { best: ['summer'] }),
        rule(8, not(cold), 'Popping cork with live shrimp or a soft-plastic shrimp', 'popping cork rig',
            'Pop it now and then over grass flats: shallow early and late, the deeper edges at midday.',
            'The standard way to find seatrout over grass', { best: ['fall', 'summer'], tags: ['bait'] }),
        during(['fall'], 8, always, 'Soft-plastic shrimp under feeding birds', 'soft plastic shrimp',
            'Watch for gulls diving on shrimp and cast to them, letting the bait fall through the school.',
            'Shrimp leaving the marsh draw seatrout and birds into the open', ['reaction']),
        rule(5, not(cold), 'Soft plastic on a jighead', 'soft plastic shrimp',
            'Hot pink, root beer, dark red and white are the traditional colours.',
            'Covers water between the grass beds'),
    ],
    redfish: [
        rule(9, all(fromBeach, any(rising, dark)), 'Cut mullet or crab on a fish-finder rig', 'fish finder rig circle hook 8/0',
            'A 3 to 8 oz sinker, cast into the sloughs between the bars.',
            'Surf redfish work the sloughs on a rising tide and after dark', { best: ['fall'], tags: ['bottom', 'bait'] }),
        rule(7, fromBeach, 'Cut mullet or crab on a fish-finder rig', 'fish finder rig circle hook 8/0',
            'A 3 to 8 oz sinker, cast into the sloughs between the bars.',
            'The standard bait for redfish in the surf', { best: ['fall'], tags: ['bottom', 'bait'] }),
        rule(6, fromBeach, 'Heavy spoon or slow-sinking plug', 'casting spoon 2 oz',
            'Cast along the slough and retrieve just off the bottom.',
            'A way to cover water when bait is not drawing bites', { tags: ['reaction'] }),
        during(['fall'], 7, not(fromBeach), 'Cut mullet or crab at the passes and inlets', 'fish finder rig circle hook 8/0',
            'Fish the deep edges of passes, inlets and jetties on the bottom with heavy tackle; release the big breeders quickly.',
            'Bull redfish gather at the passes and inlets to spawn in fall', ['bottom', 'bait']),
        during(['winter'], 9, not(fromBeach), 'Soft plastic or shrimp, sight-cast on sunny flats', 'paddle tail jighead 1/8 oz',
            'Look for schools on shallow mud on sunny afternoons; lead the fish and let the bait settle to the bottom.',
            'Winter reds bask on mud that warms in the sun, in water clear enough to see them', ['finesse', 'slow', 'shallow']),
        during(['winter', 'latefall'], 7, not(fromBeach), 'Cut mullet or crab in deep creek bends', 'carolina rig saltwater',
            'Fish the deeper holes and creek bends on cold mornings.',
            'Cold redfish drop into the deeper creeks overnight', ['bottom', 'deep', 'slow', 'bait']),
        rule(9, all(not(fromBeach), moving), 'Gold spoon, weedless in grass', 'gold weedless spoon 1/4 oz',
            'A 1/4 to 1/2 oz spoon bounced along the bottom of flats and marsh edges. Gold, copper and silver are the standards.',
            'Redfish feed across the flats while the tide is moving', { best: ['spring', 'summer', 'fall'], tags: ['reaction', 'shallow'] }),
        during(['spring', 'summer', 'fall'], 8, all(not(fromBeach), lowLight, calm), 'Walking topwater at first light', 'topwater walking lure saltwater',
            'Over shallow flats, oyster bars and marsh points at first and last light.',
            'Redfish crash bait on the surface in low light', ['topwater', 'shallow']),
        rule(7, not(fromBeach), 'Soft plastic on a 1/4 oz jighead, tipped with shrimp', 'paddle tail jighead 1/4 oz',
            'Hop it along the bottom beside oysters and creek mouths. Chartreuse and smoke are traditional.',
            'A dependable choice around structure', { tags: ['bottom'] }),
        rule(6, not(fromBeach), 'Live bait under a popping cork', 'popping cork rig',
            'Set the cork so the bait rides near the bottom next to structure.',
            'Keeps a bait in front of fish holding in one place', { best: ['fall'], tags: ['bait'] }),
    ],
    flounder: [
        during(['fall'], 10, always, 'Swimbait or live mullet at the inlet mouths', 'flounder swimbait jig head',
            'Work the bottom along jetties and the inside edges of the inlets, best as the tide falls.',
            'Fall flounder stage at the inlets on their way offshore', ['bottom']),
        during(['spawn'], 8, always, 'Swimbait on a jighead over sand', 'halibut swimbait',
            'Bounce it over sand in harbors, bay channels and just past the surf line.',
            'California halibut move inshore to spawn in spring and summer', ['bottom']),
        during(['winter'], 7, always, 'Slow swimbait in deep channels near the inlets', 'flounder swimbait jig head',
            'Drag it very slowly along the deepest channels near the inlets; expect few fish.',
            'The few flounder left inshore in winter sit deep and still', ['slow', 'deep', 'bottom']),
        rule(9, moving, 'Bucktail jig tipped with squid or a minnow', 'bucktail jig 1 oz white',
            'Drag it slowly and keep it on the bottom. Pause before you set the hook. White and chartreuse are the standards.',
            'Flounder lie in wait for bait carried past on a moving tide', { best: ['summer'], tags: ['bottom', 'slow'] }),
        rule(7, always, 'Swimbait on a jighead', 'flounder swimbait jig head',
            'A 1/4 to 1 oz head, heavy enough to stay on the bottom.',
            'Covers the bottom where flounder lie', { best: ['spring'], tags: ['bottom'] }),
        rule(6, always, 'Carolina rig with a live minnow', 'flounder rig',
            'Ease it along the bottom beside drop-offs and creek mouths.',
            'Natural bait for fish that will not move far', { best: ['summer'], tags: ['bottom', 'slow', 'bait'] }),
    ],
    snook: [
        instead((c) => c.waterTempF <= 58, 'Leave the snook alone',
            'Try redfish or seatrout instead, or wait for a run of warm days.',
            'Snook stop feeding at about 58°F and can die if the cold lasts'),
        rule(10, all(dark, falling), 'Live pinfish or shrimp on a circle hook', 'circle hook 4/0',
            'Cast up-current of a bridge, or to the edge of a dock light, and let it sweep through.',
            'Snook feed at night through the first hours of the outgoing tide', { best: ['spring', 'summer', 'fall'], tags: ['bait'] }),
        rule(8, (c) => c.waterTempF < 65, 'Soft-plastic grub or minnow plug, worked slowly', 'soft plastic jerkbait',
            'Slow everything down.',
            'Snook turn sluggish below about 65°F', { best: ['winter'], tags: ['slow'] }),
        during(['winter'], 8, always, 'Slow-sinking twitchbait in canals and rivers', 'suspending twitchbait',
            'Work it slowly past docks and deep bends in canals and rivers, best on the afternoon of a sunny day.',
            'Winter snook hide in warm-water refuges and feed in short windows', ['slow']),
        during(['spring', 'summer'], 8, always, 'Live whitebait, free-lined', 'circle hook 3/0',
            'Chum with a few live baits and free-line one along mangrove points, passes and bridges.',
            'Snook feed hard on schools of whitebait in the warm months', ['bait']),
        during(['summer'], 8, not(dark), 'White bucktail or small soft plastic in the beach trough', 'white bucktail jig 1/4 oz',
            'Walk the beach at first light and cast ahead of snook cruising the trough near the sand.',
            'In the spawning season snook cruise the beaches and passes', ['shallow']),
        during(['fall'], 9, always, 'Walk-the-dog topwater or mullet swimbait', 'topwater walking lure saltwater',
            'Mimic finger mullet along seawalls, mangrove points and creek mouths, especially in low light.',
            'The fall mullet run sets snook on a feeding spree', ['topwater', 'shallow', 'reaction']),
        rule(7, dark, 'Live bait around bridge and dock lights', 'circle hook 4/0',
            'Fish the shadow line, where the light ends.',
            'Snook hunt the edges of lit water at night', { tags: ['bait'] }),
        rule(7, not(dark), 'Live shrimp or pinfish on a circle hook', 'circle hook 4/0',
            'Free-line it beside mangroves, docks and bridge pilings.',
            'Live bait is the most dependable way to catch snook', { tags: ['bait'] }),
        rule(6, always, 'Soft-plastic jerkbait or minnow plug', 'soft plastic jerkbait',
            'Work it along mangrove edges, docks and passes.',
            'Covers the structure snook hold on'),
    ],
    striper: [
        during(['winter'], 9, always, 'Small soft-plastic swimbait, fished very slowly', 'paddle tail swimbait 4 inch',
            'Bounce it along the bottom of deep river holes and warm-water outflows.',
            'Holdover stripers in winter want a small, slow bait', ['slow', 'finesse', 'bottom']),
        during(['spring'], 9, always, 'Cut or live menhaden (bunker)', 'circle hook 8/0',
            'Chunk or live-line menhaden in the rivers and bays where herring and bunker are moving. Many states require circle hooks.',
            'Spring-run stripers feed heavily on menhaden and herring', ['bait']),
        rule(10, all(any(dark, lowLight), moving), 'Live or soft-plastic eel', 'soft plastic eel',
            'Fish it slowly. Black on dark nights.',
            'Striped bass feed best in low light on a moving tide', { best: ['summer'], tags: ['slow'] }),
        rule(8, any(dark, lowLight), 'Swimming minnow plug', 'minnow plug striped bass',
            'A slow, steady retrieve across current.',
            'A low-light standard for stripers in shallow water', { best: ['spring', 'fall'], tags: ['shallow'] }),
        during(['fall'], 9, always, 'Metal or epoxy jig cast into blitzes', 'epoxy jig',
            'Look for birds working bait and match its size: small for sand eels and bay anchovies.',
            'Fall-run stripers blitz schools of small bait', ['reaction']),
        rule(7, always, 'Bucktail jig', 'bucktail jig',
            'Keep it near the bottom and work it slowly. White by day, chartreuse in rough or dirty water.',
            'Works at every depth and in any light', { best: ['fall'], tags: ['bottom'] }),
        rule(6, bright, 'Pencil popper', 'pencil popper',
            'Use it when you can see fish feeding on top.',
            'Active stripers will come up for a surface lure', { best: ['fall'], tags: ['topwater'] }),
    ],
    bluefish: [
        instead(all(season('winter'), (c) => c.waterTempF < 52), 'Few bluefish around',
            'Try striped bass or another fish, or come back when the water warms.',
            'Bluefish leave the inshore water when it turns this cold'),
        rule(9, any(dirty, rough), 'Cut bait on a fish-finder rig', 'fish finder rig wire leader',
            'On the bottom, with a wire or heavy mono leader.',
            'In murky water bluefish find food by smell', { tags: ['bottom', 'bait'] }),
        rule(9, not(any(dirty, rough)), 'Metal spoon or diamond jig', 'casting spoon 2 oz',
            'Cast far and retrieve fast and steady. Use a wire or heavy mono leader.',
            'In clean water bluefish run down fast-moving flash', { best: ['fall'], tags: ['reaction'] }),
        rule(7, not(any(dirty, rough)), 'Popper', 'saltwater popper',
            'White or powder blue when mullet are running.',
            'Bluefish feeding near the surface will hit on top', { best: ['fall', 'spring'], tags: ['topwater'] }),
    ],
    pompano: [
        rule(9, always, 'Pompano rig with sand fleas, clam or shrimp', 'pompano rig',
            'Fish it in the white water close in, not far out, with a 4 to 6 oz pyramid sinker.',
            'Pompano feed in the wash, best on an incoming tide at first and last light', { best: ['spring', 'fall'], tags: ['bottom', 'bait'] }),
        rule(6, always, 'Pompano jig', 'pompano jig',
            'Short hops along the bottom. Pink, chartreuse and yellow are the standards.',
            'A way to search the beach for a school', { best: ['spring', 'fall'], tags: ['bottom'] }),
    ],
    whiting: [
        rule(8, always, 'Two-hook bottom rig with cut shrimp', 'double drop bottom rig',
            'Small hooks (No. 1 to 1/0), on the bottom in the sloughs.',
            'Whiting feed on the bottom close to the beach, best on an incoming tide', { best: ['peak'], tags: ['bottom', 'bait'] }),
        rule(5, always, 'Scented bait strips on the same rig', 'scented bait strips',
            'A stand-in when you have no fresh shrimp.',
            'Stays on the hook in the surf', { tags: ['bottom'] }),
    ],
    surfperch: [
        rule(9, always, 'Scented sandworm or grub on a Carolina rig', 'surfperch rig scented sandworm',
            'A 1/2 to 1 oz egg sinker, cast just past the breaking waves. Fish are often within 30 feet of the sand.',
            'Surf fish feed in the wash from the incoming to the high tide, best early and near dusk in mild surf', { best: ['peak'], tags: ['bottom'] }),
        during(['summer'], 8, always, 'Live sand crab in the wash', 'sand crab rake',
            'Dig sand crabs at the water\'s edge and fish them on a light Carolina rig in the shallow wash.',
            'Summer corbina and croaker feed in a foot of water', ['shallow', 'bait']),
        rule(7, always, 'Sand crabs, mussels or marine worms on a two-hook rig', 'pyramid sinker 3 oz surf rig',
            'Size 4 or 2 hooks above a 2 to 6 oz pyramid sinker.',
            'The natural food of the surf zone', { best: ['peak'], tags: ['bottom', 'bait'] }),
    ],
};

/** Fish that share a list with another fish. Halibut keep their own seasons (season.js) but share flounder tackle. */
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
const labelOf = (target) => TARGET_LABELS[target] ?? target;

export const knownTarget = (target) => (ALIASES[target] ?? target) in RULES;

// ---------------------------------------------------------------------------
// What has changed lately
// ---------------------------------------------------------------------------
//
// Each situation shifts the presentations it favours or rules out. `pattern` is the
// sentence for the summary; `note` is shown on a suggestion it helped choose.

const SITUATIONS = [
    {
        id: 'cold-snap',
        applies: (c) => c.trend?.swing === 'cold-snap',
        shift: { slow: 2, finesse: 1, bottom: 1, deep: 1, reaction: -2, topwater: -4, shallow: -1 },
        pattern: 'The water has dropped fast. Fish slow down after a sudden chill: go slower, smaller and deeper',
        note: 'A slower presentation suits the sudden chill',
    },
    {
        id: 'warm-spell',
        applies: (c) => c.trend?.swing === 'warm-spell' && coolish(c),
        shift: { shallow: 2, reaction: 1 },
        pattern: 'A run of warming water is drawing fish shallower and livening them up',
        note: 'Suits the warming water: fish are moving shallow',
    },
    {
        id: 'front-passed',
        applies: (c) => c.front === 'passed',
        // Fronts are the least measured of these, so they move the picks least.
        shift: { finesse: 1, slow: 1, topwater: -2, reaction: -1 },
        pattern: 'A cold front has just gone through. Expect a slower bite: smaller baits, fished slower and tight to cover',
        note: 'A finesse choice for the post-front slowdown',
    },
    {
        id: 'front-approaching',
        applies: (c) => c.front === 'approaching',
        shift: { reaction: 1 },
        pattern: 'The barometer is falling ahead of a front, which often brings a burst of feeding',
        note: 'A fast, loud choice for the feeding spell ahead of a front',
    },
    {
        id: 'off-colour',
        applies: (c) => dirty(c),
        shift: { finesse: -2, reaction: 1, bait: 1 },
        pattern: 'The water is off-colour, so fish find food by vibration, sound and smell more than by sight',
        note: 'Vibration, flash or scent show up in off-colour water',
    },
    {
        id: 'level-rising',
        applies: (c) => c.level === 'rising' && c.mode === 'fresh',
        shift: { shallow: 2 },
        pattern: 'The water is rising, flooding new cover along the banks, and fish push in after the food it brings',
        note: 'Suits the rising water and newly flooded cover',
    },
    {
        id: 'level-falling',
        applies: (c) => c.level === 'falling' && c.mode === 'fresh',
        shift: { deep: 1, shallow: -1 },
        pattern: 'The water is falling, pulling fish off the banks toward the first deeper water',
        note: 'Suits the falling water: fish are sliding deeper',
    },
];

/** The conditions as one fish sees them: its own temperature zone, phase of the year and situations. */
function forFish(target, conditions) {
    // "Cold" means something different to a trout than to a bass.
    const zone = temperatureZone(conditions.waterTempF, THERMAL_GROUP[target]);
    const phase = conditions.date
        ? seasonalPhase(target, { date: conditions.date, waterTempF: conditions.waterTempF, trend: conditions.trend ?? null })
        : null;
    const c = { ...conditions, zone, season: phase };
    return { ...c, situations: SITUATIONS.filter((situation) => situation.applies(c)) };
}

/** A rule's standing for this fish now, and the situation that did most to lift it. */
function rank(entry, c) {
    let score = entry.weight;
    if (c.season && entry.best.includes(c.season.id)) score += SEASON_BONUS;
    let lift = null;
    for (const situation of c.situations) {
        const shift = entry.tags.reduce((sum, tag) => sum + (situation.shift[tag] ?? 0), 0);
        score += shift;
        if (shift > 0 && (!lift || shift > lift.shift)) lift = { shift, note: situation.note };
    }
    return { ...entry, score, lift };
}

function matching(target, conditions) {
    const c = forFish(target, conditions);
    const rules = (RULES[ALIASES[target] ?? target] ?? [])
        .filter((entry) => entry.when(c))
        .map((entry) => rank(entry, c))
        .sort((a, b) => b.score - a.score);
    return { c, rules: rules[0]?.exclusive ? [rules[0]] : rules };
}

/**
 * Up to `limit` recommendations for the fish in `targets` (most important first).
 * The first fish gets two picks, the others one each, and any room left goes back to the first.
 *
 * @param {string[]} targets
 * @param {LureConditions} conditions
 * @returns {Array<{ target: string, name: string, how: string, why: string, query: string|null, season: string|null, note: string|null }>}
 *   `query` is what a shopper would search for; null when the advice is not a product.
 *   `season` names the phase of the year when the pick is a seasonal one; `note` says how a recent
 *   change (a cold snap, a front) favoured it.
 */
export function recommendLures(targets, conditions, { limit = 3 } = {}) {
    const lists = targets.filter(knownTarget).map((target) => ({ target, ...matching(target, conditions) }));
    const picks = [];
    const taken = new Set();
    const noted = new Set(); // a cold snap or a front is mentioned once, on the first pick it lifted
    const take = (list) => {
        const next = list.rules.find((entry) => !taken.has(entry.name));
        if (!next || picks.length >= limit) return false;
        taken.add(next.name);
        const seasonal = list.c.season && next.best.includes(list.c.season.id) ? list.c.season.label : null;
        picks.push({
            target: labelOf(list.target),
            name: next.name,
            how: next.how,
            why: next.why,
            query: next.query,
            season: seasonal,
            note: next.lift && !noted.has(next.lift.note) ? next.lift.note : null,
            score: next.score,
        });
        if (next.lift) noted.add(next.lift.note);
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
    const order = new Map(lists.map((list, index) => [labelOf(list.target), index]));
    return picks
        .sort((a, b) => order.get(a.target) - order.get(b.target) || b.score - a.score)
        .map(({ score, ...pick }) => pick); // eslint-disable-line no-unused-vars
}

/**
 * Where each fish is in its year and what has changed lately, for the summary above the suggestions.
 * @returns {Array<{ target: string, season: import('./season.js').SeasonalPhase|null, situations: string[] }>}
 */
export function lurePatterns(targets, conditions) {
    return targets.filter(knownTarget).map((target) => {
        const c = forFish(target, conditions);
        return { target: labelOf(target), season: c.season, situations: c.situations.map((situation) => situation.pattern) };
    });
}

/**
 * One line on colour. Tradition has rules for it; the two studies that tested lure colour
 * against catch rate (largemouth bass, and pike) found it made no difference, so the line says both.
 * `forage` is what the fish are eating this time of year, where the season says.
 */
export function colourAdvice({ clarity, light }, forage = null) {
    const tested = 'The two studies that tested lure colour found no effect on catch rate, so do not agonise over it.';
    const match = forage ? ` Match the ${forage} they are feeding on this time of year.` : '';
    if (light === 'dark') return `Colour: tradition says black after dark, for the silhouette. ${tested}`;
    if (clarity === 'muddy' || clarity === 'stained') return `Colour: tradition says bright, vivid colours (chartreuse, white) and plenty of vibration in off-colour water. ${tested}`;
    if (clarity === 'clear') return `Colour: tradition says natural colours and lighter line in clear water.${match} ${tested}`;
    return `Colour: natural patterns that match the local bait are the usual advice.${match} ${tested}`;
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
 * @param {Date|null} [raw.date]                    the local date; without it there are no seasonal picks
 * @param {import('./water-trend.js').WaterTrend|null} [raw.trend]
 * @param {'approaching'|'passed'|null} [raw.front]
 * @param {'rising'|'falling'|null} [raw.level]
 */
export function lureConditions({
    waterTempF, phase, sky, windMph, turbidityFnu = null, flowPercentile = null, mode = 'fresh', tide = null, waveFt = null,
    date = null, trend = null, front = null, level = null,
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
    return { waterTempF, light, clarity, wind, mode, tide, surf, date, trend, front, level };
}

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { colourAdvice, knownTarget, lureConditions, lurePatterns, recommendLures } from '../js/core/lures.js';
import { summariseWaterTrend } from '../js/core/water-trend.js';

// Dates in the middle of each season, at midday so the local date is the same in every US timezone.
const APRIL = new Date('2026-04-10T17:00:00Z');
const JUNE = new Date('2026-06-15T17:00:00Z');
const JULY = new Date('2026-07-20T17:00:00Z');
const OCTOBER = new Date('2026-10-10T17:00:00Z');
const NOVEMBER = new Date('2026-11-14T17:00:00Z');
const JANUARY = new Date('2026-01-08T17:00:00Z');

const conditions = (overrides) => lureConditions({ waterTempF: 72, phase: 'day', sky: 'clear', windMph: 6, ...overrides });
const picks = (targets, overrides, options) => recommendLures(targets, conditions(overrides), options);
const names = (targets, overrides, options) => picks(targets, overrides, options).map((pick) => pick.name);

/** Daily means ending yesterday, going from `from` to `to` °F over `days` days. */
function waterTrend({ days = 30, from, to, end = NOVEMBER, normal = null, lastThree = null }) {
    const daily = [];
    for (let i = days; i >= 1; i--) {
        const day = new Date(end.getTime() - i * 86_400_000).toISOString().slice(0, 10);
        daily.push({ day, v: from + ((to - from) * (days - i)) / (days - 1) });
    }
    if (lastThree !== null) for (let i = 1; i <= 3; i++) daily[daily.length - i].v = lastThree;
    return summariseWaterTrend(daily, { now: end.getTime(), normal });
}

test('raw readings are reduced to the categories anglers think in', () => {
    assert.deepEqual(conditions({}), {
        waterTempF: 72, light: 'bright', clarity: 'normal', wind: 'light', mode: 'fresh', tide: null, surf: null,
        date: null, trend: null, front: null, level: null,
    });
    assert.equal(conditions({ phase: 'dusk' }).light, 'low');
    assert.equal(conditions({ sky: 'overcast' }).light, 'low');
    assert.equal(conditions({ phase: 'night' }).light, 'dark');
    assert.equal(conditions({ windMph: 14 }).wind, 'windy');
    assert.equal(conditions({ windMph: 2 }).wind, 'calm');
    // Measured turbidity wins; otherwise river flow against normal is the clue.
    assert.equal(conditions({ turbidityFnu: 4 }).clarity, 'clear');
    assert.equal(conditions({ turbidityFnu: 64, flowPercentile: 10 }).clarity, 'muddy');
    assert.equal(conditions({ flowPercentile: 93 }).clarity, 'muddy');
    assert.equal(conditions({ flowPercentile: 80 }).clarity, 'stained');
    assert.equal(conditions({ flowPercentile: 12 }).clarity, 'clear');
    assert.equal(conditions({ waveFt: 0.5 }).surf, 'flat');
    assert.equal(conditions({ waveFt: 6 }).surf, 'rough');
});

test('the same water temperature means different lures in spring and fall', () => {
    // 57°F: pre-spawn in April, the late-fall feed in November.
    const spring = picks(['bass'], { waterTempF: 57, date: APRIL });
    const fall = picks(['bass'], { waterTempF: 57, date: NOVEMBER });
    assert.ok(spring.some((pick) => pick.name === 'Lipless crankbait'));
    assert.ok(spring.every((pick) => pick.season === 'Pre-spawn'));
    assert.deepEqual(fall.slice(0, 2).map((pick) => pick.name), ['Suspending jerkbait', 'White spinnerbait']);
    assert.ok(fall.every((pick) => pick.season === 'Late fall'));
    assert.notDeepEqual(spring.map((pick) => pick.name), fall.map((pick) => pick.name));

    // 66°F: spawning beds in spring, chasing shad in fall.
    assert.equal(names(['bass'], { waterTempF: 66, date: new Date('2026-05-01T17:00:00Z') })[0], 'Soft-plastic lizard or creature bait');
    assert.equal(names(['bass'], { waterTempF: 66, date: OCTOBER })[0], 'Lipless crankbait');
});

test('bass through the year', () => {
    assert.equal(names(['bass'], { waterTempF: 44, date: JANUARY })[0], 'Suspending jerkbait');
    assert.ok(names(['bass'], { waterTempF: 44, date: JANUARY }).includes('Jig with a low-action trailer'));
    assert.equal(names(['bass'], { waterTempF: 76, phase: 'dusk', windMph: 3, date: JUNE })[0], 'Topwater popper or prop bait');
    assert.equal(names(['bass'], { waterTempF: 84, date: JULY })[0], 'Carolina- or Texas-rigged worm on offshore structure');
    assert.ok(names(['bass'], { waterTempF: 84, phase: 'night', date: JULY }).includes('Black spinnerbait or a big dark worm'));
    assert.equal(names(['bass'], { waterTempF: 84, phase: 'night', windMph: 15, date: JULY })[0], 'Black spinnerbait or a big dark worm');
    // Topwater wants a calm surface, so it is not suggested in a wind even at dusk; nor in cold water.
    assert.ok(!names(['bass'], { waterTempF: 76, phase: 'dusk', windMph: 15, date: JUNE }).includes('Topwater popper or prop bait'));
    assert.ok(!names(['bass'], { waterTempF: 46, phase: 'dusk', windMph: 2, date: APRIL }).includes('Topwater popper or prop bait'));
    // Muddy water still calls for vibration in any season.
    assert.ok(names(['bass'], { waterTempF: 80, flowPercentile: 95, date: JULY }).includes('Large-blade spinnerbait'));
});

test('without a date the picks fall back on the conditions alone', () => {
    assert.equal(names(['bass'], { waterTempF: 46 })[0], 'Suspending jerkbait');
    assert.equal(names(['bass'], { waterTempF: 76, phase: 'dusk', windMph: 3 })[0], 'Topwater popper or prop bait');
    assert.equal(names(['bass'], { waterTempF: 76, windMph: 15 })[0], 'Spinnerbait or crankbait');
    assert.equal(names(['bass'], { waterTempF: 76 })[0], 'Plastic worm or jig');
    assert.ok(picks(['bass'], { waterTempF: 76 }).every((pick) => pick.season === null));
    assert.deepEqual(lurePatterns(['bass'], conditions({})), [{ target: 'bass', season: null, situations: [] }]);
});

test('"cold" is judged against each fish, not on one scale', () => {
    // 60°F in June: summer-warm for walleye feeding on the flats, the same day bass are past spawning.
    const both = picks(['bass', 'walleye'], { waterTempF: 60, date: OCTOBER });
    assert.equal(both.find((pick) => pick.target === 'walleye').name, 'Jig and a big minnow on rocky points');
    assert.equal(names(['walleye'], { waterTempF: 38, date: JANUARY })[0], 'Jig and minnow');
    assert.equal(names(['walleye'], { waterTempF: 60, phase: 'night', date: OCTOBER })[0], 'Shallow-running minnow crankbait');
    assert.equal(names(['walleye'], { waterTempF: 45, date: APRIL })[0], 'Jig and minnow in the current');
    assert.equal(names(['walleye'], { waterTempF: 64, date: JUNE })[0], 'Leech or nightcrawler on a live-bait rig');
});

test('a cold snap and a passing front push the picks slower and deeper, and say so once', () => {
    const steady = waterTrend({ from: 60, to: 59 });
    const snap = waterTrend({ from: 62, to: 61, lastThree: 55 });
    assert.equal(snap.swing, 'cold-snap');

    const calm = names(['bass'], { waterTempF: 59, date: OCTOBER, trend: steady, phase: 'dawn', windMph: 2 }, { limit: 4 });
    const chilled = picks(['bass'], { waterTempF: 55, date: OCTOBER, trend: snap, front: 'passed' }, { limit: 4 });
    assert.notDeepEqual(calm, chilled.map((pick) => pick.name));
    assert.ok(chilled.slice(0, 2).some((pick) => pick.name === 'Suspending jerkbait' || pick.name === 'Jig with a low-action trailer'));
    assert.ok(!chilled.some((pick) => pick.name === 'Walking topwater bait'));
    const notes = chilled.map((pick) => pick.note).filter(Boolean);
    assert.ok(notes.length >= 1);
    assert.equal(new Set(notes).size, notes.length, 'each note appears once');

    const [pattern] = lurePatterns(['bass'], conditions({ waterTempF: 55, date: OCTOBER, trend: snap, front: 'passed' }));
    assert.equal(pattern.situations.length, 2);
    assert.match(pattern.situations[0], /dropped fast/);
    assert.match(pattern.situations[1], /cold front/);
});

test('a front on its way favours fast, loud lures; a rising lake favours the shallows', () => {
    const ahead = picks(['bass'], { waterTempF: 70, date: OCTOBER, front: 'approaching' });
    assert.ok(ahead.some((pick) => /front/.test(pick.note ?? '')));
    const rising = picks(['bass'], { waterTempF: 84, date: JULY, level: 'rising' }, { limit: 4 });
    assert.ok(rising.some((pick) => /rising water/.test(pick.note ?? '')));
    // Lake levels mean nothing in salt water.
    assert.deepEqual(lurePatterns(['redfish'], conditions({ mode: 'inshore', level: 'rising', date: JULY }))[0].situations, []);
});

test('a warm spell only matters while the water is still cool for the fish', () => {
    const warming = waterTrend({ from: 46, to: 47, end: new Date('2026-03-01T17:00:00Z'), lastThree: 52 });
    assert.equal(warming.swing, 'warm-spell');
    const early = lurePatterns(['bass'], conditions({ waterTempF: 52, date: new Date('2026-03-01T17:00:00Z'), trend: warming }))[0];
    assert.match(early.situations[0], /warming water/);
    const summer = lurePatterns(['bass'], conditions({ waterTempF: 84, date: JULY, trend: { ...warming, swing: 'warm-spell' } }))[0];
    assert.deepEqual(summer.situations, []);
});

test('advice that replaces the lures: warm trout, sight feeders after dark, cold snook, departed bluefish', () => {
    const trout = recommendLures(['trout'], conditions({ waterTempF: 72, date: JULY }));
    assert.equal(trout.length, 1);
    assert.equal(trout[0].name, 'Give the trout a rest');
    assert.equal(trout[0].query, null);

    assert.deepEqual(names(['pike'], { waterTempF: 60, phase: 'night', date: OCTOBER }), ['Wait for daylight']);
    assert.deepEqual(names(['panfish'], { phase: 'night' }), ['Wait for daylight']);
    assert.deepEqual(names(['snook'], { waterTempF: 56, mode: 'inshore', tide: 'falling', date: JANUARY }), ['Leave the snook alone']);
    assert.deepEqual(names(['bluefish'], { waterTempF: 46, mode: 'surf', date: JANUARY }), ['Few bluefish around']);
});

test('trout: off-colour water calls for bait on the bottom, clear water for light line, fall for jerkbaits', () => {
    assert.equal(names(['trout'], { waterTempF: 55, flowPercentile: 95 })[0], 'Worm with extra split shot');
    assert.equal(names(['trout'], { waterTempF: 55, flowPercentile: 10 })[0], 'Small bait on a 2 to 4 lb leader');
    assert.equal(names(['trout'], { waterTempF: 55 })[0], 'Small spinner or spoon');
    assert.equal(names(['trout'], { waterTempF: 52, date: OCTOBER })[0], 'Minnow-shaped jerkbait or streamer');
    assert.equal(names(['trout'], { waterTempF: 38, date: JANUARY })[0], 'Egg pattern or small nymph drifted deep');
});

test('salt water: season, tide, light and the style of fishing change the pick', () => {
    const inshore = { mode: 'inshore', waterTempF: 76 };
    assert.equal(names(['redfish'], { ...inshore, tide: 'rising', date: JULY })[0], 'Gold spoon, weedless in grass');
    assert.notEqual(names(['redfish'], { ...inshore, tide: 'slack', date: JULY })[0], 'Gold spoon, weedless in grass');
    assert.ok(names(['redfish'], { ...inshore, tide: 'slack', date: OCTOBER }).includes('Cut mullet or crab at the passes and inlets'));
    assert.equal(names(['redfish'], { mode: 'inshore', waterTempF: 56, date: JANUARY })[0], 'Soft plastic or shrimp, sight-cast on sunny flats');
    assert.equal(names(['redfish'], { mode: 'surf', waterTempF: 76, tide: 'rising', date: OCTOBER })[0], 'Cut mullet or crab on a fish-finder rig');
    assert.equal(names(['seatrout'], { ...inshore, phase: 'dawn', date: JUNE })[0], 'Walk-the-dog topwater plug');
    assert.equal(names(['seatrout'], { ...inshore, waterTempF: 50, date: JANUARY })[0], 'Slow-sinking, fish-shaped plug');
    assert.equal(names(['snook'], { ...inshore, phase: 'night', tide: 'falling', date: JUNE })[0], 'Live pinfish or shrimp on a circle hook');
    assert.equal(names(['snook'], { ...inshore, waterTempF: 78, date: OCTOBER })[0], 'Walk-the-dog topwater or mullet swimbait');
    assert.equal(names(['striper'], { mode: 'inshore', waterTempF: 68, phase: 'night', tide: 'falling', date: JULY })[0], 'Live or soft-plastic eel');
    assert.equal(names(['striper'], { mode: 'surf', waterTempF: 58, date: NOVEMBER })[0], 'Metal or epoxy jig cast into blitzes');
    assert.equal(names(['striper'], { mode: 'inshore', waterTempF: 54, date: APRIL })[0], 'Cut or live menhaden (bunker)');
    assert.equal(names(['bluefish'], { mode: 'surf', waterTempF: 62, waveFt: 2 })[0], 'Metal spoon or diamond jig');
    assert.equal(names(['bluefish'], { mode: 'surf', waterTempF: 62, waveFt: 6 })[0], 'Cut bait on a fish-finder rig');
    assert.equal(names(['pompano'], { mode: 'surf', waterTempF: 74 })[0], 'Pompano rig with sand fleas, clam or shrimp');
    assert.equal(names(['flounder'], { ...inshore, waterTempF: 66, tide: 'falling', date: NOVEMBER })[0], 'Swimbait or live mullet at the inlet mouths');
});

test('fish that share another fish\'s tackle, and fish with no advice', () => {
    assert.equal(names(['fluke'], { mode: 'inshore', waterTempF: 64, tide: 'falling' })[0], 'Bucktail jig tipped with squid or a minnow');
    assert.equal(recommendLures(['fluke'], conditions({ mode: 'inshore', waterTempF: 64, tide: 'falling' }))[0].target, 'fluke');
    assert.equal(names(['halibut'], { mode: 'surf', waterTempF: 64, date: JUNE })[0], 'Swimbait on a jighead over sand');
    assert.equal(names(['corbina'], { mode: 'surf', waterTempF: 66 })[0], 'Scented sandworm or grub on a Carolina rig');
    assert.equal(names(['corbina'], { mode: 'surf', waterTempF: 68, date: JULY })[0], 'Live sand crab in the wash');
    assert.equal(recommendLures(['striper'], conditions({ mode: 'surf', waterTempF: 60 }))[0].target, 'striped bass');
    assert.equal(knownTarget('tarpon'), false);
    assert.deepEqual(recommendLures(['tarpon', 'rockfish'], conditions({ mode: 'inshore' })), []);
    assert.deepEqual(lurePatterns(['tarpon'], conditions({ mode: 'inshore', date: JULY })), []);
    assert.deepEqual(recommendLures([], conditions({})), []);
});

test('the first fish gets two picks, the rest one each, with no repeats and a limit', () => {
    const list = picks(['bass', 'panfish', 'catfish'], { waterTempF: 76, phase: 'dusk', windMph: 3, date: JUNE }, { limit: 4 });
    assert.deepEqual(list.map((pick) => pick.target), ['bass', 'bass', 'panfish', 'catfish']);
    assert.equal(new Set(list.map((pick) => pick.name)).size, 4);
    assert.equal(picks(['bass', 'panfish', 'catfish'], { waterTempF: 76, date: JUNE }, { limit: 2 }).length, 2);
    for (const pick of list) {
        assert.ok(pick.query && pick.how && pick.why);
        assert.ok(!/[.!?]$/.test(pick.why), 'the page adds the full stop');
        assert.ok(pick.note === null || !/[.!?]$/.test(pick.note));
    }
});

test('every fish has a pick in every season, whatever the light', () => {
    const fresh = ['bass', 'panfish', 'catfish', 'walleye', 'pike', 'muskie', 'smallmouth', 'perch', 'sauger', 'trout', 'salmon'];
    const salt = ['seatrout', 'redfish', 'flounder', 'fluke', 'halibut', 'snook', 'striper', 'bluefish', 'pompano', 'whiting', 'surfperch', 'corbina', 'croaker'];
    for (const month of [1, 3, 5, 7, 9, 11]) {
        const date = new Date(Date.UTC(2026, month - 1, 15, 17));
        for (const waterTempF of [40, 55, 65, 75, 85]) {
            for (const phase of ['day', 'dusk', 'night']) {
                for (const target of fresh) assert.ok(names([target], { waterTempF, phase, date }).length > 0, `${target} ${month} ${waterTempF} ${phase}`);
                for (const target of salt) assert.ok(names([target], { mode: 'inshore', waterTempF, phase, date }).length > 0, `${target} ${month} ${waterTempF} ${phase}`);
            }
        }
    }
});

test('colour advice gives the tradition, the forage of the season, and what the studies found', () => {
    for (const c of [{ clarity: 'muddy', light: 'bright' }, { clarity: 'clear', light: 'bright' }, { clarity: 'normal', light: 'dark' }, { clarity: 'normal', light: 'low' }]) {
        assert.match(colourAdvice(c), /found no effect on catch rate/);
    }
    assert.match(colourAdvice({ clarity: 'muddy', light: 'bright' }), /bright, vivid/);
    assert.match(colourAdvice({ clarity: 'clear', light: 'bright' }), /natural colours/);
    assert.match(colourAdvice({ clarity: 'normal', light: 'dark' }), /black after dark/);
    assert.match(colourAdvice({ clarity: 'normal', light: 'bright' }, 'shad'), /Match the shad/);
    assert.doesNotMatch(colourAdvice({ clarity: 'muddy', light: 'bright' }, 'shad'), /Match/);
});

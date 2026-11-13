import assert from 'node:assert/strict';
import { test } from 'node:test';

import { colourAdvice, knownTarget, lureConditions, recommendLures } from '../js/core/lures.js';

const conditions = (overrides) => lureConditions({ waterTempF: 72, phase: 'day', sky: 'clear', windMph: 6, ...overrides });
const names = (targets, overrides, options) => recommendLures(targets, conditions(overrides), options).map((pick) => pick.name);

test('raw readings are reduced to the categories anglers think in', () => {
    assert.deepEqual(conditions({}), { waterTempF: 72, light: 'bright', clarity: 'normal', wind: 'light', mode: 'fresh', tide: null, surf: null });
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

test('bass: the pick follows temperature, light, wind and clarity', () => {
    assert.equal(names(['bass'], { waterTempF: 46 })[0], 'Suspending jerkbait');
    assert.equal(names(['bass'], { waterTempF: 76, phase: 'dusk', windMph: 3 })[0], 'Topwater popper or prop bait');
    assert.equal(names(['bass'], { waterTempF: 76, windMph: 15 })[0], 'Spinnerbait or crankbait');
    assert.equal(names(['bass'], { waterTempF: 76, flowPercentile: 95 })[0], 'Large-blade spinnerbait');
    assert.equal(names(['bass'], { waterTempF: 76 })[0], 'Plastic worm or jig');
    // Topwater wants a calm surface, so it is not suggested in a wind even at dusk.
    assert.ok(!names(['bass'], { waterTempF: 76, phase: 'dusk', windMph: 15 }).includes('Topwater popper or prop bait'));
    // Nor in cold water.
    assert.ok(!names(['bass'], { waterTempF: 46, phase: 'dusk', windMph: 2 }).includes('Topwater popper or prop bait'));
});

test('"cold" is judged against each fish, not on one scale', () => {
    // 60°F: cool for bass, ideal for walleye.
    const picks = recommendLures(['bass', 'walleye'], conditions({ waterTempF: 60 }));
    assert.equal(picks.find((pick) => pick.target === 'bass').name, 'Spinnerbait or crankbait');
    assert.equal(picks.find((pick) => pick.target === 'walleye').name, 'Nightcrawler or leech on a slip-sinker rig or crawler harness');
    assert.equal(names(['walleye'], { waterTempF: 40 })[0], 'Jig and minnow');
    assert.equal(names(['walleye'], { waterTempF: 60, phase: 'night' })[0], 'Shallow-running minnow crankbait');
});

test('advice that replaces the lures: warm trout, sight feeders after dark, cold snook', () => {
    const trout = recommendLures(['trout'], conditions({ waterTempF: 72 }));
    assert.equal(trout.length, 1);
    assert.equal(trout[0].name, 'Give the trout a rest');
    assert.equal(trout[0].query, null);

    assert.deepEqual(names(['pike'], { waterTempF: 60, phase: 'night' }), ['Wait for daylight']);
    assert.deepEqual(names(['panfish'], { phase: 'night' }), ['Wait for daylight']);
    assert.deepEqual(names(['snook'], { waterTempF: 56, mode: 'inshore', tide: 'falling' }), ['Leave the snook alone']);
});

test('trout: off-colour water calls for bait on the bottom, clear water for light line', () => {
    assert.equal(names(['trout'], { waterTempF: 55, flowPercentile: 95 })[0], 'Worm with extra split shot');
    assert.equal(names(['trout'], { waterTempF: 55, flowPercentile: 10 })[0], 'Small bait on a 2 to 4 lb leader');
    assert.equal(names(['trout'], { waterTempF: 55 })[0], 'Small spinner or spoon');
});

test('salt water: tide, light and the style of fishing change the pick', () => {
    const inshore = { mode: 'inshore', waterTempF: 76 };
    assert.equal(names(['redfish'], { ...inshore, tide: 'rising' })[0], 'Gold spoon, weedless in grass');
    assert.notEqual(names(['redfish'], { ...inshore, tide: 'slack' })[0], 'Gold spoon, weedless in grass');
    assert.equal(names(['redfish'], { mode: 'surf', waterTempF: 76, tide: 'rising' })[0], 'Cut mullet or crab on a fish-finder rig');
    assert.equal(names(['seatrout'], { ...inshore, phase: 'dawn' })[0], 'Walk-the-dog topwater plug');
    assert.equal(names(['seatrout'], { ...inshore, waterTempF: 50 })[0], 'Slow-sinking, fish-shaped plug');
    assert.equal(names(['snook'], { ...inshore, phase: 'night', tide: 'falling' })[0], 'Live pinfish or shrimp on a circle hook');
    assert.equal(names(['striper'], { mode: 'inshore', waterTempF: 60, phase: 'night', tide: 'falling' })[0], 'Live or soft-plastic eel');
    assert.equal(names(['bluefish'], { mode: 'surf', waterTempF: 62, waveFt: 2 })[0], 'Metal spoon or diamond jig');
    assert.equal(names(['bluefish'], { mode: 'surf', waterTempF: 62, waveFt: 6 })[0], 'Cut bait on a fish-finder rig');
    assert.equal(names(['pompano'], { mode: 'surf', waterTempF: 74 })[0], 'Pompano rig with sand fleas, clam or shrimp');
});

test('fish that share another fish\'s tackle, and fish with no advice', () => {
    assert.equal(names(['fluke'], { mode: 'inshore', waterTempF: 64, tide: 'falling' })[0], 'Bucktail jig tipped with squid or a minnow');
    assert.equal(recommendLures(['fluke'], conditions({ mode: 'inshore', waterTempF: 64, tide: 'falling' }))[0].target, 'fluke');
    assert.equal(names(['corbina'], { mode: 'surf', waterTempF: 66 })[0], 'Scented sandworm or grub on a Carolina rig');
    assert.equal(recommendLures(['striper'], conditions({ mode: 'surf', waterTempF: 60 }))[0].target, 'striped bass');
    assert.equal(knownTarget('tarpon'), false);
    assert.deepEqual(recommendLures(['tarpon', 'rockfish'], conditions({ mode: 'inshore' })), []);
    assert.deepEqual(recommendLures([], conditions({})), []);
});

test('the first fish gets two picks, the rest one each, with no repeats and a limit', () => {
    const picks = recommendLures(['bass', 'panfish', 'catfish'], conditions({ waterTempF: 76, phase: 'dusk', windMph: 3 }), { limit: 4 });
    assert.deepEqual(picks.map((pick) => pick.target), ['bass', 'bass', 'panfish', 'catfish']);
    assert.equal(new Set(picks.map((pick) => pick.name)).size, 4);
    assert.equal(recommendLures(['bass', 'panfish', 'catfish'], conditions({ waterTempF: 76 }), { limit: 2 }).length, 2);
    for (const pick of picks) {
        assert.ok(pick.query && pick.how && pick.why);
        assert.ok(!/[.!?]$/.test(pick.why), 'the page adds the full stop');
    }
});

test('colour advice gives the tradition and says what the studies found', () => {
    for (const c of [{ clarity: 'muddy', light: 'bright' }, { clarity: 'clear', light: 'bright' }, { clarity: 'normal', light: 'dark' }, { clarity: 'normal', light: 'low' }]) {
        assert.match(colourAdvice(c), /found no effect on catch rate/);
    }
    assert.match(colourAdvice({ clarity: 'muddy', light: 'bright' }), /bright, vivid/);
    assert.match(colourAdvice({ clarity: 'clear', light: 'bright' }), /natural colours/);
    assert.match(colourAdvice({ clarity: 'normal', light: 'dark' }), /black after dark/);
});

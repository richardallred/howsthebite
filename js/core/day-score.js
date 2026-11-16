// A day's score, and the parts of a day an angler plans around.
//
// The score moves through the day with the light, the wind and the tide, and nobody fishes a single
// moment: they go out for a couple of hours, or for the evening. So a day is scored by its best
// two-hour stretch, and each part of it (dawn, morning, afternoon, dusk, night) by the hours in it.

import { HOUR_MS } from './util.js';

/**
 * The hours from `from` up to `to` that are still to come, and their average score.
 * Hours are [{ t, score, past? }], one per hour, in order; an hour belongs to the stretch
 * its middle falls in. Returns { start, end, score, top } (top: its best hour), or null.
 */
export function stretchOf(hours, from = -Infinity, to = Infinity) {
    const inside = hours.filter((hour) => !hour.past && hour.t + HOUR_MS / 2 >= from && hour.t + HOUR_MS / 2 < to);
    if (!inside.length) return null;
    const top = inside.reduce((best, hour) => (hour.score > best.score ? hour : best));
    const mean = inside.reduce((sum, hour) => sum + hour.score, 0) / inside.length;
    return { start: inside[0].t, end: inside[inside.length - 1].t + HOUR_MS, score: Math.round(mean), top };
}

/**
 * The best run of `length` hours still to come (all of what is left, when less is): the
 * day's score. The earliest wins a tie. Returns what stretchOf does, or null when the day is over.
 */
export function bestStretch(hours, length = 2) {
    const ahead = hours.filter((hour) => !hour.past);
    if (!ahead.length) return null;
    const span = Math.min(length, ahead.length);
    let best = null;
    for (let i = 0; i + span <= ahead.length; i++) {
        const stretch = stretchOf(ahead.slice(i, i + span));
        const sum = ahead.slice(i, i + span).reduce((total, hour) => total + hour.score, 0);
        if (!best || sum > best.sum) best = { sum, stretch };
    }
    return best.stretch;
}

const BLOCK_LABELS = { dawn: 'Dawn', morning: 'Morning', afternoon: 'Afternoon', dusk: 'Dusk', night: 'Night' };

/**
 * The parts of a day, from its local midnight `start` to the next one, `end`: [{ id, label, start, end }].
 * Dawn runs from an hour before sunrise to 90 minutes after it, dusk from 90 minutes before
 * sunset to an hour after it, and the daylight between is split at its middle into morning
 * and afternoon. Night is the evening after dusk (the small hours before dawn belong to no part).
 * Where the sun does not rise or set that day, the parts follow the clock instead.
 */
export function dayParts({ start, end, sunrise = null, sunset = null }) {
    const valid = sunrise && sunset && sunrise > start && sunset < end && sunset > sunrise;
    const at = valid
        ? (() => {
            const dawnEnd = sunrise + 1.5 * HOUR_MS;
            const duskStart = Math.max(dawnEnd, sunset - 1.5 * HOUR_MS);
            return [sunrise - HOUR_MS, dawnEnd, (dawnEnd + duskStart) / 2, duskStart, sunset + HOUR_MS, end];
        })()
        : [5, 8, 12, 17, 20, 24].map((hour) => start + hour * HOUR_MS);
    return ['dawn', 'morning', 'afternoon', 'dusk', 'night']
        .map((id, index) => ({ id, label: BLOCK_LABELS[id], start: at[index], end: at[index + 1] }))
        .filter((part) => part.end - part.start >= HOUR_MS / 2);
}

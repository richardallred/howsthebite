// The state of the tide at any moment, from a list of predicted highs and lows.
//
// Between one extreme and the next the water follows very nearly half a cosine wave,
// so height and speed can be read off without a harmonic model: fastest at mid-tide,
// still at the top and bottom.

/**
 * @typedef {{ t: number, heightFt: number, type: 'H'|'L' }} TideExtreme  epoch-ms time of a predicted high or low
 */

const SLACK_MOVEMENT = 0.3; // within roughly 35 minutes of a high or low on a normal 6-hour tide

/**
 * @param {TideExtreme[]} extremes  sorted by time, covering `time`
 * @param {number} time  epoch ms
 * @returns {null | {
 *   heightFt: number,
 *   direction: 'rising'|'falling',
 *   movement: number,          0 at slack water, 1 at the fastest point of the tide
 *   slack: boolean,
 *   previous: TideExtreme, next: TideExtreme,
 * }}  null when `time` falls outside the predictions
 */
export function tideAt(extremes, time) {
    if (!Array.isArray(extremes)) return null;
    const index = extremes.findIndex((extreme) => extreme.t > time);
    if (index <= 0) return null;
    const previous = extremes[index - 1];
    const next = extremes[index];
    const progress = (time - previous.t) / (next.t - previous.t);
    const movement = Math.sin(Math.PI * progress);
    return {
        heightFt: previous.heightFt + ((next.heightFt - previous.heightFt) * (1 - Math.cos(Math.PI * progress))) / 2,
        direction: next.heightFt >= previous.heightFt ? 'rising' : 'falling',
        movement,
        slack: movement < SLACK_MOVEMENT,
        previous,
        next,
    };
}

/** Water height through a period, for a chart: [{ t, v }] every `stepMinutes`. */
export function tideCurve(extremes, from, to, stepMinutes = 15) {
    const points = [];
    for (let t = from; t <= to; t += stepMinutes * 60 * 1000) {
        const tide = tideAt(extremes, t);
        if (tide) points.push({ t, v: tide.heightFt });
    }
    return points;
}

/** The highs and lows still to come, soonest first. */
export const upcomingTides = (extremes, time, count = 4) => (extremes ?? []).filter((extreme) => extreme.t > time).slice(0, count);

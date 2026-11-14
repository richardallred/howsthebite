// Trend analysis over timestamped series: [{ t: epochMs, v: number }] sorted by time.
//
// Trends are measured as "change over the last N hours" using the real timestamps,
// so the result does not depend on how often the source happens to sample.

import { HOUR_MS, isNum } from './util.js';

/** Linear interpolation of the series at time `t`. Null if `t` is outside the series (± tolerance). */
export function valueAt(series, t, toleranceMs = 90 * 60 * 1000) {
    if (!series?.length) return null;
    const first = series[0];
    const last = series[series.length - 1];
    if (t <= first.t) return first.t - t <= toleranceMs ? first.v : null;
    if (t >= last.t) return t - last.t <= toleranceMs ? last.v : null;

    let lo = 0;
    let hi = series.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (series[mid].t <= t) lo = mid;
        else hi = mid;
    }
    const a = series[lo];
    const b = series[hi];
    if (b.t === a.t) return a.v;
    return a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
}

/**
 * Change in value over the `hours` leading up to the latest sample.
 * Returns null when the series does not reach back far enough.
 */
export function changeOver(series, hours) {
    if (!series || series.length < 2) return null;
    const last = series[series.length - 1];
    const earlier = valueAt(series, last.t - hours * HOUR_MS);
    if (!isNum(earlier) || !isNum(last.v)) return null;
    return last.v - earlier;
}

/**
 * Classify a change as rising / falling / steady, and whether it is rapid.
 * `steadyBelow` and `rapidAbove` are absolute thresholds in the series' own unit.
 */
export function classifyTrend(delta, { steadyBelow, rapidAbove }) {
    if (!isNum(delta)) return { direction: 'unknown', rapid: false, delta: null };
    const magnitude = Math.abs(delta);
    if (magnitude < steadyBelow) return { direction: 'steady', rapid: false, delta };
    return {
        direction: delta > 0 ? 'rising' : 'falling',
        rapid: magnitude >= rapidAbove,
        delta,
    };
}

/** Samples within the last `hours` (relative to `now`). */
export function lastHours(series, hours, now = Date.now()) {
    const cutoff = now - hours * HOUR_MS;
    return (series ?? []).filter((point) => point.t >= cutoff && point.t <= now);
}

export function mean(values) {
    const nums = values.filter(isNum);
    return nums.length ? nums.reduce((sum, v) => sum + v, 0) / nums.length : null;
}

/**
 * Whether a weather front is on its way or has just gone through, from the barometer and
 * the air temperature over the last two days:
 *   'approaching'  pressure falling steadily (≥ 0.08 inHg in 12 hours)
 *   'passed'       pressure up sharply over the last day, with the air colder than the day before
 * Null when neither, or when the series are too short to tell.
 *
 * Anglers' advice on fronts (feed ahead of one, slow down after) is near-universal but has
 * barely been measured, so the lure suggestions lean on it only lightly.
 */
export function frontState(pressure, air) {
    const change12 = changeOver(pressure, 12);
    const change24 = changeOver(pressure, 24);
    if (isNum(change24) && change24 >= 0.12) {
        const last = air?.[air.length - 1]?.t;
        const recent = isNum(last) ? mean(air.filter((point) => point.t > last - 24 * HOUR_MS).map((point) => point.v)) : null;
        const before = isNum(last) ? mean(air.filter((point) => point.t <= last - 24 * HOUR_MS && point.t > last - 48 * HOUR_MS).map((point) => point.v)) : null;
        const cooled = isNum(recent) && isNum(before) && recent - before <= -5;
        if (cooled || change24 >= 0.18) return 'passed';
    }
    if (isNum(change12) && change12 <= -0.08) return 'approaching';
    return null;
}

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

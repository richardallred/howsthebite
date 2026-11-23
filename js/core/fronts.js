// Weather on the way: fronts and rain, read from the hour-by-hour forecast.
//
// The Weather Service's hourly forecast carries no barometer and no "front" field, but a front
// is a change of air mass, and that shows in the forecast temperatures: the air on the far side
// of a cold front is colder at every hour of the day than the air ahead of it. So each hour is
// compared with the same hour a day earlier, which takes the daily warm-up and cool-down out,
// and a front is where the day-on-day change is large:
//
//   cold front   the 24 hours after it average 8°F or more colder than the 24 before
//   warm front   the same, warmer
//
// The series runs from the last three days of observations into the forecast, so a front that
// went through yesterday and one due on Wednesday are found the same way. The thresholds are
// judgement, not measurement, and a summer front that dries the air without cooling it much
// goes unnoticed. What a front is worth to the score is decided in scoring.js (scorePressure).

import { valueAt } from './trend.js';
import { HOUR_MS, isNum } from './util.js';

const DAY_MS = 24 * HOUR_MS;

/** Day-on-day change in air temperature that counts as a change of air mass, °F. */
export const FRONT_CHANGE_F = 8;
/** Fish are said to feed ahead of a front for the better part of a day. */
export const FRONT_AHEAD_HOURS = 18;
/** The slow bite behind a cold front is put at a day or two. */
export const FRONT_BEHIND_HOURS = 36;
const WARM_BEHIND_HOURS = 24;

const MIN_HOURS_AFTER = 12; // a front this close to the end of the forecast can still be told
const MIN_PAIRS_SHARE = 0.75;
const STEEPEST_OVER_HOURS = 3;

/**
 * Observed air temperature followed by the forecast, as one hourly series [{ t, v }].
 *
 * A weather station and the forecast for the spot rarely agree to the degree (an airport in
 * the valley, a lake up the hill), so the forecast is shifted to meet the reading at `now`:
 * otherwise the join itself would look like a change of air.
 *
 * @param {Array<{ t: number, v: number }>} observed  oldest first, up to now
 * @param {Array<{ start: number, end: number, tempF?: number }>} forecast  hourly periods (weather.outlook)
 * @param {number} now  epoch ms
 */
export function airSeries(observed, forecast, now) {
    const past = (observed ?? []).filter((point) => isNum(point?.t) && isNum(point.v) && point.t <= now);
    const hours = (forecast ?? []).filter((period) => isNum(period?.tempF) && period.end - period.start <= HOUR_MS);
    const latest = past[past.length - 1];
    const current = hours.find((period) => period.start <= now && now < period.end) ?? hours[0];
    const offset = latest && current && now - latest.t <= 3 * HOUR_MS ? latest.v - current.tempF : 0;
    const ahead = hours
        .filter((period) => period.start > (latest?.t ?? -Infinity))
        .map((period) => ({ t: period.start, v: period.tempF + offset }));
    return [...past, ...ahead];
}

/**
 * Fronts in an hourly air-temperature series: [{ kind: 'cold'|'warm', t, changeF }], earliest
 * first. `t` is when the air changes fastest (to the nearest hour or so: say "Tuesday evening",
 * not "7:15 PM"); `changeF` is the day-on-day change in the 24 hours that follow.
 */
export function detectFronts(series) {
    if (!series || series.length < 2) return [];
    const first = Math.ceil(series[0].t / HOUR_MS) * HOUR_MS;
    const last = Math.floor(series[series.length - 1].t / HOUR_MS) * HOUR_MS;
    const at = (t) => valueAt(series, t);
    // How much warmer (or colder) each hour is than the same hour the day before.
    const dayOnDay = new Map();
    for (let t = first + DAY_MS; t <= last; t += HOUR_MS) {
        const [today, yesterday] = [at(t), at(t - DAY_MS)];
        if (isNum(today) && isNum(yesterday)) dayOnDay.set(t, today - yesterday);
    }

    // For each hour, the mean of that over the day that follows (less, near the end of the forecast).
    const candidates = [];
    for (let t = first + DAY_MS; t + MIN_HOURS_AFTER * HOUR_MS <= last + HOUR_MS; t += HOUR_MS) {
        const span = Math.min(24, Math.floor((last - t) / HOUR_MS) + 1);
        let sum = 0;
        let count = 0;
        for (let k = 0; k < span; k++) {
            const change = dayOnDay.get(t + k * HOUR_MS);
            if (isNum(change)) {
                sum += change;
                count++;
            }
        }
        if (count >= span * MIN_PAIRS_SHARE) candidates.push({ t, change: sum / count });
    }

    // Each unbroken run of hours past the threshold is one front.
    const fronts = [];
    const close = (run) => {
        if (!run.length) return;
        const sign = Math.sign(run[0].change);
        const peak = run.reduce((best, hour) => (Math.abs(hour.change) > Math.abs(best.change) ? hour : best));
        fronts.push({ kind: sign < 0 ? 'cold' : 'warm', t: steepest(dayOnDay, run, sign) ?? peak.t, changeF: peak.change });
    };
    let run = [];
    for (const hour of candidates) {
        const past = Math.abs(hour.change) >= FRONT_CHANGE_F;
        const joins = run.length && hour.t - run[run.length - 1].t === HOUR_MS && Math.sign(hour.change) === Math.sign(run[0].change);
        if (past && joins) run.push(hour);
        else {
            close(run);
            run = past ? [hour] : [];
        }
    }
    close(run);
    return fronts;
}

/** Within a run, the middle of the few hours over which the day-on-day change moves fastest. */
function steepest(dayOnDay, run, sign) {
    let best = null;
    const span = STEEPEST_OVER_HOURS * HOUR_MS;
    for (let t = run[0].t - span; t <= run[run.length - 1].t; t += HOUR_MS) {
        const [before, after] = [dayOnDay.get(t), dayOnDay.get(t + span)];
        if (!isNum(before) || !isNum(after)) continue;
        const move = (after - before) * sign;
        if (!best || move > best.move) best = { move, t: t + span / 2 };
    }
    return best && best.move > 0 ? best.t : null;
}

/**
 * Where `time` stands against the fronts found: ahead of one ('approaching', within 18 hours)
 * or behind one ('passed': 36 hours for a cold front, 24 for a warm one), whichever is nearer.
 * @returns {{ state: 'approaching'|'passed', kind: 'cold'|'warm', t: number, changeF: number }|null}
 */
export function frontAt(fronts, time) {
    let nearest = null;
    for (const front of fronts ?? []) {
        const since = time - front.t;
        const behind = (front.kind === 'cold' ? FRONT_BEHIND_HOURS : WARM_BEHIND_HOURS) * HOUR_MS;
        const state = since >= 0 && since < behind ? 'passed' : since < 0 && -since <= FRONT_AHEAD_HOURS * HOUR_MS ? 'approaching' : null;
        if (state && (!nearest || Math.abs(since) < Math.abs(time - nearest.t))) nearest = { state, ...front };
    }
    return nearest;
}

const WET = new Set(['light-precip', 'precip', 'storm']);
const RAIN_LIKELY_PERCENT = 50;
const RAIN_LOOKAHEAD_HOURS = 48;

/**
 * The next spell of likely rain (or snow) in the hourly forecast, when it is dry now:
 * { start, end, storm, snow }, or null. An hour counts when the forecast pictures precipitation
 * and puts the chance at 50% or more; one dry hour does not end a spell. `storm` is when
 * thunderstorms first become likely in it (forecastSkyClass has already dropped the mere
 * chances), or null: days of rain can hold a few hours of them. `snow` is whether it starts
 * as snow or ice.
 */
export function rainAhead(forecast, now) {
    const hours = (forecast ?? []).filter((period) => period.end - period.start <= HOUR_MS && period.end > now);
    const wet = (period) => WET.has(period.sky) && (!isNum(period.pop) || period.pop >= RAIN_LIKELY_PERCENT);
    if (!hours.length || wet(hours[0])) return null; // already raining: nothing is "on the way"
    const from = hours.findIndex((period) => wet(period) && period.start - now <= RAIN_LOOKAHEAD_HOURS * HOUR_MS);
    if (from < 0) return null;
    let to = from;
    for (let i = from + 1; i < hours.length && (wet(hours[i]) || (i + 1 < hours.length && wet(hours[i + 1]))); i++) to = i;
    const spell = hours.slice(from, to + 1);
    return {
        start: spell[0].start,
        end: spell[spell.length - 1].end,
        storm: spell.find((period) => period.sky === 'storm')?.start ?? null,
        snow: Boolean(spell[0].snow),
    };
}

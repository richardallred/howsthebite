// Dependency-free SVG line chart for a single time series.
//
// One series per chart (no legend needed: the card title names it), a 2px line
// with a light area wash, hairline grid, an end-of-line value label, a
// crosshair + tooltip on hover/touch/arrow keys, and a "View data" table so
// nothing is reachable only by hovering. Colors come from CSS custom
// properties, so the chart follows the light/dark theme without re-rendering.

import { HOUR_MS, niceTicks } from '../core/util.js';

const DAY_MS = 24 * HOUR_MS;
import { el, svg } from './dom.js';

const HEIGHT = 176; // keep in step with .chart-plot in styles.css
const MARGIN = { top: 14, right: 52, bottom: 26, left: 44 };

const formatters = new Map();
export function formatter(timezone, options) {
    const key = `${timezone}|${JSON.stringify(options)}`;
    if (!formatters.has(key)) {
        let instance;
        try {
            instance = new Intl.DateTimeFormat('en-US', { ...options, timeZone: timezone });
        } catch {
            instance = new Intl.DateTimeFormat('en-US', options);
        }
        formatters.set(key, instance);
    }
    return formatters.get(key);
}

const hourIn = (t, timezone) => Number(formatter(timezone, { hour: 'numeric', hourCycle: 'h23' }).format(t));
const weekday = (t, timezone) => formatter(timezone, { weekday: 'short' }).format(t);
const dayOfMonth = (t, timezone) => Number(formatter(timezone, { day: 'numeric' }).format(t));
const monthDay = (t, timezone) => formatter(timezone, { month: 'short', day: 'numeric' }).format(t);
const monthName = (t, timezone) => formatter(timezone, { month: 'short' }).format(t);

/** A point's time as the read-out shows it: finer for a short window, the date alone for daily means. */
export function pointTime(t, timezone, { span = 0, daily = false } = {}) {
    if (daily) return formatter('UTC', { weekday: 'short', month: 'short', day: 'numeric' }).format(t);
    if (span > 3.5 * DAY_MS) return formatter(timezone, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(t);
    return formatter(timezone, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(t);
}

/** Local midnights from `start` to `end`. Found hour by hour, then a day apart (a DST hour off is invisible at this scale). */
function midnights(start, end, timezone) {
    let t = Math.ceil(start / HOUR_MS) * HOUR_MS;
    for (let i = 0; i < 24 && hourIn(t, timezone) !== 0; i++) t += HOUR_MS;
    const out = [];
    for (; t <= end; t += DAY_MS) out.push(t);
    return out;
}

/**
 * Tick marks for the time axis, scaled to the window: midnight and noon over two days,
 * each day over a week, about weekly dates over a month, months over a year.
 */
export function timeTicks(start, end, timezone) {
    const span = end - start;
    if (span <= 3.5 * DAY_MS) {
        const ticks = [];
        for (let t = Math.ceil(start / HOUR_MS) * HOUR_MS; t <= end; t += HOUR_MS) {
            const hour = hourIn(t, timezone);
            if (hour === 0) ticks.push({ t, label: weekday(t, timezone), major: true });
            else if (hour === 12) ticks.push({ t, label: 'noon', major: false });
        }
        return ticks;
    }
    const days = midnights(start, end, timezone);
    if (span <= 10 * DAY_MS) return days.map((t) => ({ t, label: weekday(t, timezone), major: true }));
    if (span <= 60 * DAY_MS) {
        return days.filter((t) => [1, 8, 15, 22].includes(dayOfMonth(t, timezone)))
            .map((t) => ({ t, label: monthDay(t, timezone), major: true }));
    }
    return days.filter((t) => dayOfMonth(t, timezone) === 1).map((t) => ({ t, label: monthName(t, timezone), major: true }));
}

/** "48 hours", "7 days", "year": how long a window is, in words. */
export function spanWords(ms) {
    const hours = Math.round(ms / HOUR_MS);
    if (hours <= 72) return `${hours} hours`;
    const days = Math.round(ms / DAY_MS);
    return days >= 300 ? 'year' : `${days} days`;
}

/** Hours between rows of the data table, so a window gives a readable number of rows. */
const tableStep = (span) => {
    if (span <= 3.5 * DAY_MS) return 3 * HOUR_MS;
    if (span <= 10 * DAY_MS) return 12 * HOUR_MS;
    if (span <= 60 * DAY_MS) return DAY_MS;
    return 7 * DAY_MS;
};

export function nearestIndex(series, t) {
    let lo = 0;
    let hi = series.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (series[mid].t < t) lo = mid;
        else hi = mid;
    }
    return t - series[lo].t <= series[hi].t - t ? lo : hi;
}

/**
 * @param {HTMLElement} container
 * @param {object} options
 * @param {string} options.label      what is plotted, e.g. "Barometric pressure"
 * @param {(v:number)=>string} options.format      full value, e.g. "30.04 inHg"
 * @param {(v:number)=>string} options.formatTick  axis/end label, e.g. "30.04"
 * @param {number} options.minRange   smallest y-range to show (avoids exaggerating noise)
 */
export function createLineChart(container, { label, format, formatTick, minRange }) {
    let series = [];
    let timezone = 'UTC';
    let emptyText = 'No data yet';
    let expectedSpan = 0;
    let geometry = null;
    let activeIndex = null;

    const plot = el('div', { class: 'chart-plot', tabindex: '0', role: 'img' });
    const tooltip = el('div', { class: 'chart-tooltip', hidden: true });
    const empty = el('p', { class: 'chart-empty', hidden: true });
    const shortNote = el('p', { class: 'chart-note', hidden: true });
    const tableBody = el('tbody');
    const details = el('details', { class: 'chart-data' },
        el('summary', null, 'View data'),
        el('table', null,
            el('thead', null, el('tr', null, el('th', { scope: 'col' }, 'Time'), el('th', { scope: 'col' }, label))),
            tableBody));
    container.replaceChildren(el('div', { class: 'chart-frame' }, plot, tooltip), shortNote, empty, details);
    const isDaily = () => Boolean(series[0]?.daily);
    const span = () => (series.length >= 2 ? series[series.length - 1].t - series[0].t : 0);
    const timeOf = (t) => pointTime(t, timezone, { span: span(), daily: isDaily() });

    function draw() {
        const hasData = series.length >= 2;
        plot.hidden = !hasData;
        details.hidden = !hasData;
        empty.hidden = hasData;
        empty.textContent = emptyText;
        hideTooltip();
        if (!hasData) {
            geometry = null;
            return;
        }
        const width = Math.floor(plot.clientWidth);
        if (width < 80) return; // not laid out yet; the ResizeObserver will call again

        const innerW = width - MARGIN.left - MARGIN.right;
        const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;
        const t0 = series[0].t;
        const t1 = series[series.length - 1].t;

        let lo = Math.min(...series.map((p) => p.v));
        let hi = Math.max(...series.map((p) => p.v));
        if (hi - lo < minRange) {
            const middle = (hi + lo) / 2;
            lo = middle - minRange / 2;
            hi = middle + minRange / 2;
        }
        const scale = niceTicks(lo, hi, 3);
        const x = (t) => MARGIN.left + ((t - t0) / (t1 - t0)) * innerW;
        const y = (v) => MARGIN.top + (1 - (v - scale.min) / (scale.max - scale.min)) * innerH;
        const baseline = MARGIN.top + innerH;

        const root = svg('svg', { width, height: HEIGHT, viewBox: `0 0 ${width} ${HEIGHT}`, 'aria-hidden': 'true' });

        for (const tick of scale.ticks) {
            root.append(
                svg('line', { class: 'chart-grid', x1: MARGIN.left, x2: MARGIN.left + innerW, y1: y(tick), y2: y(tick) }),
                svg('text', { class: 'chart-tick', x: MARGIN.left - 8, y: y(tick), 'text-anchor': 'end', 'dominant-baseline': 'middle' }, formatTick(tick)),
            );
        }
        const timeTickList = timeTicks(t0, t1, timezone);
        // Label every tick when they fit, otherwise every second or third (a year of months on a phone).
        const labelWidth = Math.max(0, ...timeTickList.map((tick) => tick.label.length)) * 7 + 10;
        const labelEvery = Math.max(1, Math.ceil((timeTickList.length * labelWidth) / innerW));
        for (const [index, tick] of timeTickList.entries()) {
            const tx = x(tick.t);
            if (tick.major) root.append(svg('line', { class: 'chart-grid', x1: tx, x2: tx, y1: MARGIN.top, y2: baseline }));
            if (index % labelEvery === 0 && tx > MARGIN.left + 12 && tx < MARGIN.left + innerW - 12) {
                root.append(svg('text', { class: 'chart-tick', x: tx, y: HEIGHT - 8, 'text-anchor': 'middle' }, tick.label));
            }
        }

        const points = series.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`);
        root.append(
            svg('path', { class: 'chart-area', d: `M${MARGIN.left},${baseline}L${points.join('L')}L${MARGIN.left + innerW},${baseline}Z` }),
            svg('path', { class: 'chart-line', d: `M${points.join('L')}` }),
        );

        const last = series[series.length - 1];
        const crosshair = svg('line', { class: 'chart-crosshair', y1: MARGIN.top, y2: baseline, visibility: 'hidden' });
        const hoverDot = svg('circle', { class: 'chart-dot', r: 4.5, visibility: 'hidden' });
        root.append(
            crosshair,
            svg('circle', { class: 'chart-dot', cx: x(last.t), cy: y(last.v), r: 4.5 }),
            svg('text', { class: 'chart-end-label', x: x(last.t) + 9, y: y(last.v), 'dominant-baseline': 'middle' }, formatTick(last.v)),
            hoverDot,
        );

        plot.replaceChildren(root);
        geometry = { x, y, t0, t1, innerW, width, crosshair, hoverDot };
    }

    function showTooltip(index) {
        if (!geometry) return;
        activeIndex = index;
        const point = series[index];
        const px = geometry.x(point.t);
        const py = geometry.y(point.v);
        geometry.crosshair.setAttribute('x1', px);
        geometry.crosshair.setAttribute('x2', px);
        geometry.crosshair.setAttribute('visibility', 'visible');
        geometry.hoverDot.setAttribute('cx', px);
        geometry.hoverDot.setAttribute('cy', py);
        geometry.hoverDot.setAttribute('visibility', 'visible');

        tooltip.replaceChildren(
            el('strong', null, format(point.v)),
            el('span', null, isDaily() ? `${timeOf(point.t)} · daily mean` : timeOf(point.t)),
        );
        tooltip.hidden = false;
        const flip = px > geometry.width * 0.6;
        tooltip.style.left = `${px}px`;
        tooltip.style.top = `${Math.max(4, py - 12)}px`;
        tooltip.dataset.side = flip ? 'left' : 'right';
    }

    function hideTooltip() {
        activeIndex = null;
        tooltip.hidden = true;
        geometry?.crosshair.setAttribute('visibility', 'hidden');
        geometry?.hoverDot.setAttribute('visibility', 'hidden');
    }

    function onPointer(event) {
        if (!geometry) return;
        const bounds = plot.getBoundingClientRect();
        const ratio = (event.clientX - bounds.left - MARGIN.left) / geometry.innerW;
        const t = geometry.t0 + Math.min(1, Math.max(0, ratio)) * (geometry.t1 - geometry.t0);
        showTooltip(nearestIndex(series, t));
    }

    plot.addEventListener('pointermove', onPointer);
    plot.addEventListener('pointerdown', onPointer);
    // A finger lifting also fires pointerleave; on touch the read-out stays until a tap elsewhere.
    plot.addEventListener('pointerleave', (event) => {
        if (event.pointerType !== 'touch') hideTooltip();
    });
    document.addEventListener('pointerdown', (event) => {
        if (activeIndex !== null && !plot.contains(event.target)) hideTooltip();
    });
    plot.addEventListener('blur', hideTooltip);
    plot.addEventListener('keydown', (event) => {
        if (!geometry) return;
        const lastIndex = series.length - 1;
        const current = activeIndex ?? lastIndex;
        const step = Math.max(1, Math.round(series.length / 48));
        const moves = { ArrowLeft: current - step, ArrowRight: current + step, Home: 0, End: lastIndex };
        if (event.key === 'Escape') hideTooltip();
        else if (event.key in moves) {
            event.preventDefault();
            showTooltip(Math.min(lastIndex, Math.max(0, moves[event.key])));
        }
    });

    function describe() {
        shortNote.hidden = true;
        if (series.length < 2) {
            plot.setAttribute('aria-label', `${label}: ${emptyText}`);
            tableBody.replaceChildren();
            return;
        }
        const values = series.map((p) => p.v);
        const latest = isDaily() ? 'Latest daily mean' : 'Now';
        plot.setAttribute('aria-label',
            `${label}${isDaily() ? ', daily means,' : ''} over the last ${spanWords(span())}. ${latest} ${format(values[values.length - 1])}, `
            + `low ${format(Math.min(...values))}, high ${format(Math.max(...values))}. `
            + 'Use the left and right arrow keys to read values.');

        // A station with a shorter record than the window asked for: say where it starts.
        if (expectedSpan && span() < expectedSpan * 0.8) {
            shortNote.textContent = `Readings here only go back to ${pointTime(series[0].t, timezone, { span: expectedSpan, daily: isDaily() })}.`;
            shortNote.hidden = false;
        }

        // Rows spaced to suit the window (every 3 hours over two days … weekly over a year), newest first.
        const step = tableStep(span());
        const rows = [];
        let nextTime = Infinity;
        for (let i = series.length - 1; i >= 0; i--) {
            if (series[i].t <= nextTime) {
                rows.push(el('tr', null, el('td', null, timeOf(series[i].t)), el('td', null, format(series[i].v))));
                nextTime = series[i].t - step + 60_000;
            }
        }
        tableBody.replaceChildren(...rows);
    }

    const observer = new ResizeObserver(() => draw());
    observer.observe(plot);

    return {
        /** `expectedHours`: the window asked for, so a shorter record can be pointed out. */
        update(nextSeries, { timezone: tz, emptyText: text, expectedHours = 0 } = {}) {
            series = nextSeries ?? [];
            if (tz) timezone = tz;
            if (text) emptyText = text;
            expectedSpan = expectedHours * HOUR_MS;
            describe();
            draw();
        },
    };
}

// The fishing score from now to the end of the day after tomorrow, as one line.
//
// Same conventions as the history charts (charts.js): a 2px line with a light wash,
// hairline grid, crosshair and tooltip by pointer, touch or arrow keys, and a
// "View data" table. Added here: a fixed 0–100 scale, shaded nights so the time of
// day reads at a glance, a named label under each day, and each day's best moment
// marked with its score.

import { HOUR_MS } from '../core/util.js';
import { formatter, nearestIndex } from './charts.js';
import { el, svg } from './dom.js';

const HEIGHT = 236;
const MARGIN = { top: 30, right: 16, bottom: 28, left: 34 }; // room above the 100 line for a peak's label
const Y_TICKS = [0, 25, 50, 75, 100];

const dateTime = (t, timezone) => formatter(timezone, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(t);
const clock = (t, timezone) => formatter(timezone, { hour: 'numeric', minute: '2-digit' }).format(t);

/**
 * @param {HTMLElement} container
 * @returns {{ update(samples, options): void }}
 *   samples: [{ t, score, band: { label }, cap }] from scoreSeries()
 *   options.days:   [{ label, start, end, peak: { t, score } }]  one per calendar day, in order
 *   options.nights: [{ start, end }]  sunset to sunrise
 */
export function createOutlookChart(container) {
    let samples = [];
    let days = [];
    let nights = [];
    let timezone = 'UTC';
    let emptyText = 'The outlook will appear with the conditions.';
    let geometry = null;
    let activeIndex = null;

    const plot = el('div', { class: 'chart-plot outlook-plot', tabindex: '0', role: 'img' });
    const tooltip = el('div', { class: 'chart-tooltip', hidden: true });
    const empty = el('p', { class: 'chart-empty', hidden: true });
    const tableBody = el('tbody');
    const details = el('details', { class: 'chart-data' },
        el('summary', null, 'View data'),
        el('table', null,
            el('thead', null, el('tr', null,
                el('th', { scope: 'col' }, 'Time'), el('th', { scope: 'col' }, 'Rating'), el('th', { scope: 'col' }, 'Score'))),
            tableBody));
    container.replaceChildren(el('div', { class: 'chart-frame' }, plot, tooltip), empty, details);

    function draw() {
        const hasData = samples.length >= 2;
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
        const t0 = samples[0].t;
        const t1 = samples[samples.length - 1].t;
        const x = (t) => MARGIN.left + ((Math.min(t1, Math.max(t0, t)) - t0) / (t1 - t0)) * innerW;
        const y = (score) => MARGIN.top + (1 - score / 100) * innerH;
        const baseline = MARGIN.top + innerH;

        const root = svg('svg', { width, height: HEIGHT, viewBox: `0 0 ${width} ${HEIGHT}`, 'aria-hidden': 'true' });

        for (const night of nights) {
            if (night.end <= t0 || night.start >= t1) continue;
            root.append(svg('rect', {
                class: 'outlook-night', x: x(night.start), y: MARGIN.top, width: Math.max(0, x(night.end) - x(night.start)), height: innerH,
            }));
        }
        for (const tick of Y_TICKS) {
            root.append(
                svg('line', { class: 'chart-grid', x1: MARGIN.left, x2: MARGIN.left + innerW, y1: y(tick), y2: y(tick) }),
                svg('text', { class: 'chart-tick', x: MARGIN.left - 8, y: y(tick), 'text-anchor': 'end', 'dominant-baseline': 'middle' }, String(tick)),
            );
        }
        days.forEach((day, index) => {
            const left = x(day.start);
            const right = x(day.end);
            if (index > 0) root.append(svg('line', { class: 'chart-grid outlook-midnight', x1: left, x2: left, y1: MARGIN.top, y2: baseline }));
            if (right - left >= 40) {
                root.append(svg('text', { class: 'outlook-day-label', x: (left + right) / 2, y: HEIGHT - 8, 'text-anchor': 'middle' }, day.label));
            }
        });

        const points = samples.map((sample) => `${x(sample.t).toFixed(1)},${y(sample.score).toFixed(1)}`);
        root.append(
            svg('path', { class: 'chart-area', d: `M${MARGIN.left},${baseline}L${points.join('L')}L${MARGIN.left + innerW},${baseline}Z` }),
            svg('path', { class: 'chart-line', d: `M${points.join('L')}` }),
        );

        // Each day's best moment: a dot with its score above it. A label that would run into
        // the previous one (two peaks close together on a narrow screen) is left to the tooltip.
        let lastLabelRight = -Infinity;
        for (const day of days) {
            const px = x(day.peak.t);
            const py = y(day.peak.score);
            const anchor = px < MARGIN.left + 14 ? 'start' : px > MARGIN.left + innerW - 14 ? 'end' : 'middle';
            root.append(svg('circle', { class: 'chart-dot', cx: px, cy: py, r: 4.5 }));
            const labelLeft = anchor === 'start' ? px : anchor === 'end' ? px - 22 : px - 11;
            if (labelLeft < lastLabelRight + 4) continue;
            root.append(svg('text', { class: 'outlook-peak-label', x: px, y: py - 9, 'text-anchor': anchor }, String(day.peak.score)));
            lastLabelRight = labelLeft + 22;
        }

        const crosshair = svg('line', { class: 'chart-crosshair', y1: MARGIN.top, y2: baseline, visibility: 'hidden' });
        const hoverDot = svg('circle', { class: 'chart-dot', r: 4.5, visibility: 'hidden' });
        root.append(crosshair, hoverDot);

        plot.replaceChildren(root);
        geometry = { x, y, t0, t1, innerW, width, crosshair, hoverDot };
    }

    function showTooltip(index) {
        if (!geometry) return;
        activeIndex = index;
        const sample = samples[index];
        const px = geometry.x(sample.t);
        const py = geometry.y(sample.score);
        geometry.crosshair.setAttribute('x1', px);
        geometry.crosshair.setAttribute('x2', px);
        geometry.crosshair.setAttribute('visibility', 'visible');
        geometry.hoverDot.setAttribute('cx', px);
        geometry.hoverDot.setAttribute('cy', py);
        geometry.hoverDot.setAttribute('visibility', 'visible');

        tooltip.replaceChildren(
            el('strong', null, `${sample.score} · ${sample.band.label}`),
            el('span', null, index === 0 ? `Now, ${clock(sample.t, timezone)}` : dateTime(sample.t, timezone)),
            sample.cap ? el('span', null, sample.cap) : null,
        );
        tooltip.hidden = false;
        tooltip.style.left = `${px}px`;
        tooltip.style.top = `${Math.max(4, py - 12)}px`;
        tooltip.dataset.side = px > geometry.width * 0.6 ? 'left' : 'right';
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
        showTooltip(nearestIndex(samples, t));
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
        const lastIndex = samples.length - 1;
        const current = activeIndex ?? 0;
        const step = 3; // one hour
        const moves = { ArrowLeft: current - step, ArrowRight: current + step, Home: 0, End: lastIndex };
        if (event.key === 'Escape') hideTooltip();
        else if (event.key in moves) {
            event.preventDefault();
            showTooltip(Math.min(lastIndex, Math.max(0, moves[event.key])));
        }
    });

    function describe() {
        if (samples.length < 2) {
            plot.setAttribute('aria-label', `Fishing score outlook: ${emptyText}`);
            tableBody.replaceChildren();
            return;
        }
        const best = days.map((day) => `${day.label} ${day.peak.score} at ${clock(day.peak.t, timezone)}`).join('; ');
        plot.setAttribute('aria-label',
            `Fishing score from now to the end of ${days[days.length - 1]?.label ?? 'the period'}. Now ${samples[0].score}, ${samples[0].band.label}. `
            + `Best of each day: ${best}. Use the left and right arrow keys to read values.`);

        // One row every two hours, soonest first.
        const rows = [];
        let nextTime = -Infinity;
        for (const sample of samples) {
            if (sample.t >= nextTime) {
                rows.push(el('tr', null,
                    el('td', null, dateTime(sample.t, timezone)), el('td', null, sample.band.label), el('td', null, String(sample.score))));
                nextTime = sample.t + 2 * HOUR_MS - 60_000;
            }
        }
        tableBody.replaceChildren(...rows);
    }

    const observer = new ResizeObserver(() => draw());
    observer.observe(plot);

    return {
        update(nextSamples, { timezone: tz, days: nextDays = [], nights: nextNights = [], emptyText: text } = {}) {
            samples = nextSamples ?? [];
            days = nextDays;
            nights = nextNights;
            if (tz) timezone = tz;
            if (text) emptyText = text;
            describe();
            draw();
        },
    };
}

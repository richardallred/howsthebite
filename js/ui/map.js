// Station map (Leaflet + OpenStreetMap tiles). Leaflet is vendored and loaded
// lazily the first time the map scrolls into view, so it costs nothing at
// start-up. If it cannot load (e.g. offline before it was ever cached) the
// map hides itself; the station list next to it carries the same information.

import { el } from './dom.js';
import { DEPTH_BANDS, DEPTH_SOURCES, depthBand } from '../core/depth.js';

const LEAFLET_JS = '/vendor/leaflet/leaflet.js';
const LEAFLET_CSS = '/vendor/leaflet/leaflet.css';
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

let leafletPromise;

function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    leafletPromise ??= new Promise((resolve, reject) => {
        document.head.append(el('link', { rel: 'stylesheet', href: LEAFLET_CSS }));
        const script = el('script', { src: LEAFLET_JS });
        script.addEventListener('load', () => (window.L ? resolve(window.L) : reject(new Error('Leaflet failed to initialise'))));
        script.addEventListener('error', () => {
            leafletPromise = undefined;
            reject(new Error('Leaflet failed to load'));
        });
        document.head.append(script);
    });
    return leafletPromise;
}

export function createStationMap(container, { onSelect }) {
    let map = null;
    let markers = null;
    let data = null;
    let fittedKey = null;
    let visible = false;

    async function render() {
        if (!visible || !data) return;
        let L;
        try {
            L = await loadLeaflet();
        } catch {
            container.hidden = true;
            return;
        }
        container.hidden = false;

        if (!map) {
            map = L.map(container, { scrollWheelZoom: false, zoomSnap: 0.5 });
            map.attributionControl.setPrefix(false);
            L.tileLayer(TILE_URL, { maxZoom: 17, attribution: TILE_ATTRIBUTION }).addTo(map);
            markers = L.layerGroup().addTo(map);
            new ResizeObserver(() => map.invalidateSize()).observe(container);
        }

        const { location, stations, selectedId } = data;
        markers.clearLayers();

        L.marker([location.lat, location.lon], {
            icon: L.divIcon({ className: 'map-pin', iconSize: [18, 18], iconAnchor: [9, 9] }),
            keyboard: false,
            interactive: false,
        }).addTo(markers);

        for (const station of stations) {
            const selected = station.id === selectedId;
            const label = el('span', null,
                el('strong', null, `${station.tempF.toFixed(1)}°F`), ` · ${station.name}`);
            L.circleMarker([station.lat, station.lon], {
                radius: selected ? 10 : 7,
                className: `map-station${selected ? ' is-selected' : ''}`,
            })
                .bindTooltip(label, { direction: 'top', offset: [0, -6] })
                .on('click', () => onSelect(station.id))
                .addTo(markers);
        }

        // Re-frame only when the location or the set of stations changes, not on selection.
        const key = `${location.lat},${location.lon}|${stations.map((s) => s.id).join(',')}`;
        if (key !== fittedKey) {
            fittedKey = key;
            const points = [[location.lat, location.lon], ...stations.map((s) => [s.lat, s.lon])];
            if (points.length === 1) map.setView(points[0], 10);
            else map.fitBounds(points, { padding: [28, 28], maxZoom: 12 });
        }
    }

    new IntersectionObserver((entries, observer) => {
        if (entries.some((entry) => entry.isIntersecting)) {
            visible = true;
            observer.disconnect();
            render();
        }
    }, { rootMargin: '300px' }).observe(container.parentElement ?? container);

    return {
        update(next) {
            data = next;
            render();
        },
    };
}

/** The middle point of the longest of a contour's lines: where its depth is written. */
function labelPoint(lines) {
    const longest = lines.reduce((best, line) => (line.length > best.length ? line : best), lines[0]);
    return longest[Math.floor(longest.length / 2)];
}

// A map with depth contours on it (core/depth.js; darker and heavier with depth, styles.css
// .depth-*), each depth written on its longest line, a key in the corner and the source
// beside the map's own credit. `paint(L, layers, data, drawDepth)` draws what the map is of
// and calls drawDepth() where the contours belong in the stack; it returns what to fit the
// view to, { key, bounds, padding }, done once per key. The data's `depth` and `location`
// (a pin) are drawn here.
function createDepthMap(container, paint) {
    let map = null;
    let layers = null;
    let data = null;
    let fittedKey = null;
    let visible = false;
    let legend = null;
    let credit = null;

    function describeDepth(L, depth) {
        legend?.remove();
        legend = null;
        if (credit) map.attributionControl.removeAttribution(credit);
        credit = null;
        if (!depth) return;
        const bands = new Set(depth.contours.map((contour) => depthBand(contour.ft)));
        legend = L.control({ position: 'bottomleft' });
        legend.onAdd = () => el('div', { class: 'depth-legend' },
            el('span', { class: 'depth-legend-title' }, 'Depth, ft'),
            ...DEPTH_BANDS.filter((band) => bands.has(band.id)).map((band) => el('span', { class: `depth-key depth-band-${band.id}` },
                el('span', { class: 'depth-swatch', 'aria-hidden': 'true' }), band.label)));
        legend.addTo(map);
        // Named from the list in core/depth.js, not from the answer: this goes in as markup.
        const source = DEPTH_SOURCES.find((entry) => entry.id === depth.source);
        if (!source) return;
        credit = `Depth: <a href="${source.link}" target="_blank" rel="noopener">${source.credit}</a>, not for navigation`;
        map.attributionControl.addAttribution(credit);
    }

    function drawDepth(L, depth) {
        for (const { ft, lines } of depth?.contours ?? []) {
            L.polyline(lines, { className: `depth-line depth-band-${depthBand(ft)}`, interactive: false }).addTo(layers);
            L.marker(labelPoint(lines), {
                icon: L.divIcon({ className: 'depth-label', html: String(ft), iconSize: [26, 14], iconAnchor: [13, 7] }),
                keyboard: false,
                interactive: false,
                zIndexOffset: -1000, // under anything else marked on the map
            }).addTo(layers);
        }
    }

    async function render() {
        if (!visible || !data) return;
        let L;
        try {
            L = await loadLeaflet();
        } catch {
            container.hidden = true;
            return;
        }
        container.hidden = false;

        if (!map) {
            map = L.map(container, { scrollWheelZoom: false, zoomSnap: 0.5 });
            map.attributionControl.setPrefix(false);
            L.tileLayer(TILE_URL, { maxZoom: 17, attribution: TILE_ATTRIBUTION }).addTo(map);
            layers = L.layerGroup().addTo(map);
            new ResizeObserver(() => map.invalidateSize()).observe(container);
        }

        const { location, depth } = data;
        layers.clearLayers();
        const fit = paint(L, layers, data, () => drawDepth(L, depth));
        describeDepth(L, depth);
        if (location) {
            L.marker([location.lat, location.lon], {
                icon: L.divIcon({ className: 'map-pin', iconSize: [14, 14], iconAnchor: [7, 7] }),
                keyboard: false,
                interactive: false,
            }).addTo(layers);
        }

        if (fit.key !== fittedKey) {
            fittedKey = fit.key;
            map.fitBounds(fit.bounds, { padding: [fit.padding, fit.padding] });
        }
    }

    new IntersectionObserver((entries, observer) => {
        if (entries.some((entry) => entry.isIntersecting)) {
            visible = true;
            observer.disconnect();
            render();
        }
    }, { rootMargin: '300px' }).observe(container.parentElement ?? container);

    return {
        update(next) {
            data = next;
            render();
        },
    };
}

// The lake map behind "Where to look": the outline, the depth contours where a survey has
// them, and the stretches of shore to fish, each coloured by kind (.zone-*) and numbered to
// match the list beside it. update({ lake, zones, location, depth }).
export function createLakeMap(container) {
    return createDepthMap(container, (L, layers, { lake, zones }, drawDepth) => {
        const outline = L.polygon(lake.rings.map((ring) => ring.coords), {
            className: 'lake-outline', interactive: false,
        }).addTo(layers);
        drawDepth(); // under the zones, so the stretches to fish stay on top
        zones.forEach((zone, index) => {
            L.polyline(zone.line, { className: `lake-zone zone-${zone.kind}`, interactive: false }).addTo(layers);
            L.marker(zone.at, {
                icon: L.divIcon({ className: `zone-tag zone-${zone.kind}`, html: String(index + 1), iconSize: [24, 24], iconAnchor: [12, 12] }),
                keyboard: false,
                title: zone.title,
            }).addTo(layers);
        });
        return { key: lake.id, bounds: outline.getBounds(), padding: 16 };
    });
}

// The depth chart for salt water: NOAA's contours in the box of water around the place
// (chartBox in core/depth.js). update({ box, location, depth }), box as [west, south, east, north].
export function createChartMap(container) {
    return createDepthMap(container, (L, layers, { box }, drawDepth) => {
        drawDepth();
        return { key: box.join(','), bounds: [[box[1], box[0]], [box[3], box[2]]], padding: 0 };
    });
}

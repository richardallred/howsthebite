// Station map (Leaflet + OpenStreetMap tiles). Leaflet is vendored and loaded
// lazily the first time the map scrolls into view, so it costs nothing at
// start-up. If it cannot load (e.g. offline before it was ever cached) the
// map hides itself; the station list next to it carries the same information.

import { el } from './dom.js';

const LEAFLET_JS = 'vendor/leaflet/leaflet.js';
const LEAFLET_CSS = 'vendor/leaflet/leaflet.css';
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

// Service worker: makes the app shell available offline.
//
// - App files (same origin) are fetched network-first, so a deploy shows up on
//   the next load without any cache-busting, with the cache as offline fallback.
// - API calls are NOT cached here. The page keeps its own snapshot of the last
//   good data (with its real timestamp) and shows that when offline; serving a
//   stale API response from here would make old data look fresh.
//
// The build (scripts/build.mjs) replaces CACHE with a name derived from the published
// files, so every release that changes anything is seen as a new version. The value
// here is only used when the source tree is served directly (npm start, the tests).

const CACHE = 'htb-shell-v8';

const SHELL = [
    './',
    'index.html',
    'styles.css',
    'fonts/archivo-variable.woff2',
    'fonts/instrument-sans-latin-400-normal.woff2',
    'fonts/instrument-sans-latin-500-normal.woff2',
    'fonts/instrument-sans-latin-600-normal.woff2',
    'fonts/ibm-plex-mono-latin-400-normal.woff2',
    'fonts/ibm-plex-mono-latin-500-normal.woff2',
    'manifest.json',
    'favicon.svg',
    'icons/icon-192x192.png',
    'icons/icon-512x512.png',
    'js/app.js',
    'js/theme-init.js',
    'js/config.js',
    'js/storage.js',
    'data/coops-stations.json',
    'js/api/coast-api.js',
    'js/api/http.js',
    'js/api/species-api.js',
    'js/api/usgs-api.js',
    'js/api/weather-api.js',
    'js/core/alerts.js',
    'js/core/lures.js',
    'js/core/moon.js',
    'js/core/scoring.js',
    'js/core/sky.js',
    'js/core/species.js',
    'js/core/sun.js',
    'js/core/tides.js',
    'js/core/trend.js',
    'js/core/util.js',
    'js/ui/charts.js',
    'js/ui/dom.js',
    'js/ui/map.js',
    'js/ui/outlook-chart.js',
    'js/ui/theme.js',
    'js/ui/tips.js',
    'vendor/leaflet/leaflet.css',
    'vendor/leaflet/leaflet.js',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE)
            .then((cache) => cache.addAll(SHELL))
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
            .then(() => self.clients.claim()),
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return; // APIs and map tiles go straight to the network
    if (/\/api\/(usgs\/|sst$)/.test(url.pathname)) return; // so do the same-origin data proxies: never cache live data here

    event.respondWith((async () => {
        const cache = await caches.open(CACHE);
        try {
            const response = await fetch(request);
            if (response.ok) cache.put(request, response.clone());
            return response;
        } catch (error) {
            const cached = await cache.match(request, { ignoreSearch: true });
            if (cached) return cached;
            if (request.mode === 'navigate') {
                const shell = await cache.match('index.html');
                if (shell) return shell;
            }
            throw error;
        }
    })());
});

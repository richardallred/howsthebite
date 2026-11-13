// Service worker: makes the app shell available offline.
//
// - App files (same origin) are fetched network-first, so a deploy shows up on
//   the next load without any cache-busting, with the cache as offline fallback.
// - API calls are NOT cached here. The page keeps its own snapshot of the last
//   good data (with its real timestamp) and shows that when offline; serving a
//   stale API response from here would make old data look fresh.
//
// Bump CACHE when the list of shell files changes.

const CACHE = 'htb-shell-v6';

const SHELL = [
    './',
    'index.html',
    'styles.css',
    'manifest.json',
    'favicon.svg',
    'icons/icon-192x192.png',
    'icons/icon-512x512.png',
    'js/app.js',
    'js/theme-init.js',
    'js/config.js',
    'js/storage.js',
    'js/api/http.js',
    'js/api/species-api.js',
    'js/api/usgs-api.js',
    'js/api/weather-api.js',
    'js/core/alerts.js',
    'js/core/moon.js',
    'js/core/scoring.js',
    'js/core/sky.js',
    'js/core/species.js',
    'js/core/sun.js',
    'js/core/trend.js',
    'js/core/util.js',
    'js/ui/charts.js',
    'js/ui/dom.js',
    'js/ui/map.js',
    'js/ui/theme.js',
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
    if (url.pathname.includes('/api/usgs/')) return; // so does the same-origin USGS proxy: never cache live data here

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

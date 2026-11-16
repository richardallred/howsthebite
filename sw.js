// Service worker: makes the app shell available offline.
//
// - Pages and other app files (same origin) are fetched network-first, so a deploy shows
//   up on the next load, with the cache as offline fallback.
// - Files the build has named after their content (scripts/fingerprint.mjs: scripts,
//   styles, fonts, data) are served from the cache without asking the network: such a
//   name never has other content. It also means a page that was opened before a deploy
//   can still load the files it was written for.
// - Place pages (/fishing/…) are the shell with the place's name in the title and meta
//   tags. They are not cached one by one; offline, any of them gets the cached shell,
//   which reads the place from the address.
// - API calls are NOT cached here. The page keeps its own snapshot of the last
//   good data (with its real timestamp) and shows that when offline; serving a
//   stale API response from here would make old data look fresh.
//
// The build (scripts/build.mjs) replaces CACHE with a name derived from the published
// files, so every release that changes anything is seen as a new version, and rewrites
// the names in SHELL to the fingerprinted ones. As written here, the file is what runs
// when the source tree is served directly (npm start, the tests).

const CACHE = 'htb-shell-v11';

// "name.<10 hex digits>.ext": a name the build derived from the content. No file in the
// source tree matches, so served unbuilt everything is fetched network-first.
const FINGERPRINTED = /\.[0-9a-f]{10}\.[a-z0-9]+$/;

const SHELL = [
    './',
    'index.html',
    'styles.css',
    'fonts/young-serif-latin-400-normal.woff2',
    'fonts/atkinson-hyperlegible-next-latin-wght-normal.woff2',
    'manifest.json',
    'favicon.svg',
    'drawings/fish/bass.svg',
    'drawings/fish/catfish.svg',
    'drawings/fish/walleye.svg',
    'drawings/fish/trout.svg',
    'drawings/fish/crappie.svg',
    'drawings/fish/pike.svg',
    'drawings/fish/redfish.svg',
    'drawings/fish/seatrout.svg',
    'drawings/fish/striper.svg',
    'drawings/fish/flounder.svg',
    'icons/icon-192x192.png',
    'icons/icon-512x512.png',
    'js/app.js',
    'js/theme-init.js',
    'js/config.js',
    'js/storage.js',
    'data/coops-stations.json',
    'js/api/coast-api.js',
    'js/api/http.js',
    'js/api/nws.js',
    'js/api/species-api.js',
    'js/api/usgs-api.js',
    'js/api/weather-api.js',
    'js/core/alerts.js',
    'js/core/listed-places.js',
    'js/core/lures.js',
    'js/core/moon.js',
    'js/core/place-url.js',
    'js/core/scoring.js',
    'js/core/season.js',
    'js/core/sky.js',
    'js/core/species.js',
    'js/core/sun.js',
    'js/core/tides.js',
    'js/core/trend.js',
    'js/core/util.js',
    'js/core/water-trend.js',
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
    if (/\/api\/(usgs\/|nws\/|sst$)/.test(url.pathname)) return; // so do the same-origin data proxies: never cache live data here

    event.respondWith((async () => {
        const cache = await caches.open(CACHE);
        if (FINGERPRINTED.test(url.pathname)) {
            const held = await cache.match(request);
            if (held) return held;
        }
        try {
            const response = await fetch(request);
            if (response.ok && !url.pathname.startsWith('/fishing/')) cache.put(request, response.clone());
            return response;
        } catch (error) {
            const cached = await cache.match(request, { ignoreSearch: true });
            if (cached) return cached;
            if (request.mode === 'navigate') {
                // The scope root first: Cloudflare Pages answers 'index.html' with a redirect to '/',
                // and a redirected response cannot answer a navigation (the page fails to load).
                const shell = (await cache.match('./')) ?? (await cache.match('index.html'));
                if (shell) return shell;
            }
            throw error;
        }
    })());
});

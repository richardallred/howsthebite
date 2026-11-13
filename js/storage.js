// localStorage wrapper. Every read and write is guarded: storage can be full,
// disabled (private windows) or hold junk from an older version of the app.

import { APP } from './config.js';
import { isNum, roundCoord } from './core/util.js';

const PREFIX = 'htb:';

function read(key, fallback = null) {
    try {
        const raw = localStorage.getItem(PREFIX + key);
        return raw === null ? fallback : JSON.parse(raw);
    } catch {
        return fallback;
    }
}

function write(key, value) {
    try {
        if (value === null || value === undefined) localStorage.removeItem(PREFIX + key);
        else localStorage.setItem(PREFIX + key, JSON.stringify(value));
        return true;
    } catch {
        return false;
    }
}

const validLocation = (loc) => loc && isNum(loc.lat) && isNum(loc.lon) && Math.abs(loc.lat) <= 90 && Math.abs(loc.lon) <= 180;

const cleanLocation = (loc) => ({
    lat: roundCoord(loc.lat),
    lon: roundCoord(loc.lon),
    name: String(loc.name || 'Saved location').slice(0, 80),
    ...(loc.kind === 'lake' || loc.kind === 'river' ? { kind: loc.kind } : {}),
});

export const locationKey = (loc) => `${loc.lat.toFixed(2)},${loc.lon.toFixed(2)}`;

/** Carry the saved location, recents and theme over from the pre-2.0 storage keys (once). */
function migrateLegacyKeys() {
    if (read('migrated')) return;
    const legacy = (key) => {
        try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
    };
    const location = legacy('currentLocation');
    if (validLocation(location) && !read('location')) write('location', cleanLocation(location));

    const recents = legacy('recentLocations');
    if (Array.isArray(recents) && !read('recents')) {
        write('recents', recents.filter(validLocation).map(cleanLocation).slice(0, APP.RECENT_LOCATIONS_MAX));
    }

    const theme = legacy('themePreference');
    if ((theme === 'light' || theme === 'dark') && !read('theme')) write('theme', theme);

    for (const key of ['currentLocation', 'recentLocations', 'themePreference', 'pressureHistory',
        'temperatureHistory', 'waterTemperatureHistory', 'installBannerDismissed', 'selectedState', 'selectedWaterType']) {
        try { localStorage.removeItem(key); } catch { /* ignore */ }
    }
    write('migrated', 1);
}
migrateLegacyKeys();

export const storage = {
    getLocation() {
        const loc = read('location');
        return validLocation(loc) ? cleanLocation(loc) : null;
    },
    setLocation(loc) {
        write('location', cleanLocation(loc));
    },

    getRecents() {
        const list = read('recents', []);
        return Array.isArray(list) ? list.filter(validLocation).map(cleanLocation) : [];
    },
    addRecent(loc) {
        const entry = cleanLocation(loc);
        const others = this.getRecents().filter((item) => locationKey(item) !== locationKey(entry) && item.name !== entry.name);
        write('recents', [entry, ...others].slice(0, APP.RECENT_LOCATIONS_MAX));
    },
    removeRecent(loc) {
        write('recents', this.getRecents().filter((item) => locationKey(item) !== locationKey(loc)));
    },

    getTheme() {
        const theme = read('theme');
        return theme === 'light' || theme === 'dark' ? theme : null;
    },
    setTheme(theme) {
        write('theme', theme);
    },

    getWaterFilter() {
        const filter = read('waterFilter');
        return filter === 'lake' || filter === 'river' ? filter : 'all';
    },
    setWaterFilter(filter) {
        write('waterFilter', filter);
    },

    /** The station the user picked by hand for a location, if any. */
    getPreferredStation(loc) {
        return read('stations', {})?.[locationKey(loc)] ?? null;
    },
    setPreferredStation(loc, stationId) {
        const all = read('stations', {}) ?? {};
        const key = locationKey(loc);
        delete all[key];
        if (stationId) all[key] = stationId;
        // Keep the map small: newest 30 preferences.
        write('stations', Object.fromEntries(Object.entries(all).slice(-30)));
    },

    /** Last successfully loaded data, for instant start-up and offline use. */
    getSnapshot(loc) {
        const snapshot = read('snapshot');
        if (!snapshot?.weather?.current || !validLocation(snapshot.location)) return null;
        if (loc && locationKey(snapshot.location) !== locationKey(loc)) return null;
        if (Date.now() - snapshot.weather.fetchedAt > APP.SNAPSHOT_MAX_AGE_MS) return null;
        return snapshot;
    },
    setSnapshot(snapshot) {
        write('snapshot', snapshot);
    },

    getInstallPrompt() {
        const state = read('install', {});
        return { dismissals: Number(state?.dismissals) || 0, lastDismissed: Number(state?.lastDismissed) || 0 };
    },
    setInstallPrompt(state) {
        write('install', state);
    },
};

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

    /** Which fish the score is tuned for: 'any', 'warm', 'cool' or 'cold' (see SPECIES_GROUPS in scoring.js). */
    getSpeciesGroup() {
        const group = read('species');
        return ['warm', 'cool', 'cold'].includes(group) ? group : 'any';
    },
    setSpeciesGroup(group) {
        write('species', group);
    },

    /**
     * Species records for a region (see species-api.js). Ranges change over years, not
     * days, so an answer is kept for a month and reused offline. ("2": answers now include
     * salt-water fish; older saved answers are simply not looked at.)
     */
    getSpeciesCounts(regionKey) {
        const entry = read('speciesRegions2', {})?.[regionKey];
        if (!entry?.counts || Date.now() - entry.savedAt > 30 * 24 * 60 * 60 * 1000) return null;
        return entry.counts;
    },
    setSpeciesCounts(regionKey, counts) {
        const all = read('speciesRegions2', {}) ?? {};
        delete all[regionKey];
        all[regionKey] = { counts, savedAt: Date.now() };
        write('speciesRegions2', Object.fromEntries(Object.entries(all).slice(-12))); // newest dozen regions
    },

    /** The kind of fishing last chosen: 'fresh', 'inshore' or 'surf'. Used wherever that kind is possible. */
    getMode() {
        const mode = read('mode');
        return mode === 'inshore' || mode === 'surf' ? mode : 'fresh';
    },
    setMode(mode) {
        write('mode', mode);
    },

    /** The salt-water fish last chosen (a group id from SALT_GROUP_IDS in species.js), or null. */
    getSaltGroup() {
        const group = read('saltSpecies');
        return typeof group === 'string' ? group : null;
    },
    setSaltGroup(group) {
        write('saltSpecies', group);
    },

    /**
     * What is already known about a coastal location and is slow to find out again:
     * { surf: boolean, gridUrl: string|null } (whether it is an ocean beach, and the
     * forecast cell that holds its waves).
     */
    getCoastHint(loc) {
        return read('coast', {})?.[locationKey(loc)] ?? null;
    },
    setCoastHint(loc, hint) {
        const all = read('coast', {}) ?? {};
        const key = locationKey(loc);
        delete all[key];
        all[key] = hint;
        write('coast', Object.fromEntries(Object.entries(all).slice(-30)));
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

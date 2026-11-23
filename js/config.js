// Endpoints and tunables. No API keys are required for any of these services.
// Same-origin paths start with "/": the page is also served at place addresses (/fishing/…).

export const API = {
    // US National Weather Service: observations, forecast, place names (public domain).
    NWS: 'https://api.weather.gov',
    // Same-origin stand-in for it (functions/api/nws/[[path]].js), used only when a direct
    // request cannot connect: see js/api/nws.js.
    NWS_PROXY: '/api/nws',
    // Photon (OpenStreetMap data, hosted by komoot): town, lake and river search.
    PHOTON: 'https://photon.komoot.io/api/',
    // USGS Water Data OGC API (replaces waterservices.usgs.gov, which USGS is retiring).
    USGS: 'https://api.waterdata.usgs.gov/ogcapi/v1/collections',
    // NOAA CO-OPS: tide predictions and coastal water temperature.
    COOPS: 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter',
    // NWS surf-zone forecast by beach (surf height, rip-current risk), an ArcGIS feature service.
    NWS_BEACH: 'https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/marine_beachforecast_summary/FeatureServer/0/query',
    // Same-origin proxy for satellite sea-surface temperature (functions/api/sst.js); optional.
    SST_PROXY: '/api/sst',
    // GBIF occurrence search: which sport fish have been recorded around a place.
    GBIF: 'https://api.gbif.org/v1/occurrence/search',
    // USGS Statistics API: what a gauge normally reads on each day of the year.
    USGS_STATS: 'https://api.waterdata.usgs.gov/statistics/v0',
    // Same-origin caching proxy for the USGS API (functions/api/usgs/[[path]].js on
    // Cloudflare Pages). It keeps the API key on the server and lets nearby visitors
    // share cached answers. Where the proxy is not deployed (plain static hosting,
    // local `npm start`) the app notices and talks to USGS directly instead.
    USGS_PROXY: '/api/usgs',
    // Same-origin caching proxy for lake outlines from OpenStreetMap (functions/api/lake.js).
    // Where it is not deployed the app asks the Overpass API directly (js/api/lake-api.js).
    LAKE_PROXY: '/api/lake',
    // Same-origin caching proxy for depth contours from state and federal map services
    // (functions/api/depth.js). Where it is not deployed the app asks them directly (js/api/depth-api.js).
    DEPTH_PROXY: '/api/depth',
};

export const APP = {
    DEFAULT_LOCATION: { lat: 41.8781, lon: -87.6298, name: 'Chicago, Illinois' },

    // Only used when the app talks to USGS directly (no proxy), and best left empty on a
    // public site: anything here ships to every browser, so all visitors would share one
    // key's quota. Without a key USGS allows 1,000 requests per hour per visitor IP.
    // On Cloudflare Pages the key belongs in the proxy's USGS_API_KEY secret instead.
    USGS_API_KEY: '',

    // Amazon Associates tracking ID. It tags the lure suggestions' Amazon links and switches on
    // the disclosure Amazon requires. It is public by nature (it appears in every link). Leave it
    // empty ('') to make the links ordinary, untagged searches with no disclosure.
    AMAZON_ASSOCIATE_TAG: 'howsthebite-20',

    REQUEST_TIMEOUT_MS: 15000,
    SEARCH_DEBOUNCE_MS: 300,
    SEARCH_MIN_CHARS: 2,
    RECENT_LOCATIONS_MAX: 6,

    // Water temperature stations
    STATION_RADIUS_MI: 60,
    STATION_LIST_MAX: 12,
    STATION_MAX_READING_AGE_H: 24,

    // History / trends
    HISTORY_HOURS: 48,
    WATER_TREND_DAYS: 30, // daily water temperatures behind the seasonal lure picks
    PRESSURE_TREND_HOURS: 3,
    TEMP_TREND_HOURS: 24,
    FORECAST_DAYS: 5,

    // Refresh
    STALE_AFTER_MS: 15 * 60 * 1000,
    SNAPSHOT_MAX_AGE_MS: 12 * 60 * 60 * 1000,

    // Install banner: back off for a week after a dismissal, give up after four.
    INSTALL_PROMPT_COOLDOWN_MS: 7 * 24 * 60 * 60 * 1000,
    INSTALL_PROMPT_MAX_DISMISSALS: 4,
};

// Lower bound of each overall rating band.
export const SCORE_BANDS = [
    { min: 85, key: 'exceptional', label: 'Exceptional' },
    { min: 70, key: 'excellent', label: 'Excellent' },
    { min: 55, key: 'good', label: 'Good' },
    { min: 40, key: 'fair', label: 'Fair' },
    { min: 25, key: 'poor', label: 'Poor' },
    { min: 10, key: 'verypoor', label: 'Very poor' },
    { min: 0, key: 'terrible', label: 'Terrible' },
];

// One plain sentence under the score, in the voice of a fishing report: no hype. Several per
// band so it is not the same words every day; bitePhrase() picks one, stable for the day.
export const BITE_PHRASES = {
    exceptional: [
        'About as good as it gets',
        'Hard to pick a better time to go',
        'Everything is lining up',
        'Conditions don’t get much better than this',
    ],
    excellent: [
        'Fish should be feeding',
        'A very good time to be on the water',
        'Most things are in your favor',
        'Worth making time for',
    ],
    good: [
        'Worth getting out',
        'Decent conditions for fishing',
        'Fish should be catchable',
        'Good odds if you put in the time',
    ],
    fair: [
        'Could go either way',
        'Expect to work for your bites',
        'Fishable, but nothing special',
        'Slow stretches are likely',
    ],
    poor: [
        'Expect a slow day',
        'Fish will be hard to find',
        'Tough conditions right now',
        'Bites will be few and far between',
    ],
    verypoor: [
        'Very slow conditions',
        'Probably not worth a special trip',
        'Little is going your way right now',
        'Fish are unlikely to cooperate',
    ],
    terrible: [
        'Not a day for fishing',
        'Save it for another day',
        'About as bad as conditions get',
        'Better to stay off the water',
    ],
};

export const US_STATES = {
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
    CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
    HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
    KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
    MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
    NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
    NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
    OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
    SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
    WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

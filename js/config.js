// Endpoints and tunables. No API keys are required for any of these services.

export const API = {
    // US National Weather Service: observations, forecast, place names (public domain).
    NWS: 'https://api.weather.gov',
    // Photon (OpenStreetMap data, hosted by komoot): town, lake and river search.
    PHOTON: 'https://photon.komoot.io/api/',
    // USGS Water Data OGC API (replaces waterservices.usgs.gov, which USGS is retiring).
    USGS: 'https://api.waterdata.usgs.gov/ogcapi/v1/collections',
    // NOAA CO-OPS: tide predictions and coastal water temperature.
    COOPS: 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter',
    // NWS surf-zone forecast by beach (surf height, rip-current risk), an ArcGIS feature service.
    NWS_BEACH: 'https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/marine_beachforecast_summary/FeatureServer/0/query',
    // Same-origin proxy for satellite sea-surface temperature (functions/api/sst.js); optional.
    SST_PROXY: 'api/sst',
    // GBIF occurrence search: which sport fish have been recorded around a place.
    GBIF: 'https://api.gbif.org/v1/occurrence/search',
    // USGS Statistics API: what a gauge normally reads on each day of the year.
    USGS_STATS: 'https://api.waterdata.usgs.gov/statistics/v0',
    // Same-origin caching proxy for the USGS API (functions/api/usgs/[[path]].js on
    // Cloudflare Pages). It keeps the API key on the server and lets nearby visitors
    // share cached answers. Where the proxy is not deployed (plain static hosting,
    // local `npm start`) the app notices and talks to USGS directly instead.
    USGS_PROXY: 'api/usgs',
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
    OUTLOOK_HOURS: 36,

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

export const BITE_PHRASES = {
    exceptional: [
        'absolutely legendary', 'insanely hot', 'completely bonkers', 'off the charts',
        'absolutely electric', 'totally insane', 'completely mental', 'absolutely wicked',
        'ridiculously hot', 'completely nuts', 'absolutely bananas', 'totally lit',
    ],
    excellent: [
        'absolutely stellar', 'incredibly hot', 'super active', 'really cooking',
        'totally dialed in', 'completely locked in', 'absolutely crushing', 'really cranking',
        'super charged', 'totally fired up', 'absolutely pumping', 'really rolling',
    ],
    good: [
        'pretty solid', 'fairly active', 'quite decent', 'reasonably good',
        'looking promising', 'holding steady', 'pretty consistent', 'fairly reliable',
        'quite encouraging', 'reasonably active', 'pretty hopeful', 'fairly positive',
    ],
    fair: [
        'somewhat mixed', 'kinda spotty', 'pretty hit or miss', 'a bit unpredictable',
        'sorta iffy', 'somewhat inconsistent', 'kinda up and down', 'a bit scattered',
        'pretty variable', 'somewhat temperamental', 'kinda moody', 'a bit finicky',
    ],
    poor: [
        'pretty slow', 'quite tough', 'rather challenging', 'pretty sluggish',
        'quite difficult', 'pretty stubborn', 'rather uncooperative', 'quite picky',
        'pretty finicky', 'rather selective', 'quite hesitant', 'pretty reluctant',
    ],
    verypoor: [
        'really tough', 'extremely challenging', 'pretty brutal', 'quite miserable',
        'really stubborn', 'extremely difficult', 'pretty unforgiving', 'quite punishing',
        'really harsh', 'extremely tough', 'pretty merciless', 'quite ruthless',
    ],
    terrible: [
        'absolutely brutal', 'completely dead', 'totally lifeless', 'utterly hopeless',
        'completely shut down', 'absolutely terrible', 'totally awful', 'completely dreadful',
        'absolutely miserable', 'totally dismal', 'completely pathetic', 'utterly depressing',
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

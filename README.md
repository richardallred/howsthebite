# 🎣 How's the Bite?

A Progressive Web App that answers one question for anglers: **how good is the fishing right now?**
Pick any US town, lake or river and get a 0–100 score built from real water temperature at the
nearest USGS sensor, the time of day, live weather, river flow compared with normal, and the moon,
plus the current river level, flow or lake elevation. The weights follow what studies of angler
catch rates have actually measured (see [How the score works](#how-the-score-works)).

No framework and nothing to compile: plain HTML, CSS and ES modules. The app itself needs
**no API keys**.

![Desktop screenshot](screenshots/desktop.png)

## Features

- **Fishing score (0–100)** with a per-factor breakdown that shows exactly where the points came from,
  tuned to what you are fishing for: all species, bass and panfish, walleye and pike, or trout
- **Only the fish that live there are offered**: the choices come from occurrence records for the
  region, so there is no walleye option in south Florida and no bass option in Alaska
- **Best times** for the next day and a half, from sunrise/sunset and the forecast
- **Weather alerts** from the National Weather Service; thunderstorm and other dangerous-weather
  warnings cap the score while they are in effect
- **Live water temperature** from nearby USGS monitoring stations; pick a different station from the
  list or the map, or filter to lakes or rivers. When no sensor is nearby the app falls back to a
  clearly labelled estimate
- **Water level and flow** from the nearest USGS gauge: river gage height and discharge (with the
  median for today's date), or lake and reservoir surface elevation, with the 24-hour change, and
  dissolved oxygen and turbidity where the station measures them
- **Current conditions** observed at the nearest weather station: air temperature, pressure with
  its 3-hour trend, wind and gusts, sky
- **5-day forecast** with highs/lows, precipitation chance and wind
- **48-hour charts** for pressure, air temperature, water temperature and water level, with
  hover/touch/keyboard read-outs and a data table for each
- **Place search** for towns ("Asheville, NC") and for lakes, reservoirs and rivers by name
  ("Lake Norman", "French Broad River"), recent places, and optional "use my location"
- **Installable and offline-capable**: the app shell is cached by a service worker and the last
  loaded conditions are shown (with their real timestamp) when you have no signal
- Light and dark themes, responsive from phone to desktop, keyboard and screen-reader friendly

## Run it locally

```bash
npm install
npm start           # plain static server at http://localhost:8000
```

Any static server works (`python3 -m http.server 8000`, VS Code Live Server, …). The page has to be
served over `http://localhost` or HTTPS; opening `index.html` from disk will not work because
browsers block ES modules and service workers on `file://`.

To run it the way it runs in production, with the security headers and the USGS proxy:

```bash
npm run preview     # builds dist/ and serves it with Cloudflare's local runtime at http://localhost:8788
```

The proxy reads its USGS key from a git-ignored `.dev.vars` file in the project root:

```
USGS_API_KEY=your-key-here
```

Without that file the preview still works; the proxy just calls USGS anonymously.

## Tests

```bash
npm test            # unit tests: scoring, regional species, sun and moon, alerts, trends, sky, helpers, the USGS proxy
npm run test:e2e    # browser tests (Playwright): the whole app, desktop and phone layouts
npm run test:all    # both
```

The browser tests need a browser once: `npx playwright install chromium`, or reuse one you already
have with `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e`.

They never call the real services. Every external request is answered from fixtures in
`e2e/support/api-mocks.js` and the clock is pinned, so runs are repeatable, fast (about 15 seconds)
and spend none of the USGS rate limit. A test fails if the page makes a request that has no mock,
throws an uncaught error, or violates the Content-Security-Policy.

To run the same tests against the production-style preview (this is what checks the policy in
`_headers`): start `npm run preview`, then `E2E_BASE_URL=http://localhost:8788 npm run test:e2e`.

## Deploying to Cloudflare Pages

The site is static files plus one small server function, which fits Cloudflare Pages' free plan.
`wrangler.toml` holds the configuration, `npm run build` assembles `dist/`, and anything under
`functions/` is deployed as a Pages Function automatically.

One-time setup:

1. **Log in**: `npx wrangler login` (opens a browser).
2. **Create the project and publish**: `npm run deploy`. The first run offers to create a Pages
   project named `howsthebite` (change `name` in `wrangler.toml` if you prefer another); accept the
   default production branch. You get a `https://<project>.pages.dev` address.
3. **Give the proxy its key**: `npx wrangler pages secret put USGS_API_KEY`, paste the key
   (free at <https://api.waterdata.usgs.gov/signup>), then run `npm run deploy` once more so the
   function picks it up.
4. **Custom domain** (optional): Cloudflare dashboard → Workers & Pages → your project → Custom
   domains → add the domain. If the domain is registered or hosted at Cloudflare the DNS record is
   created for you.

After that, `npm run deploy` publishes a new version.

**Deploy on every push instead** (optional): in the Cloudflare dashboard choose Workers & Pages →
Create → Pages → Connect to Git, pick the repository, and set *Build command* `npm run build` and
*Build output directory* `dist`. Add `USGS_API_KEY` under Settings → Variables and Secrets. Each
push to the production branch then deploys, and other branches get preview URLs.

Checking a deployment:

```bash
curl -sI https://<your-site>/ | grep -i content-security-policy          # headers are applied
curl -s -o /dev/null -D - "https://<your-site>/api/usgs/monitoring-locations/items?id=USGS-05536137" | grep -i x-cache
```

The second command should print `x-cache: miss` the first time and `x-cache: hit` when repeated.

Other static hosts (GitHub Pages, Netlify, S3, …) work too: publish `dist/`. Without the Pages
Function there is no proxy, which the app detects on its first request, and it then talks to USGS
directly. `_headers` is a Cloudflare/Netlify convention; elsewhere set the same headers in that
host's own way.

When you add, rename or remove a file the page loads, update `SHELL` and bump `CACHE` in `sw.js`.
The build fails if `SHELL` lists a file that is not published, and a browser test fails if the
page loads a file that `SHELL` does not list.

### The USGS proxy

`functions/api/usgs/[[path]].js` answers `GET /api/usgs/<collection>/items` and
`GET /api/usgs/statistics/observationNormals` by calling USGS:

- **The key stays on the server.** Browsers never see it. Without the proxy every visitor has their
  own anonymous allowance (1,000 requests per hour per IP), which is fine for one person but not
  when many visitors share an address, and a key shipped in the page would be public.
- **Answers are cached at Cloudflare's edge**: readings for 10 minutes, station names and
  day-of-year flow statistics for a day.
  The app snaps its search area to a 0.1° grid (about 7 miles), so people near each other ask
  the identical question and share one upstream request.
- **Outages are absorbed.** If USGS rate-limits or fails, the last good answer (up to six hours
  old) is served instead. Each reading carries its own timestamp, which the app shows.
- **It is not an open proxy.** Only the three collections, the one statistics endpoint and the
  query parameters the app uses are forwarded, only for GET, and the result limit is capped.

The `x-cache` response header reports `hit`, `miss` or `stale`.

## How the score works

The score rates **conditions**, not your odds. Wherever catch rates have been measured, the
angler's skill, the bait and how many fish are in the water outweighed every environmental factor,
so treat the number as "is this a good time to be out", not a prediction.

The logic lives in `js/core/scoring.js` and is covered by `tests/scoring.test.js`.

| Factor | Points | Best | How it is scored |
|---|---|---|---|
| Water temperature | 35 | Depends on the species setting | A smooth curve per species group: bass and panfish peak at 69–80°F, walleye and pike at 62–72°F, trout at 50–64°F, "all species" at 62–76°F. Trout lose most of their points by 70°F and all of them by 75°F. An estimate (no sensor nearby) is pulled toward the middle. Dissolved oxygen below about 5 mg/L (6 for trout) cuts the factor further where a station measures it. |
| Light | 30 | The hour either side of sunset | From the sun's height, computed for the spot: evening low light 100%, early morning 75%, overcast day 68%, broken cloud 55%, bright sun 45%, night 35%, blended smoothly between. |
| Wind | 12 | 5–12 mph | Calm still earns 75%. Points fall away above 15 mph and reach zero at 30. Gusts count (a gust is treated as 70% of a steady wind). |
| River flow | 10 | Normal for the date | Current discharge against that gauge's own record for today's date (USGS day-of-year percentiles, at least 10 years). Normal flow scores full marks, low water a little less, very high water almost nothing. Left out for lakes and for gauges without a long record. |
| Moon | 8 | New or full moon, overhead or underfoot | 35% always, up to 30% more near new/full moon, and 35% more within about an hour of the moon crossing overhead or underfoot. |
| Barometric pressure | 5 | Steady or slowly falling | Trend only: slowly falling 5, steady or falling fast 4, rising 3, rising fast 1. The level itself earns nothing. |

**Species on offer.** The species setting only lists fish recorded around the place you are
looking at (`js/core/species.js`). The app asks [GBIF](https://www.gbif.org/) how many openly
licensed records of 19 sport fish exist since 1990 in a box about 140 miles across:

- Walleye, pike and their cool-water relatives, and trout and salmon, are each offered when they
  have at least 5 records that are 3% of the region's total, or 25 outright. A few strays do not
  make a fishery.
- The button is named for what is actually there: "Walleye & pike" in Minnesota, "Smallmouth"
  around Dallas, "Perch" near Savannah, "Pike" and "Trout & salmon" in Alaska.
- Bass and panfish are offered everywhere except Alaska, without consulting the counts: they live
  in every other state, including thinly surveyed country with few records.
- Where a single group lives (Florida, the Gulf coast), there is no choice to make and the score
  says which fish it used.
- Your saved preference is kept: where those fish are not recorded the score uses "All species"
  and says so, and the preference applies again wherever they do live.
- With fewer than 20 records in all, or if the lookup fails, the app assumes by latitude instead:
  bass only south of 31°N, the Alaskan mix in Alaska, everything in between.

An answer is remembered in the browser for a month per region, so GBIF is asked about once.
Occurrence records show where fish have been recorded, not how good the fishing is, and stocked
winter trout (Houston, Dallas) count as trout.

**Total.** The score is the share of the available points, so a lake (no flow factor) is scored
out of 90 and scaled to 100.

**Ceilings.** Good light cannot rescue unfishable water. Whichever of water temperature, river
flow and wind scores worst sets a ceiling on the total: none at half marks or better, falling to
10 when that factor scores zero. Thunderstorms at the nearest station, or a dangerous-weather
warning in effect (severe thunderstorm, tornado, special marine, flash flood and similar), cap the
score at 15. When a ceiling applies, the score card says which one.

Overall rating: 85+ exceptional, 70+ excellent, 55+ good, 40+ fair, 25+ poor, 10+ very poor.

### Why these weights

They come from a review of measured evidence on angler catch rates. That evidence is thinner than
fishing lore suggests, and most of it covers walleye, muskie and bass; the curves are informed
judgement on top of it, not a fitted model.

- **Water temperature** has the strongest basis: fish are cold-blooded, and each species feeds
  within its own range. Idaho Fish and Game reported trout catch rates 77% lower above 73°F than
  below 66°F, with far more fish dying after release. A 2,500-trip largemouth log (Manns,
  In-Fisherman; not peer-reviewed) put catch per outing at 49–58°F at about 40% of the 69–78°F
  peak. Temperature limits come from EPA criteria.
- **Light** is the best-supported weather-related factor. In a 13-year compulsory creel survey on
  Escanaba Lake, Wisconsin (Shaw, Renik & Sass 2021, PLOS ONE), predicted walleye trip success was
  about 0.47 at dusk, 0.34 at dawn and 0.26 by day, and fell as solar radiation rose. The bass log
  above shows the same order, with night slowest.
- **Wind** showed no effect on walleye or bass catch in the studies that tested it, and about 40%
  fewer muskie at 20 mph than in calm. It is scored mainly for what it does to boat control,
  casting and safety.
- **River flow**: Wisconsin DNR guide logs found smallmouth catch rates fell as discharge rose on
  two of three rivers, while rising or falling stage over three days made no difference. So the
  score uses how high the river is for the date and ignores the short-term trend.
- **Moon**: across 340,000 muskie records (Vinson & Angradi 2014, PLOS ONE) the lunar effect was
  about 5% overall and 10–19% in the datasets where it showed, and the authors could not separate
  it from when anglers choose to fish. Moon overhead/underfoot raised trip success in the Escanaba
  data. A seven-year trout study found no lunar effect at all.
- **Barometric pressure** was not a significant predictor of catch in any of the three angling
  datasets found that tested it (walleye and muskie in Wisconsin; largemouth bass in Michigan and
  Illinois). The slow bite behind a cold front is near-universal testimony but has barely been
  measured, so the trend keeps five points and the level none.
- **Dropped: air temperature and sky as a "nice day" bonus.** Air temperature had no effect of its
  own once water temperature and season are accounted for, and rain was not significant where
  tested. The old score gave a clear sky the most points; the evidence points the other way.
- **Dissolved oxygen** thresholds are EPA's (1986 criteria): feeding and growth suffer below
  about 5 mg/L for warm-water fish and 6 mg/L for salmonids.

Sources: [Shaw, Renik & Sass 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC8483380/) ·
[Vinson & Angradi 2014](https://pmc.ncbi.nlm.nih.gov/articles/PMC4037224) ·
[Idaho Fish and Game on trout and warm water](https://idfg.idaho.gov/blog/2022/06/some-perspective-trout-fishing-during-low-water-and-high-temperatures) ·
[Manns, largemouth log](https://in-fisherman.com/editorial/moon-magic-largemouth-bass/154779) ·
[Mell 1962, bass and weather](https://d.lib.msu.edu/etd/8317/FULL_TEXT/view) ·
[Wisconsin DNR guide reports](https://dnr.wisconsin.gov/sites/default/files/topic/Fishing/Pubs_2014GuidetotheFuture.pdf) ·
[EPA temperature criteria](https://archive.epa.gov/water/archive/web/html/vms53.html)

The figures above were taken from summaries of these sources; check the originals before relying
on any single number. The Escanaba Lake trip-level data is public and would be the place to start
if you want to fit the weights rather than judge them.

## Data sources

| Data | Source | Notes |
|---|---|---|
| Current weather, 72-hour history, forecast, active alerts, place names for "use my location" | [US National Weather Service API](https://www.weather.gov/documentation/services-web-api) | Public domain, no key, US and territories only |
| Town, lake and river search | [Photon](https://photon.komoot.io/) (OpenStreetMap data, hosted by komoot) | Free community service with a fair-use policy and no uptime guarantee |
| Water temperature, level, flow, dissolved oxygen, turbidity | [USGS Water Data APIs](https://api.waterdata.usgs.gov/docs/ogcapi/) | Public domain. `latest-continuous`, `monitoring-locations` and `continuous` collections. Readings are provisional. Oxygen and turbidity are reported by a minority of stations. |
| Normal flow for today's date | [USGS Statistics API](https://api.waterdata.usgs.gov/statistics/v0/docs) (`observationNormals`) | Public domain. Day-of-year percentiles from each gauge's approved record. The API is labelled beta by USGS. |
| Which sport fish live in the region | [GBIF occurrence search](https://techdocs.gbif.org/en/openapi/v1/occurrence) | No key. Counts only, restricted to CC0 and CC BY records. Free service with no uptime guarantee; the app falls back to a latitude rule without it. |
| Sunrise, sunset, twilight, moon phase and position | Computed in the browser (`js/core/sun.js`, `js/core/moon.js`) | No request is made |
| Map tiles | [OpenStreetMap](https://www.openstreetmap.org/copyright) via [Leaflet](https://leafletjs.com/) (vendored in `vendor/leaflet`) | Loaded only when the map scrolls into view |

### Where the weather readings come from

Current conditions are real observations, not a model: temperature and wind come from the nearest
station that reports both, and the page says which station and how old the reading is. Many rural
stations (roadside and fire-weather sensors) have no barometer or sky sensor. Pressure changes
slowly over distance, so it is then taken from the nearest airport station, which is also named
on the page; sky conditions fall back to the NWS forecast for that spot.

### About "depth"

There is no nationwide public feed of how deep a lake or river is. What USGS publishes, and what the
app shows, is the water *level*:

- **Gage height** (rivers): the height of the surface above that gauge's own fixed reference point.
  It is not the depth of the channel, so the trend (rising, falling, steady) is the useful part.
- **Discharge** (rivers): flow in cubic feet per second.
- **Elevation** (lakes and reservoirs): the height of the surface above a sea-level datum. Comparing
  it with the lake's normal or "full pool" elevation tells you how full it is.

Bathymetry (depth maps) exists only in scattered state and federal datasets, with no common API.

### Licences, if the site ever earns money

- **NWS** and **USGS** data are public domain: no restriction on commercial use.
- **GBIF** is free to use and asks to be credited (the page footer does). The app requests only
  records published under CC0 or CC BY, leaving out those marked non-commercial, and uses the
  counts, not the records.
- **Photon** and the **OpenStreetMap tile servers** are donated community services with fair-use
  policies and no guarantee. They do not forbid commercial sites, but a site with real traffic
  should move to a paid tile/geocoding provider or self-host. OpenStreetMap data requires the
  attribution shown in the page footer.

### Privacy

There is no analytics. Your saved places and the last loaded conditions stay in your browser's
local storage. To fetch conditions, coordinates rounded to about 100 m go to the National Weather
Service; USGS (or this site's proxy in front of it) is only asked about a box roughly 130 miles
across, snapped to a 7-mile grid, and then about the individual gauges it found there. GBIF is asked which fish are
recorded in a box about 140 miles across on a half-degree grid. The text you type in the search
box goes to Photon. Your
location is requested only when you press "Use my location".

## Project structure

```
index.html              Page markup and the SVG icon sprite
404.html                Not-found page
styles.css              All styles (CSS custom properties for the light/dark themes)
sw.js                   Service worker: caches the app shell for offline use
manifest.json           PWA manifest
_headers                Security headers (Content-Security-Policy etc.) for Cloudflare Pages
wrangler.toml           Cloudflare Pages configuration
js/
  app.js                Entry point: state, rendering, event wiring
  theme-init.js         Applies the saved theme before first paint
  config.js             Endpoints, tunables, rating bands, phrases
  storage.js            Guarded localStorage access (places, theme, last snapshot)
  api/
    http.js             fetch + JSON with timeout and cancellation
    weather-api.js      NWS observations, forecast and alerts, Photon place search
    species-api.js      GBIF: how often each sport fish is recorded around a place
    usgs-api.js         USGS stations: water temperature, level, flow, their history and flow normals
  core/                 Pure logic with no DOM access (unit tested)
    scoring.js          The fishing score and the best-times outlook
    species.js          Which groups of fish live in a region, and what to call them
    alerts.js           Which NWS alerts matter on the water
    trend.js            Time-based trend analysis
    sun.js              Sun position, sunrise and sunset
    moon.js             Moon phase and overhead/underfoot position
    sky.js              NWS sky reports -> label, emoji, sky class
    util.js             Distance, formatting and other helpers
  ui/
    charts.js           SVG line chart with tooltip, keyboard support and data table
    map.js              Lazy-loaded Leaflet station map
    theme.js            Light/dark toggle
    dom.js              Tiny DOM-building helpers
functions/
  api/usgs/[[path]].js  Cloudflare Pages Function: caching proxy for the USGS API
scripts/build.mjs       Copies the publishable files to dist/
tests/                  Unit tests (node --test)
e2e/                    Browser tests (Playwright)
  support/api-mocks.js  Fixture responses for every external service
  support/fixtures.js   Shared test setup: mocked network, pinned clock, helpers
playwright.config.js
vendor/leaflet/         Leaflet 1.9.4 (BSD-2-Clause)
```

## Browser support

Current versions of Chrome, Edge, Firefox and Safari (desktop and mobile). The app uses ES modules,
CSS `color-mix()` and `:has()`, `ResizeObserver` and `IntersectionObserver`.

## Troubleshooting

- **"Couldn't load the weather"**: check your connection and press *Try again*. If you have opened
  the app before, the last loaded conditions stay on screen with their age.
- **"…has no data for this spot"**: the National Weather Service covers the United States and its
  territories only.
- **Water temperature shows "≈" and "estimated"**: no USGS sensor has reported within 60 miles in
  the last 24 hours (or USGS is unreachable). Try a larger town nearby, or switch the filter to *All*.
- **"USGS is rate-limiting requests"**: without the proxy, USGS allows 1,000 requests an hour per
  IP address. Wait for the hour to roll over, or run through the proxy (`npm run preview`, or the
  deployed site) with a key.
- **"Use my location" does nothing useful**: the browser blocked location access. Allow it in the
  site settings, or search for a place instead.
- **Something works locally but not when deployed**: open the browser console and look for a
  Content-Security-Policy message. A new data source has to be added to `connect-src` in `_headers`.
- **Changes not showing up while developing**: the service worker fetches app files network-first,
  so a normal reload is enough. If in doubt, unregister it under DevTools → Application.

## License

MIT. Leaflet is © Volodymyr Agafonkin and contributors, BSD-2-Clause (see `vendor/leaflet/LICENSE`).

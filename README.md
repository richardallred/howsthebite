# 🎣 How's the Bite?

A Progressive Web App that answers one question for anglers: **how good is the fishing right now?**
Pick any US town, lake, river, bay or beach and get a 0–100 score built from real water
temperature, the time of day, live weather, river flow compared with normal and the moon, or, in
salt water, the tide and the surf. It comes with lure suggestions for the conditions and the
current river level, lake elevation or tide table. The weights follow what studies of angler
catch rates have actually measured (see [How the score works](#how-the-score-works)).

No framework and nothing to compile: plain HTML, CSS and ES modules. The app itself needs
**no API keys**.

![Desktop screenshot](screenshots/desktop.png)

## Features

- **Fishing score (0–100)** with a per-factor breakdown that shows exactly where the points came from,
  tuned to what you are fishing for: all species, bass and panfish, walleye and pike, or trout
- **Only the fish that live there are offered**: the choices come from occurrence records for the
  region, so there is no walleye option in south Florida and no bass option in Alaska
- **Salt water too**: near the coast, switch between Freshwater, Inshore (bays, flats, marsh,
  piers) and Surf. Salt-water scores use NOAA tide predictions and coastal water temperature, and
  for surf the Weather Service's surf height and rip-current risk
- **What to throw**: three or four lure and bait suggestions for the local fish in the current
  water temperature, light, wind, clarity and tide, each with a link to search for it on Amazon
- **Score outlook**: a chart of the score from now to the end of the day after tomorrow, with
  each day's best time, so you can pick when to go
- **Best times** for the next day and a half, from sunrise/sunset, the tide and the forecast
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
npm test            # unit tests: scoring, tides and salt water, lures, regional species, sun and moon, alerts, the proxies
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

When you add, rename or remove a file the page loads, update `SHELL` in `sw.js`. The build fails
if `SHELL` lists a file that is not published, and a browser test fails if the page loads a file
that `SHELL` does not list.

**How visitors get a new version.** The build names the offline cache after a hash of the
published files, so any change makes `sw.js` differ and browsers see a new version. The app looks
for one on every page load and whenever it comes back into view, and reloads itself once when the
new version takes over. Without that, an open tab or an installed app would keep running the
scripts it loaded earlier, possibly for days.

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

### The sea-temperature proxy

`functions/api/sst.js` answers `GET /api/sst?lat=…&lon=…` with a satellite sea-surface
temperature, for coasts where no tide station nearby has a thermometer. The source (NASA JPL's
MUR analysis, served by NOAA CoastWatch) sends no CORS headers, so a browser cannot ask it
directly. Requests are snapped to a 0.05° grid and cached for six hours; an outage serves the
last reading for up to three days. On hosting without Functions the app notices and falls back to
an estimate from air temperature.

### Amazon links

Lure suggestions link to Amazon search results, tagged with the Amazon Associates tracking ID in
`AMAZON_ASSOCIATE_TAG` in `js/config.js`. With that setting empty they are ordinary links, nothing
is earned and no disclosure is shown. If you fork this project, replace the ID with your own or
empty it: never ship someone else's tag, or a made-up one.

For the links to earn:

1. The site's address must be listed in the [Amazon Associates](https://affiliate-program.amazon.com/)
   account the tag belongs to. Amazon expects three qualifying sales within 180 days of applying;
   your own orders do not count.
2. Check one of the generated links in the Associates **Link Checker**. The format used is
   `https://www.amazon.com/s?k=<search>&tag=<id>`, which carries the tag as the programme's
   policies require; Amazon does not publish a canonical format for search links.

What the app does to stay inside the programme's rules (Operating Agreement of October 2025 and
Program Policies of April 2026):

- Shows "As an Amazon Associate I earn from qualifying purchases." on the page and "(paid link)"
  beside every tagged link, which is also what the FTC asks for.
- Marks tagged links `rel="sponsored nofollow"`, as Google asks.
- Uses plain, visible `amazon.com` addresses: no shortener and no redirect.
- Shows no prices.
- **Leaves links untagged in the installed app and when offline.** The policies bar affiliate
  links in software "installable by an end user" and in offline material, and do not say whether
  an installed web app counts. If Associates support confirms in writing that it does not, remove
  that check in `affiliateTag()` in `js/app.js`.

Links to search results are allowed only beside original content relevant to them, which the
suggestions and the score are. Bass Pro Shops also runs an affiliate programme for tackle if
Amazon turns out to be a poor fit.

### Search engines and link previews

- `index.html` carries the canonical URL, Open Graph tags (the preview image is
  `screenshots/share-card.png`, 1200×630) and `WebSite`/`WebApplication` structured data.
  `robots.txt` allows everything and points to `sitemap.xml`.
- These use the absolute address `https://howsthebite.io/`. If the domain ever changes, change it
  in `index.html`, `robots.txt`, `sitemap.xml` and `functions/_middleware.js`.
- `functions/_middleware.js` permanently redirects page loads on the old address,
  `howsthebite.pages.dev`, to the same path on `howsthebite.io`, so search engines move their
  index and any links to the new domain. Files fetched by an already-open page or the installed
  app are not redirected, so those keep working until their next load. Saved places live in the
  browser per address and do not carry over. Per-deployment preview addresses are not redirected.
  `_routes.json` limits Functions to page loads and the `/api/` proxies, so scripts, styles and
  images never invoke a Worker (Functions count against the Workers request allowance).
- Search engines have no saved place and no location permission, so they see the default city.
  The page title therefore stays as the site's own title until a visitor picks a place.
- The "Fishing questions, answered" section is plain HTML so it can be indexed. Keep its figures
  in line with `js/core/scoring.js` and the sections above when the score changes.
- Cloudflare marks every preview and per-deployment address (`<hash>.howsthebite.pages.dev`)
  `noindex`, so only the production address is indexed.

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

### The outlook

The chart under **Forecast** is the same score worked out every 20 minutes from now to the end of
the day after tomorrow (`scoreSeries` in `js/core/scoring.js`). Its first point is the score shown
at the top of the page.

- **Calculated exactly:** the sun (light), the moon, and in salt water the tide.
- **From forecasts:** sky and wind from the Weather Service's hour-by-hour forecast (the 12-hour
  forecast if that fails to load), and off a beach the wave-height forecast.
- **Assumed to hold:** water temperature and river flow stay as they are now. That is the main
  reason the later days are only a rough guide: a cold front or a rise in the river will change
  them.
- **Not carried forward:** the pressure trend (unknown ahead, scored as neutral) and current
  weather alerts.
- **Thunderstorms:** a forecast hour counts as a storm, and is capped at 15, only when storms are
  likely (55% or more). A mere chance of thunderstorms, which is in the forecast most summer
  afternoons in the South, is scored as a showery, low-light spell.

Each day's card gives its best score and the stretch around it that stays within four points.
When something holds the score flat all day (frozen water, a river in flood), the card says so
instead of naming a best time.

### Salt water

Near tidal water the page offers **Inshore** (bays, estuaries, flats, marsh, jetties, piers) and,
where the Weather Service forecasts for a beach, **Surf**. Fresh water stays the default; the
choice is remembered and applies wherever it is possible. Tidal rivers get the choice too: only
the angler knows whether they are fishing salt water there.

| Factor | Inshore | Surf | How it is scored |
|---|---|---|---|
| Water temperature | 35 | 30 | A curve per group of fish: snook, tarpon and pompano peak at 74–86°F; redfish, seatrout and flounder at 65–82°F; striped bass, bluefish and fluke at 55–70°F; southern California halibut and surf fish at 60–72°F; salmon and northern surfperch at 48–58°F. Snook score almost nothing below 58°F. |
| Tide | 27 | 15 | How fast the water is moving, from NOAA's predicted highs and lows: full marks at mid-tide, 40% at slack. Rising and falling score the same. |
| Surf | — | 22 | Wave height at the beach. Up to 3 ft scores full marks and flat water 90%; points fall away above 4 ft and are gone by 10 ft. |
| Light | 18 | 15 | Dawn and dusk 100%; daytime 60–78% by cloud; night 65%. |
| Wind | 17 | 15 | The freshwater curve. |
| Barometric pressure | 3 | 3 | Trend only. |

Water temperature, surf and wind can each set a ceiling on the total, as in fresh water. There is
no river-flow or moon factor. Where no wave height is available the surf factor is left out; where
NOAA has no predictions, so is the tide.

What salt-water fish are offered follows the region, as in fresh water, with two additions: each
group is limited to the coast it lives on, and striped bass records count only where stripers run
in salt water (reservoir fish across the South would otherwise put them on every Gulf beach).
Hawaii's shore fish are not in the list, so Hawaii gets a warm-water score and no lure advice.

**Why these weights.** The evidence is thinner than for fresh water, and no study ranks these
factors against each other for shore anglers.

- **Water temperature** is again the best supported, through physiology: snook stop feeding at
  about 58°F and die near 54°F; spotted seatrout are cold-stunned below 45°F; pompano avoid water
  under 68°F; red drum feed poorly below 60°F; large striped bass avoid water above 77°F.
- **Tide.** Tagged summer flounder, red drum and striped bass all move and feed with the tide, but
  the favoured stage differs by species and place, and nobody has measured the effect on catch
  rates. So moving water is scored and direction is only reported. The one test of moon phase
  beyond the tide (summer flounder) found nothing.
- **Surf.** The only catch data on waves (8,815 small-boat sea bass trips in the UK) showed
  landings falling as wave height rose. Nothing supports the saying that flat surf fishes badly.
- **Light.** Fish are most active around dawn and dusk, but a creel survey of 1,862 Mississippi
  shore anglers found night and day catch rates essentially the same, so night is not marked down.
- **Not scored:** wind direction, water clarity and salinity after rain (species-specific or
  untested, and not measured widely enough to use), and season (handled by which fish are offered
  and by temperature).

Sources: [summer flounder telemetry](https://bioone.org/journals/marine-and-coastal-fisheries/volume-6/issue-6/19425120.2014.893468/Small-Scale-Vertical-Movements-of-Summer-Flounder-Relative-to-Diurnal/10.1080/19425120.2014.893468.full) ·
[Mississippi day/night shore creel](https://gsmfc.org/publications/GSMFC%20Number%20113.pdf) ·
[seatrout winterkill](https://ncseagrant.ncsu.edu/hooklinescience/when-do-spotted-seatrout-succumb-to-winterkill/) ·
[pompano review](https://repository.library.noaa.gov/view/noaa/49230/noaa_49230_DS1.pdf) ·
[UK sea bass and wave height](https://pmc.ncbi.nlm.nih.gov/articles/PMC8970468/) ·
[California surf fish study](https://wildlife.ca.gov/Conservation/Marine/Surf).
Temperature ranges between the measured thresholds come from long-standing guides' tables.

### Lure suggestions

`js/core/lures.js` holds a list of rules per fish. Each rule names a lure or bait, how to fish it
and why it suits the moment, and applies when the conditions match: water temperature judged
against that fish's own range, light, wind, water clarity (measured turbidity, or river flow
against normal as a stand-in), and in salt water the tide and the surf.

**These are not measured.** Hardly anyone has tested lure choice against conditions. The rules
follow what state agencies publish in their "how to catch" guides (Iowa, Minnesota, Oregon,
Oklahoma, New York and Missouri for fresh water; Texas, South Carolina, Georgia, New Jersey,
Florida and California for salt), filled in from In-Fisherman, Bassmaster and On The Water where
agencies are silent. Perch and salmon entries are general practice. The page says all this.

Where studies exist they are used: the one comparison of pike lures found spoons out-caught
spinnerbaits, and the two studies of lure colour (largemouth bass and pike) found colour made no
difference to catch rate, which the colour line under the suggestions says plainly. Some rules are
advice rather than tackle: rest trout in water that is too warm, leave cold-stunned snook alone,
and wait for daylight for pike and sunfish, which feed by sight.

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
| Current weather, 72-hour history, daily and hourly forecast, active alerts, place names for "use my location" | [US National Weather Service API](https://www.weather.gov/documentation/services-web-api) | Public domain, no key, US and territories only |
| Town, lake and river search | [Photon](https://photon.komoot.io/) (OpenStreetMap data, hosted by komoot) | Free community service with a fair-use policy and no uptime guarantee |
| Water temperature, level, flow, dissolved oxygen, turbidity | [USGS Water Data APIs](https://api.waterdata.usgs.gov/docs/ogcapi/) | Public domain. `latest-continuous`, `monitoring-locations` and `continuous` collections. Readings are provisional. Oxygen and turbidity are reported by a minority of stations. |
| Normal flow for today's date | [USGS Statistics API](https://api.waterdata.usgs.gov/statistics/v0/docs) (`observationNormals`) | Public domain. Day-of-year percentiles from each gauge's approved record. The API is labelled beta by USGS. |
| Tide predictions, coastal water temperature | [NOAA CO-OPS](https://api.tidesandcurrents.noaa.gov/api/prod/) | Public domain, no key. CO-OPS has no "nearest station" search, so the app carries a station list in `data/coops-stations.json`; rebuild it now and then with `node scripts/update-coops-stations.mjs`. |
| Surf height, rip-current risk, beach water temperature | NWS beach forecast ([feature service](https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/marine_beachforecast_summary/FeatureServer)) | Public domain. Many offices issue it only in the swimming season; the fields are empty otherwise. |
| Wave-height forecast off a beach | NWS forecast grid (`api.weather.gov/gridpoints`) | Used when the beach forecast has no surf height. A beach's own grid cell is land, so the app looks a few miles out in each direction for one over open water and remembers it. |
| Sea-surface temperature where no station is near | NASA JPL MUR analysis via [NOAA CoastWatch ERDDAP](https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41.html), through `/api/sst` | Free to use and redistribute. About a day and a half old, and a degree or two warm inside bays; labelled a satellite estimate. |
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

- **NWS**, **USGS** and **NOAA** data are public domain: no restriction on commercial use.
- **GBIF** is free to use and asks to be credited (the page footer does). The app requests only
  records published under CC0 or CC BY, leaving out those marked non-commercial, and uses the
  counts, not the records.
- **Photon** and the **OpenStreetMap tile servers** are donated community services with fair-use
  policies and no guarantee. They do not forbid commercial sites, but a site with real traffic
  should move to a paid tile/geocoding provider or self-host. OpenStreetMap data requires the
  attribution shown in the page footer.

### Privacy

The site uses [Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/) to count
visits. Cloudflare adds the script when it is switched on for the Pages project; it sets no
cookies and, by Cloudflare's own description, does not fingerprint visitors or track them across
sites; it reports page views and page-load timings. Switch it off in the Cloudflare dashboard to
remove it. Your saved places and the last loaded conditions stay in your
browser's local storage. To fetch conditions, coordinates rounded to about 100 m go to the National Weather
Service; USGS (or this site's proxy in front of it) is only asked about a box roughly 130 miles
across, snapped to a 7-mile grid, and then about the individual gauges it found there. GBIF is asked which fish are
recorded in a box about 140 miles across on a half-degree grid. Near the coast, NOAA is asked for
the tides at the nearest station, and the Weather Service's beach-forecast service is sent the
same rounded coordinates. Following an Amazon link takes you to Amazon, which then sees the
search and, if an Associates tag is configured, that you came from this site. The text you type in the search
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
    coast-api.js        NOAA tides and water temperature, NWS beach and wave forecasts, sea temperature
    usgs-api.js         USGS stations: water temperature, level, flow, their history and flow normals
  core/                 Pure logic with no DOM access (unit tested)
    scoring.js          The fishing score (fresh, inshore, surf) and the best-times outlook
    lures.js            Lure and bait suggestions for the conditions
    tides.js            Tide height and movement between predicted highs and lows
    species.js          Which groups of fish live in a region, and what to call them
    alerts.js           Which NWS alerts matter on the water
    trend.js            Time-based trend analysis
    sun.js              Sun position, sunrise and sunset
    moon.js             Moon phase and overhead/underfoot position
    sky.js              NWS sky reports -> label, emoji, sky class
    util.js             Distance, formatting and other helpers
  ui/
    charts.js           SVG line chart with tooltip, keyboard support and data table
    outlook-chart.js    The score outlook chart: shaded nights, day labels, each day's best moment
    map.js              Lazy-loaded Leaflet station map
    theme.js            Light/dark toggle
    dom.js              Tiny DOM-building helpers
data/
  coops-stations.json   NOAA tide and water-temperature stations (built by scripts/update-coops-stations.mjs)
functions/
  api/usgs/[[path]].js  Cloudflare Pages Function: caching proxy for the USGS API
  api/sst.js            Cloudflare Pages Function: satellite sea-surface temperature
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

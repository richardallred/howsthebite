# Security Policy

How's the Bite? is a small, volunteer-run project. Security reports are welcome and taken
seriously, and this page explains how to send one and what to expect.

## Supported versions

There are no releases. The only supported version is what is deployed at
[howsthebite.io](https://howsthebite.io), which is always built from the `main` branch. Fixes
go to `main` and are live within minutes of merging.

## Reporting a vulnerability

**Please do not open a public issue, pull request or discussion for a security problem.**

Report it privately through GitHub instead:
[**Report a vulnerability**](https://github.com/richardallred/howsthebite/security/advisories/new)
(the Security tab → "Report a vulnerability"). Only the maintainers can see what you send.

It helps to include:

- what the problem is and what an attacker could do with it
- the steps, URL or request that shows it (a proof of concept is ideal)
- the commit or date you tested against, and the browser if it matters
- whether you would like to be credited, and under what name

## What to expect

This is maintained in spare time, so these are aims rather than guarantees:

- **Acknowledgement** within 7 days.
- **An assessment** (whether it is accepted, and how serious) within 14 days.
- **A fix** for serious issues as soon as practical, usually within 30 days. You will be kept
  up to date and asked to confirm the fix if you are willing.

Once it is fixed, a GitHub security advisory will be published describing the problem, with
credit to you unless you prefer otherwise. Please keep the details private until then, or for
90 days from your report, whichever comes first. If more time is needed, it will be agreed with
you.

There is no bug bounty.

## Scope

The site has no accounts and stores nothing about visitors on the server. Saved places and the
last loaded conditions live only in the visitor's own browser. That limits what can go wrong, but
the following are very much in scope:

- **The site** at `howsthebite.io` and its preview deployments on `*.howsthebite.pages.dev`:
  cross-site scripting, Content-Security-Policy bypasses, injection through place addresses
  (`/fishing/<lat>,<lon>/<name>`) or shared links, open redirects, and service-worker or cache
  poisoning that could serve someone else bad content.
- **The Pages Functions** under [`functions/`](functions/), including the data proxies under
  `/api/`: server-side request forgery, reaching upstreams or paths they are not meant to reach,
  leaking the `USGS_API_KEY` secret, edge-cache poisoning, or a way to use a proxy that would
  quickly exhaust its upstream quota or run up costs.
- **This repository and its CI**: secrets committed to the code or its history, and anything in
  [`.github/workflows/`](.github/workflows/) that would let an outside pull request read the
  Cloudflare deploy secrets, deploy to production, or write to the repository.

Out of scope:

- **The third-party services** the app reads from (the National Weather Service, USGS, NOAA,
  GBIF, Photon, OpenStreetMap, the state map services, Amazon) and the Cloudflare platform
  itself. Please report those to their owners.
- **Wrong or misleading fishing, weather or water data.** That is a bug, not a security issue:
  please [open an issue](https://github.com/richardallred/howsthebite/issues).
- The Amazon Associates tag in [`js/config.js`](js/config.js). It is public by design and appears
  in every link.
- Reports from automated scanners, missing headers, or best-practice suggestions with no
  demonstrated impact on this site.
- Denial of service by sheer volume, social engineering, and physical attacks.

## Testing guidelines

Good-faith research that follows these guidelines is welcome, and will not be met with legal
action or complaints to your provider:

- Prefer testing a local copy (`npm run preview` runs the site and its functions; see the
  [README](README.md#run-it-locally)) or a preview deployment over production.
- Send only as many requests as you need to show the problem. Do not load-test or try to take
  the site or its proxies down, and do not use the proxies to hammer the services behind them.
- Do not try to get into anyone else's accounts, including the maintainers' GitHub or Cloudflare
  accounts.
- If you come across a secret, stop, do not use it, and report it straight away.

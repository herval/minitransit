# MiniTransit

A live Bay Area transit map inspired by Mini Metro. Includes BART, Caltrain, Muni rail, VTA light rail, San Francisco Bay Ferry, SMART and AC Transit. Public app: https://minitransit.fly.dev.

The map opens closer around SF/Oakland; network tabs open closer views of their routes and stops. **Fit** shows the full selected network. The regional view shows rail and ferries; **+ Buses** adds AC Transit, and its network tab opens downtown Oakland. Names appear as you zoom. Tap a vehicle for its upcoming stops and platform details, or a stop for departures. Delay outlines, lateness badges, service-gap clocks and a saved night mode are included.

The bus overview bundles shared routes into muted corridors and shows a limited set of named transfer hubs. Bus markers are small dots; nearby buses form numbered groups. Select a group to choose an individual bus, or choose a route above the map. The selected route shows colored tracks, stop names, vehicle icons, delays and gap clocks over a faint network context. **← Overview** returns to the overview without moving the camera. Ordinary bus stops appear at neighborhood zoom; search can always reveal a specific stop. Stop circles have a fixed size limit.

## Run locally

Use Node.js 22.13 or newer.

```sh
npm ci
cp .env.example .env
# Add your 511 Open Data token to BART_511_API_KEY in .env.
npm start
```

Open http://localhost:8080. The existing environment key name is kept for compatibility; the token now covers all seven networks. It stays on the server. `.env` is ignored by Git and Docker.

```sh
npm test
npm run build
npm run dev
```

Browser modules are served directly. The build validates the required assets. Space pauses movement, **L** toggles names, **N** toggles night mode, and Escape closes details.

## Rendering and response performance

The map creates SVG elements for the active network and visible stops and vehicles. Rail segments share one SVG path per route; bus overviews use one centered corridor layer, and selected routes retain a faint network context. Stop names use cached measurements and placement; live clock ticks do not rerun the stop layout. Pan and zoom events are combined into animation frames, with lane geometry rebuilt after the zoom gesture settles. Reported locations are resolved once per update, and estimated motion is capped at 30 updates per second. Nearby bus markers group using a spatial grid while preserving every member for selection. Dense bus-stop markers thin out at overview scales and appear with zoom or search.

`/api/live` sends compact motion windows, delay summaries and gap cues. Unchanged snapshots return HTTP 304; `X-Server-Time` keeps the browser clock aligned even when the body is unchanged. Full stop lists and station departures load only when their details are opened. These responses reuse the same upstream cache, so opening details does not increase 511 polling frequency. See [PERFORMANCE.md](PERFORMANCE.md) for the local comparison and validation method.

## Live data

[511 Open Data](https://511.org/open-data/transit) supplies the consolidated regional GTFS schedule, trip updates, vehicle positions and service alerts. All networks and visitors share the same server caches: trip updates and positions refresh every 150 seconds, and alerts every 600 seconds. This uses about 54 upstream requests per hour during continuous operation on one server, within the default token budget of 60. Starts and schedule refreshes also make requests.

Reported locations are snapped to schematic routes. Where no fresh reported location is available, movement is estimated between stop predictions. Each source expires after 180 seconds; old positions freeze and delay/gap indicators clear. Arrival times and delays appear only when reported. A reported position can show a vehicle even when upcoming-stop predictions are unavailable; those stops display an empty ETA. Coverage varies by route and time of day.

The bundled, verified regional schedule provides immediate startup. A background refresh runs at most every 12 hours. `lib/regional-schedule.mjs` streams the roughly 300 MB expanded source archive and stores repeated stop patterns once, keeping schedule processing bounded. A failed refresh retains the last verified schedule. Shared 511 parent stops provide transfer hubs across agencies. Caltrain local and express services share one map corridor.

To rebuild the bundled schedule from an already downloaded regional GTFS ZIP:

```sh
node scripts/prepare-region.mjs /path/to/regional.zip
```

The schematic rotates geography and simplifies paths into straight and diagonal segments; it is not a geographic navigation map. Muni buses, cable cars and VTA buses are outside this version. Stops explicitly marked nonpublic are hidden.

The water backdrop comes from [U.S. Census Bureau TIGERweb areal hydrography](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Hydro/MapServer/1), clipped to the Bay Area and simplified to roughly 10-meter tolerance. It preserves island holes and uses the same latitude/longitude projection as station coordinates in desktop and phone layouts. The shoreline is bundled in `public/water-data.js`, with one cached SVG path per projection; there are no runtime Census requests or map tiles.

To rebuild the bundled shoreline from the public Census service, or an already saved GeoJSON extract:

```sh
node scripts/prepare-water.mjs
node scripts/prepare-water.mjs /path/to/shoreline.geojson
```

## Server and deployment

`server.mjs` serves public assets, `/api/network` for stops and map geometry, `/api/live` for the compact map snapshot (`format: "map-v1"`), `/api/train?id=...` for a selected vehicle's complete stop list, `/api/station?id=...` for departures at a selected stop, and `/healthz` for an independent health check. Encode detail IDs as URL query values. Set `PORT` (default `8080`), `HOST` (default `0.0.0.0`), and `BART_511_API_KEY` in the runtime environment.

The Dockerfile runs as an unprivileged user. `fly.toml` configures HTTPS, health checks, automatic stop/start, and one shared-CPU Machine with 512 MB RAM in San Jose. The larger memory allocation allows live regional data and background schedule refreshes to coexist. No database or persistent volume is required.

```sh
fly deploy --remote-only --ha=false
fly status
fly checks list
```

Keep one Machine so each instance does not make duplicate upstream requests. Store the token in Fly's encrypted runtime secrets. To replace it, use `fly secrets import --app minitransit --stage` and supply a `BART_511_API_KEY=...` line on standard input. Never include the key in the image or source.

This is an independent visualization, not an official transit service or a Mini Metro product. Data provided by 511.org.

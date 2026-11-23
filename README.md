# MiniTransit

A live BART map inspired by Mini Metro. Includes named stations, animated train estimates, delay outlines and lateness badges, service-gap clocks, upcoming stops with platform details, and a night mode that remembers your preference.

## Run locally

Use Node.js 22.13 or newer.

```sh
npm ci
cp .env.example .env
# Add your 511 Open Data token to BART_511_API_KEY in .env.
npm start
```

Open http://localhost:8080. The token stays on the server; `.env` is ignored by Git and Docker. Press **N** or use the moon/sun button to change the theme.

```sh
npm test
npm run build
```

Run the build after changing `public/live-map.js`: it appends that module to the map's base code in `public/map.js`. The build is repeatable and runs during the Docker image build. `npm run dev` restarts the Node server when files change.

## Server and deployment

`server.mjs` serves the map and public assets, `/api/live` for normalized BART data, and `/healthz` for an independent health check. Set `PORT` (default `8080`), `HOST` (default `0.0.0.0`), and `BART_511_API_KEY` in the runtime environment. The included Dockerfile runs as an unprivileged user.

The public deployment is https://minitransit.fly.dev. `fly.toml` configures HTTPS, health checks, and one shared CPU with 256 MB of RAM in San Jose (`sjc`). The Machine stops while idle and starts automatically when someone visits.

`BART_511_API_KEY` is stored in Fly's encrypted runtime secrets. To replace it, use `fly secrets import --app minitransit --stage` and supply a `BART_511_API_KEY=...` line on standard input. Do not add the key to the Docker image, source files, or `fly.toml`.

```sh
fly deploy --remote-only --ha=false
fly status
fly checks list
```

Keep exactly one Machine: feed caches are shared inside one Node process, and extra Machines would each make their own upstream requests. Use `--ha=false` on redeployments so Fly does not add a spare Machine.

The app has no database or persistent volume. Source schedules and responses are cached in memory. A restart refreshes them on the next live request.

## Data and limitations

With a token, [511 Open Data](https://511.org/open-data/transit) provides BART GTFS schedules, trip predictions, and service alerts. The matching schedule is fetched every 12 hours; predictions are shared for 75 seconds and alerts for 10 minutes. This stays within a default 60-request/hour token budget during normal continuous use on one server. Cold starts and restarts also request data.

Without a token the server attempts BART's direct GTFS feeds, which may reject automated requests. Use the 511 token for reliable live service.

Train positions are estimates interpolated between predicted stops, not GPS locations. Delay badges require a reported delay; an unknown delay is not counted as on time. Gap clocks compare consecutive fresh departures in the same direction. Old predictions are marked stale and stop moving. Platform details identify their source. Some services, including the Oakland Airport connector, may have limited live coverage.

This is an independent visualization, not an official BART service or a Mini Metro product.

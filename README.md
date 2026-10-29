# <img width="28" height="28" alt="favicon" src="https://github.com/user-attachments/assets/a195e843-0a36-4990-8280-0b3e426f3b08" /> Mégis hol a vonat?

**Magyar vonattérkép alkalmazás. Késési adatokkal és egyéb hasznos információkkal.** *// Hungarian train map application. Contains delay data and other useful information.*

<img width="655" height="385" alt="map" src="https://github.com/user-attachments/assets/6ae41972-7d48-4d9d-9ec7-7d401952ca11" />

---

A **Mégis hol a vonat?** valós időben, egy interaktív térképen mutatja a magyar vonatokat. Az alkalmazás hivatalos források adatait használja, és egy könnyen használható felületen jeleníti meg azokat.

### Főbb jellemzők

- 🗺️ **Interaktív térkép** - Láthatod az összes vonatot valós időben
- ⏱️ **Pontos késési adatok** - GPS alapú késésszámítás
- 🚄 **Részletes járatinformációk** - Menetrend, állomások, vágányok
- 🌐 **Többnyelvűség** - Magyar és angol nyelv támogatás
- 📱 **Reszponzív design** - Működik minden eszközön

---

## Local development

This repository is a pnpm monorepo with:

- `apps/web` – Next.js frontend that uses the public API client
- `apps/api` – FastAPI
- `packages/api-client` – Generated TypeScript SDK (hey-api)


### Required software

- [Node.js 20 LTS](https://nodejs.org/en)
- [pnpm](https://pnpm.io/)
- [Python 3.13](https://www.python.org/)
- [uv](https://docs.astral.sh/uv/)
- Docker or Podman (or native Redis and Postgres 18)
- [biome](https://biomejs.dev/) VS Code extension

### Step-by-step setup

1. **Clone & enter the workspace**

   ```bash
   git clone https://github.com/megisholavonat/megisholavonat.git
   cd megisholavonat
   ```

2. **Install JavaScript dependencies**

   ```bash
   pnpm install
   ```

5. **Configure backend environment variables**

   Create `apps/api/.env` with at least:

   ```
   GRAPHQL_ENDPOINT=
   REDIS_HOST= (optional if running Redis from the provided compose file)
   REDIS_PORT= (optional, defaults to 6379)
   REDIS_KEY= (optional, prefix for all Redis keys, defaults to mhav-local)
   DATABASE_URL=postgresql+asyncpg://mhav:mhav@localhost:5432/mhav
   REPLAY_FILE= (optional, see "Replaying recorded data" below)
   DEBUG=true (optional)
   ```

6. **Start Redis and Postgres (if not running separate)**

   ```bash
   docker compose up -d
   pnpm db:migrate
   ```

   This exposes Redis on `localhost:6379` and Postgres on `localhost:5432`
   (user, password and database are all `mhav`). If a port is taken, set
   `MHAV_REDIS_PORT` / `MHAV_POSTGRES_PORT` in a root `.env` (e.g. `6380` and
   `5433`) and use the same ports in `REDIS_PORT` and `DATABASE_URL` in
   `apps/api/.env`.

7. **Run the dev servers**

   - Run everything with Turborepo:

     ```bash
     pnpm dev
     ```

     This spawns:
     - Next.js at http://localhost:3000
     - FastAPI at http://localhost:8000
     - Taskiq worker and scheduler

   - Or run apps individually:

     ```bash
     pnpm --filter @megisholavonat/web dev
     pnpm --filter @megisholavonat/api dev
     ```

   The web server's link previews (og tags and images) read two runtime
   variables (see `apps/web/.env.example`):
   - `API_URL` – the API the server fetches from, default
     `http://localhost:8000`. In production set it to the in-cluster API
     service; it is never derived from the request's Host header.
   - `SITE_URL` – the public origin for `og:url` and `metadataBase`, default
     `https://megisholavonat.info`.

### Extra commands

- `pnpm generate:api` – Regenerate API client after backend changes
- `pnpm db:migrate` – Apply database migrations (`alembic upgrade head`)
- `pnpm test` – Run the API test suite (needs the compose Postgres; tests use a
  separate `<database>_test` database, or `TEST_DATABASE_URL` if set)

### Web end-to-end tests

`apps/web/e2e` is a Playwright suite (phone 390x844 and desktop 1440x900,
Chromium). It serves the API from the JSON fixtures in `e2e/fixtures`, so it
needs neither the API nor the network. CI runs it on every pull request that
touches the web app or the packages.

```bash
pnpm --filter @megisholavonat/web exec playwright install chromium  # once
pnpm turbo e2e --filter=@megisholavonat/web  # builds, then runs the suite
```

- Known gaps from the audit are `test.fixme` with the audit id in the title.
  `E2E_RUN_FIXME=1` runs them anyway, to see which ones a branch fixes.
- `PLAYWRIGHT_CHROMIUM_PATH` points the suite at a system Chromium, where
  Playwright's own build cannot run (NixOS). `E2E_PORT` changes the port
  (default 3210).
- `node e2e/capture-fixtures.mjs` (in `apps/web`) re-captures the fixtures from
  a local API.

### Database migrations

Models live in `apps/api/api/models`. After changing them, from `apps/api`:

```bash
uv run alembic revision --autogenerate -m "describe the change"
uv run alembic upgrade head
uv run alembic check   # CI fails if models and migrations differ
```

### Delay history

After every refresh the worker enqueues `record_history`, which writes one row
to `stop_delay_observations` per trip and stop the first time a train is seen
past that stop (keyed on trip gtfsId, since train numbers repeat within a
day). The delay stored is our GPS-derived delay; OTP's own delays are kept
alongside. Positions from vehicles not yet running their trip, far off the
route, or with impossible delays are ignored. Each row keeps the platform-level
`stop_id` and the `station_id` (UIC code, e.g. `005501024`) of the stop. A daily
task (03:30 Budapest) creates partitions, rolls yesterday into
`delay_daily_agg` (per station and route) and drops raw partitions older than
`HISTORY_RETENTION_MONTHS` (13).

### Devices and follows

There are no accounts. `POST /v1/devices` returns a `deviceId` and a token
(shown once; only its sha256 is stored); clients send
`Authorization: Bearer <deviceId>.<token>`. Registration is limited to 5 per
hour per client IP (per /64 for IPv6) and 500 per hour overall.

The client IP is the TCP peer unless the request comes from a proxy listed in
`TRUSTED_PROXIES` (comma-separated IPs/CIDRs, empty by default), in which case
it is the rightmost `X-Forwarded-For` entry that is not a trusted proxy.
Uvicorn's own proxy header handling is turned off (`--no-proxy-headers`), so
set `TRUSTED_PROXIES` to the ingress addresses in production, and to
`127.0.0.1,::1` locally (the Next.js dev server proxies `/api`).

Behind an edge that sends the client address in a header of its own, set
`CLIENT_IP_HEADER` to it (in production `CF-Connecting-IP`, from Cloudflare).
It takes precedence over `X-Forwarded-For`, but only when the TCP peer is in
`TRUSTED_PROXIES` and the value is a valid IP; otherwise it is ignored, so a
client connecting directly cannot set its own address. The ingress has to pass
the header through unchanged and be the only way in.

A device follows up to 50 trains: a single trip (`kind: "trip"`, by trip
gtfsId and service date) or a commute (`kind: "commute"`, a train number on
some ISO weekdays from a boarding station, required because train numbers
repeat within a day). A daily task (03:45 Budapest) deletes trip follows two
days after their service date and devices idle for 180 days.
`DELETE /v1/devices/me` erases a device with all its follows and Redis keys.

### Push alerts

Followers get native push only (no web push): Expo notifications on iOS and
Android, and iOS Live Activity updates through APNs. Apps register tokens with
`POST /v1/devices/me/push-tokens`. After every refresh the worker enqueues
`evaluate_alerts`; the rules are documented in
`apps/api/api/services/push_alerts.py`. Without credentials a sender logs
once and sends nothing, so local development needs none of these
(`apps/api/.env`):

```
EXPO_ACCESS_TOKEN=
APNS_KEY_ID=
APNS_TEAM_ID=
APNS_PRIVATE_KEY= (contents of the .p8 key; newlines may be written as \n)
APNS_BUNDLE_ID=
APNS_USE_SANDBOX= (optional, defaults to false; true for development builds)
LIVE_ACTIVITY_PUSH_ENABLED= (optional, defaults to true; false stops Live Activity pushes)
LIVE_ACTIVITY_PUSH_TO_START_ENABLED= (optional, defaults to true; false: no starts by push)
LIVE_ACTIVITY_START_WINDOW_MIN= (optional, defaults to 40; minutes before departure)
PUSH_TOKEN_MAX_FAILURES= (optional, defaults to 10)
```

In production, set `EXPO_ACCESS_TOKEN` **and** turn on "Enhanced push
security" in the Expo project settings. Without it, anyone holding a leaked
device push token could send pushes to that device through Expo.

Expo alerts are sent on the Android notification channel `alerts`; the app
must create that channel (the mobile scaffold will), or Android 8+ does not
show them.

The Expo receipts key (`<REDIS_KEY>:push:expo-receipts`) is global, not
per-device, on purpose: it holds only ticket and token ids, and entries are
dropped within a day.

### Live Activity and commute widget (iOS)

`apps/mobile/targets/widgets` is a WidgetKit extension added at prebuild by
`@bacons/apple-targets`: the followed train's Live Activity (lock screen and
Dynamic Island) and the commute widget. `apps/mobile/modules/live-activity` is
the local Expo module that starts, updates and ends the activities and writes
the widget's data to the App Group `group.info.megisholavonat.app`.
`TrainActivityAttributes.swift` exists in both, identical (a unit test checks
it), and its `ContentState` is what `live_activity_content` in
`push_alerts.py` pushes. The line is a text badge: the MÁV route glyph font is
not licensed for bundling into the extension.

A follow gets a Live Activity when its toggle is on (default on for a single
trip leaving within three hours). The app sends what the activity shows
before the train is live (`liveActivity` on the follow: badge, title,
stations, scheduled times, platform); null turns it off.

- iOS 17.2+: the API starts it by push (push-to-start) about
  `LIVE_ACTIVITY_START_WINDOW_MIN` (40) minutes before departure, without the
  app, once per follow and run, unless the follow already has an activity
  token. The device's push-to-start token is registered as
  `liveactivity_start` (one per device; a new one replaces it). When iOS
  starts the activity it wakes the app in the background; the native module
  (`LiveActivityObserver.swift`, started from an app delegate subscriber at
  launch) registers the activity's own token as `liveactivity` itself, with
  the API URL and device token JS stored in the Keychain. The app starts one
  itself only as a fallback, within 20 minutes of departure.
- Older iOS: the app starts it in the foreground, from three hours before
  departure. Commutes need the app opened on the day.

The activity's token goes to `POST /v1/devices/me/push-tokens` (type
`liveactivity`), and the API updates and ends it from then on. Development
builds get sandbox tokens: set `APNS_USE_SANDBOX=true` for them.

Testing push-to-start on an iPhone (iOS 17.2+, development build, the API
with APNs credentials and `APNS_USE_SANDBOX=true`):

1. Open the app once after installing, with notifications allowed: the
   push-to-start token is registered (`push_tokens` has a
   `liveactivity_start` row for the device).
2. Follow a train leaving in 45–90 minutes with the Live Activity toggle on,
   then close the app (swipe it away).
3. About 40 minutes before departure the activity appears on the lock
   screen, with a silent alert. The worker logs `liveActivityStarts: 1`.
4. Within a minute `push_tokens` has a `liveactivity` row for the follow (the
   app registered it from the background), and once the train is live
   the API's updates move the activity (`liveActivityUpdates`).
5. Open the app: no second activity appears. Unfollow: the activity ends.

For a quick test, set `LIVE_ACTIVITY_START_WINDOW_MIN` higher than the time
to departure. A start is sent once per follow and run (Redis
`device:<id>:liveactivity-start:<follow>:<departure>`); delete that key to
send it again.

Android has no counterpart yet. An ongoing notification with progress needs
a native module (a foreground service, or `setOngoing` plus a progress style
updated from a data-only FCM message in `FirebaseMessagingService`), because
`expo-notifications` cannot update a shown notification from the background.

### Replaying recorded data

To develop without calling upstream, set
`REPLAY_FILE=tests/fixtures/vehicles-sample.jsonl.gz` in `apps/api/.env`. This
committed fixture holds ten recorded snapshots of twelve trains. Every refresh
serves the next snapshot (looping at the end), and staleness is judged against
the snapshot time. The position is kept in Redis under
`<REDIS_KEY>:replay-cursor`; delete that key to start over.

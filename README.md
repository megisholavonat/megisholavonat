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

### Extra commands

- `pnpm generate:api` – Regenerate API client after backend changes
- `pnpm db:migrate` – Apply database migrations (`alembic upgrade head`)
- `pnpm test` – Run the API test suite (needs the compose Postgres; tests use a
  separate `<database>_test` database, or `TEST_DATABASE_URL` if set)

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

### Replaying recorded data

To develop without calling upstream, set
`REPLAY_FILE=tests/fixtures/vehicles-sample.jsonl.gz` in `apps/api/.env`. This
committed fixture holds ten recorded snapshots of twelve trains. Every refresh
serves the next snapshot (looping at the end), and staleness is judged against
the snapshot time. The position is kept in Redis under
`<REDIS_KEY>:replay-cursor`; delete that key to start over.

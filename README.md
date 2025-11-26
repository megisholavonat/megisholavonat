# <img width="28" height="28" alt="favicon" src="https://github.com/user-attachments/assets/a195e843-0a36-4990-8280-0b3e426f3b08" /> Mégis hol a vonat?

**Magyar vonattérkép alkalmazás. Késési adatokkal és egyéb hasznos információkkal.** *// Hungarian train map application. Contains delay data and other useful information.*

<img width="655" height="385" alt="map" src="https://github.com/user-attachments/assets/6ae41972-7d48-4d9d-9ec7-7d401952ca11" />

---

A **Mégis hol a vonat?** valós időben, egy interaktív térképen mutatja a magyar vonatokat. Az alkalmazás az [EMMA](https://emma.mav.hu/) adatait használja, és egy könnyen használható felületen jeleníti meg azokat.

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
- Docker (or native Redis)

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
   REDIS_HOST=
   DEBUG=true (optional)
   ```

6. **Start Redis (if not running separate)**

   ```bash
   docker compose up -d
   ```

   This exposes Redis on `localhost:6379`.

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

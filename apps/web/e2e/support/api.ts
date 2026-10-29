import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page, Route } from "@playwright/test";

const FIXTURES = join(__dirname, "..", "fixtures");

function fixture<T = unknown>(name: string): T {
    return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;
}

/** Wall clock of the captured feed: every relative time is computed from it */
export const NOW = new Date("2026-10-29T02:00:00Z");

/** Vehicle ids in the fixtures, by the role they play in the tests */
export const TRAINS = {
    delayed: { id: "1:915504313395", number: "8", name: "8 RUTHENIA" },
    minor: { id: "1:915504700104", number: "6009", name: "6009 CÍVIS" },
    late: { id: "1:918061937275", number: "9", name: "9 TRANSCARPATHIA" },
    ontime: { id: "1:955514160253", number: "2909", name: "2909" },
    early: { id: "1:955501173350", number: "38319", name: "38319" },
    waiting: { id: "1:945514151113", number: "2619", name: "2619" },
    stale: { id: "1:945514150628", number: "6020", name: "6020" },
    hev: { id: "1:1141", number: "H8000", name: "H8000" },
} as const;

export type TrainRole = keyof typeof TRAINS;

export const STATIONS = {
    szolnok: { id: "005513748", name: "Szolnok" },
    eger: { id: "005512401", name: "Eger" },
} as const;

interface Station {
    id: string;
    name: string;
}

/** Lower-case and strip accents, like a forgiving station search */
function fold(text: string): string {
    return text
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase();
}

const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
    });

/**
 * A basemap style without tiles: the canvas shows only the background. The
 * empty source keeps the basemap's attribution, which must stay visible.
 */
const EMPTY_STYLE = {
    version: 8,
    name: "e2e",
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
        land: {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
            attribution:
                '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>',
        },
    },
    layers: [
        {
            id: "background",
            type: "background",
            paint: { "background-color": "#e8e8e8" },
        },
        { id: "land", type: "fill", source: "land" },
    ],
};

/**
 * Serves the API from the JSON fixtures, and keeps the page offline: the
 * basemap gets an empty style, tiles and fonts are answered empty, analytics
 * calls are swallowed and anything else outside the app is aborted.
 */
export async function mockApi(page: Page, baseURL: string) {
    const appHost = new URL(baseURL).host;
    /** Analytics calls the page made, for the consent tests */
    const analytics: string[] = [];
    const trains = fixture("trains.json");
    const details = Object.fromEntries(
        Object.entries(TRAINS).map(([role, { id }]) => [
            id,
            fixture(`train-${role}.json`),
        ]),
    );
    const boards = {
        departures: fixture("board-departures.json"),
        arrivals: fixture("board-arrivals.json"),
    };
    const stations = fixture<Station[]>("stations.json");
    const rankings = fixture<Record<string, unknown>>("rankings.json");

    await page.route(
        (url) => url.host !== appHost,
        (route) => route.abort(),
    );

    await page.route(/^https:\/\/tiles\.openfreemap\.org\/styles\//, (route) =>
        json(route, EMPTY_STYLE),
    );
    await page.route(/^https:\/\/[^/]*openfreemap\.org\/fonts\//, (route) =>
        route.fulfill({ status: 200, body: "" }),
    );
    await page.route(/openrailwaymap\.org/, (route) =>
        route.fulfill({ status: 204 }),
    );
    await page.route(/\/relay-OfoJ\//, (route) => {
        const url = route.request().url();
        // PostHog's lazily loaded extensions
        if (url.includes("/static/")) {
            return route.fulfill({ contentType: "text/javascript", body: "" });
        }
        analytics.push(url);
        return json(route, { status: 1 });
    });

    await page.route(/\/api\/v1\//, (route) => {
        const url = new URL(route.request().url());
        const path = url.pathname.replace(/^\/api/, "");
        const q = url.searchParams;
        const train = path.match(/^\/v1\/trains\/(.+)$/);

        if (path === "/v1/trains") return json(route, trains);
        if (train) {
            const detail = details[decodeURIComponent(train[1])];
            return detail
                ? json(route, detail)
                : json(route, { detail: "Not found" }, 404);
        }
        if (path === "/v1/stations") {
            const needle = fold(q.get("q") ?? "");
            const limit = Number(q.get("limit") ?? 8);
            return json(
                route,
                stations
                    .filter((s) => fold(s.name).includes(needle))
                    .slice(0, limit),
            );
        }
        // Every station gets Szolnok's board
        if (/^\/v1\/stations\/[^/]+\/departures$/.test(path)) {
            const kind =
                q.get("kind") === "arrivals" ? "arrivals" : "departures";
            return json(route, boards[kind]);
        }
        if (path === "/v1/journeys")
            return json(route, fixture("journey.json"));
        if (path === "/v1/rankings") {
            const key = `${q.get("kind") ?? "lines"}-${q.get("order") ?? "best"}`;
            return json(route, rankings[key] ?? rankings["lines-best"]);
        }
        if (path === "/v1/rankings/time-of-day") {
            return json(
                route,
                fixture(
                    q.get("stationId")
                        ? "time-of-day-szolnok.json"
                        : "time-of-day.json",
                ),
            );
        }
        if (path === "/v1/history/trains/8") {
            return json(route, fixture("history-train-8.json"));
        }
        if (path === `/v1/history/stations/${STATIONS.szolnok.id}/platforms`) {
            return json(route, fixture("platforms-szolnok.json"));
        }
        if (path === "/v1/posthog") return json(route, { key: "phc_e2e" });
        if (path === "/v1/alerts") return json(route, []);
        return json(route, { detail: "Not in the e2e fixtures" }, 404);
    });

    return { analytics };
}

// The API as the Next server sees it in e2e (API_URL): the station and train
// pages and the sitemap from the same JSON fixtures the browser mocks use,
// run summaries from fixtures/runs for the delay card pages, 404 for unknown
// stations, trains and runs, and 503 for everything else, so other
// server-side lookups fall back as without an API.

import { readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";

const PORT = Number(process.env.STUB_API_PORT ?? 3211);
const FIXTURES = join(import.meta.dirname, "..", "fixtures");
const RUNS = join(FIXTURES, "runs");
const fixture = (name) =>
    JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

/** The API's station search folding: accents off, punctuation a space */
const fold = (text) =>
    text
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .replace(/[^0-9a-z]+/g, " ")
        .trim();

const stations = fixture("stations.json");
const feed = fixture("trains.json");
const details = Object.fromEntries(
    readdirSync(FIXTURES)
        .filter((f) => /^train-[a-z]+\.json$/.test(f))
        .map((f) => fixture(f))
        .map((d) => [d.vehicleId, d]),
);
const boards = {
    departures: fixture("board-departures.json"),
    arrivals: fixture("board-arrivals.json"),
};
const histories = { 8: fixture("history-train-8.json") };
const historyWindow = { start: "2026-10-02", end: "2026-10-29", days: 28 };

function route(url) {
    const path = decodeURIComponent(url.pathname);
    const q = url.searchParams;
    if (path === "/v1/stations") {
        const needle = fold(q.get("q") ?? "");
        const exact = stations.filter((s) => fold(s.name) === needle);
        const rest = stations.filter(
            (s) => fold(s.name) !== needle && fold(s.name).includes(needle),
        );
        return [
            200,
            [...exact, ...rest].slice(0, Number(q.get("limit") ?? 10)),
        ];
    }
    const board = path.match(/^\/v1\/stations\/([^/]+)\/departures$/);
    if (board) {
        // Only Szolnok has a board; any other station is unknown
        if (board[1] !== boards.departures.station.id) {
            return [404, { detail: "Station not found" }];
        }
        return [
            200,
            boards[q.get("kind") === "arrivals" ? "arrivals" : "departures"],
        ];
    }
    if (path === "/v1/rankings/time-of-day") {
        return [
            200,
            fixture(
                q.get("stationId")
                    ? "time-of-day-szolnok.json"
                    : "time-of-day.json",
            ),
        ];
    }
    const history = path.match(/^\/v1\/history\/trains\/([^/]+)$/);
    if (history) {
        return [
            200,
            histories[history[1]] ?? {
                trainNumber: history[1],
                tripShortName: null,
                routeShortName: null,
                lineName: null,
                window: historyWindow,
                runs: 0,
                stations: [],
            },
        ];
    }
    if (path === "/v1/history/directory") {
        return [
            200,
            {
                window: historyWindow,
                stations: stations
                    .filter((s) => s.id.startsWith("0055"))
                    .map(({ id, name }) => ({ id, name })),
                trains: Object.values(details).map((d) => ({
                    trainNumber: d.trip.tripShortName.split(" ")[0],
                    tripShortName: d.trip.tripShortName,
                    routeShortName: d.trip.route.shortName,
                })),
            },
        ];
    }
    if (path === "/v1/trains") return [200, feed];
    const train = path.match(/^\/v1\/trains\/(.+)$/);
    if (train) {
        const detail = details[train[1]];
        return detail ? [200, detail] : [404, { detail: "Not found" }];
    }
    if (path === "/v1/alerts" || path === "/v1/alerts/disruptions") {
        return [200, []];
    }
    return null;
}

createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://stub");
    if (url.pathname === "/") {
        response.writeHead(200).end("ok");
        return;
    }
    const run = url.pathname.match(
        /^\/v1\/history\/runs\/([0-9A-Za-z]+)\/(\d{4}-\d{2}-\d{2})$/,
    );
    if (run) {
        try {
            const body = await readFile(join(RUNS, `${run[1]}-${run[2]}.json`));
            response.writeHead(200, { "content-type": "application/json" });
            response.end(body);
        } catch {
            response.writeHead(404, { "content-type": "application/json" });
            response.end(JSON.stringify({ detail: "Run not found" }));
        }
        return;
    }
    const answer = route(url);
    if (!answer) {
        response.writeHead(503).end();
        return;
    }
    const [status, body] = answer;
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
}).listen(PORT, "127.0.0.1");

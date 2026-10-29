// Re-captures the e2e fixtures from a running API and trims them.
// Usage: node e2e/capture-fixtures.mjs [apiUrl]   (default http://localhost:8000)
//
// The live feed changes all the time, so the vehicle ids below are only the
// ones seen when the fixtures were last captured. When re-capturing, pick
// new ids of the same kind (delayed, on time, early, waiting, HÉV, ...),
// update TRAINS and NOW in e2e/support/api.ts, and the station and train
// names the specs look for.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API = (process.argv[2] ?? "http://localhost:8000").replace(/\/$/, "");
const OUT = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

const SZOLNOK = "005513748";
const EGER = "005512401";

/** Vehicle id → role in the tests */
const TRAINS = {
    "1:915504313395": "delayed", // 8 RUTHENIA, +46, "Más vonat"
    "1:915504700104": "minor", // 6009, +4 with a reason
    "1:918061937275": "late", // 9 TRANSCARPATHIA, +8, on the Szolnok board
    "1:955514160253": "ontime", // 2909, 0
    "1:955501173350": "early", // 38319, -1
    "1:945514151113": "waiting", // 2619, waiting at its first stop
    "1:945514150628": "stale", // 6020, made time-stale below
    "1:1141": "hev", // H8000 HÉV
};
const STALE_FOR_S = 15 * 60;

async function get(path, query = {}) {
    const qs = new URLSearchParams(query).toString();
    const res = await fetch(`${API}${path}${qs ? `?${qs}` : ""}`);
    if (!res.ok) throw new Error(`${res.status} ${path}`);
    return res.json();
}

function write(name, data) {
    writeFileSync(join(OUT, name), `${JSON.stringify(data, null, 2)}\n`);
}

// Polyline (precision 5) decode/encode, to thin out route geometry
function decode(str) {
    const points = [];
    let index = 0;
    let lat = 0;
    let lng = 0;
    while (index < str.length) {
        for (const axis of [0, 1]) {
            let result = 0;
            let shift = 0;
            let byte;
            do {
                byte = str.charCodeAt(index++) - 63;
                result |= (byte & 0x1f) << shift;
                shift += 5;
            } while (byte >= 0x20);
            const delta = result & 1 ? ~(result >> 1) : result >> 1;
            if (axis === 0) lat += delta;
            else lng += delta;
        }
        points.push([lat, lng]);
    }
    return points;
}

function encode(points) {
    let out = "";
    let prev = [0, 0];
    for (const point of points) {
        for (const axis of [0, 1]) {
            let value = point[axis] - prev[axis];
            value = value < 0 ? ~(value << 1) : value << 1;
            while (value >= 0x20) {
                out += String.fromCharCode((0x20 | (value & 0x1f)) + 63);
                value >>= 5;
            }
            out += String.fromCharCode(value + 63);
        }
        prev = point;
    }
    return out;
}

function thin(polyline, max = 120) {
    const points = decode(polyline);
    if (points.length <= max) return polyline;
    const step = (points.length - 1) / (max - 1);
    const kept = Array.from(
        { length: max },
        (_, i) => points[Math.round(i * step)],
    );
    return encode(kept);
}

mkdirSync(OUT, { recursive: true });

// Feed: only the trains the tests use
const feed = await get("/v1/trains");
const now = Math.max(
    ...feed.features.map((f) => f.properties.lastUpdated ?? 0),
);
feed.features = feed.features
    .filter((f) => TRAINS[f.properties.vehicleId])
    .map((f) => {
        const p = { ...f.properties, routePolyline: null };
        if (TRAINS[p.vehicleId] === "stale") {
            p.lastUpdated -= STALE_FOR_S;
            p.isStale = true;
        }
        return { ...f, properties: p };
    });
write("trains.json", feed);

// Details
for (const [vehicleId, role] of Object.entries(TRAINS)) {
    const detail = await get(`/v1/trains/${vehicleId}`);
    if (detail.trip?.tripGeometry?.points) {
        detail.trip.tripGeometry.points = thin(detail.trip.tripGeometry.points);
    }
    if (role === "stale") detail.lastUpdated -= STALE_FOR_S;
    write(`train-${role}.json`, detail);
}

// Station board, with one canceled departure (MÁV rarely cancels at night)
const known = new Set(Object.keys(TRAINS));
for (const kind of ["departures", "arrivals"]) {
    const board = await get(`/v1/stations/${SZOLNOK}/departures`, {
        kind,
        limit: 30,
    });
    board.entries = board.entries.slice(0, 14).map((entry) => ({
        ...entry,
        vehicleId: known.has(entry.vehicleId) ? entry.vehicleId : null,
    }));
    if (kind === "departures") {
        const victim = board.entries.find((e) => !e.realtime);
        if (victim) victim.canceled = true;
    }
    write(`board-${kind}.json`, board);
}

// Station search: a handful of real results, filtered by the mock
const stations = new Map();
for (const q of ["Szolnok", "Keleti", "Nyugati", "Debrecen", "Eger", "Bud"]) {
    for (const s of await get("/v1/stations", { q, limit: 8 })) {
        stations.set(s.id, s);
    }
}
write("stations.json", [...stations.values()]);

// Journey Szolnok → Eger, with the transfer risks set (null at night)
const journey = await get("/v1/journeys", {
    from: SZOLNOK,
    to: EGER,
    limit: 5,
});
const risks = [
    ["tight", 0.35, "forecast"],
    ["safe", 0.02, "history"],
    ["likely_missed", 0.8, "forecast"],
    ["safe", 0.05, "history"],
    ["tight", 0.3, "history"],
];
let r = 0;
for (const itinerary of journey.itineraries) {
    for (const transfer of itinerary.transfers) {
        const [risk, missRisk, riskSource] = risks[r++ % risks.length];
        Object.assign(transfer, { risk, missRisk, riskSource });
    }
}
write("journey.json", journey);

// Stats. Rankings need a low sample floor on a young database.
const rankings = {};
for (const kind of ["lines", "stations", "trains"]) {
    for (const order of ["best", "worst"]) {
        rankings[`${kind}-${order}`] = await get("/v1/rankings", {
            kind,
            order,
            days: 30,
            limit: 10,
            minSamples: 10,
        });
    }
}
write("rankings.json", rankings);
write("time-of-day.json", await get("/v1/rankings/time-of-day", { days: 30 }));
write(
    "time-of-day-szolnok.json",
    await get("/v1/rankings/time-of-day", { days: 30, stationId: SZOLNOK }),
);
write("history-train-8.json", await get("/v1/history/trains/8", { days: 30 }));
write(
    "platforms-szolnok.json",
    await get(`/v1/history/stations/${SZOLNOK}/platforms`, { days: 30 }),
);

console.log(`Captured into ${OUT} (feed time ${now})`);

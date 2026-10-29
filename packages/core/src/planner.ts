import type {
    CityLeg,
    Itinerary,
    Station,
    TransitLeg,
} from "@megisholavonat/api-client";
import { normalizeSearchText } from "./search";

// Journey planner helpers shared by the web and the app

/** Pseudo-station of the planner: any Budapest station (see the API) */
export const ANY_BUDAPEST_ID = "budapest";

/** Deák Ferenc tér; the API plans "any Budapest station" from there */
export const ANY_BUDAPEST: Station = {
    id: ANY_BUDAPEST_ID,
    name: "Budapest",
    lat: 47.497912,
    lon: 19.054916,
};

export function isAnyBudapest(
    station: { id: string } | null | undefined,
): boolean {
    return station?.id === ANY_BUDAPEST_ID;
}

/**
 * The query names Budapest ("bu", "Budap", "budapest", "bp", "Bp."), so
 * the planner offers "Budapest (any station)" first.
 */
export function matchesBudapest(query: string): boolean {
    const q = normalizeSearchText(query.trim())
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    if (q.length < 2) return false;
    return "budapest".startsWith(q) || q === "bp";
}

const TWIN_SUFFIX = " vasútállomás";
const TWIN_DISTANCE_M = 300;

function distanceMeters(a: Station, b: Station): number {
    const rad = Math.PI / 180;
    const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
    const y = (b.lat - a.lat) * rad;
    return Math.hypot(x, y) * 6_371_000;
}

/**
 * Drops a tram-train stop in front of a station that is in the list too
 * ("Szeged vasútállomás" beside "Szeged"): the planner walks between them,
 * so both plan the same journeys. Station boards keep them apart, since
 * their departures differ.
 */
export function collapseTwinStations(stations: Station[]): Station[] {
    return stations.filter((station) => {
        if (!station.name.endsWith(TWIN_SUFFIX)) return true;
        const name = station.name.slice(0, -TWIN_SUFFIX.length);
        return !stations.some(
            (other) =>
                other !== station &&
                other.name === name &&
                distanceMeters(other, station) <= TWIN_DISTANCE_M,
        );
    });
}

type Leg = Itinerary["legs"][number];
export type TrainLeg = Extract<Leg, { type: "transit" }>;
export type CityRide = Extract<Leg, { type: "city" }>;

function trains(itinerary: Itinerary): TrainLeg[] {
    return itinerary.legs.filter(
        (leg): leg is TrainLeg => leg.type === "transit",
    );
}

/** Trains and city rides in order, without the walks. */
export function legChain(itinerary: Itinerary): (TrainLeg | CityRide)[] {
    return itinerary.legs.filter(
        (leg): leg is TrainLeg | CityRide => leg.type !== "walk",
    );
}

/**
 * Where the first train leaves from, when that is not the station asked for
 * (a bus to Zugló for the Szeged train), or always from any Budapest
 * station; null otherwise.
 */
export function boardingElsewhere(
    itinerary: Itinerary,
    fromId: string | null | undefined,
): string | null {
    const first = trains(itinerary)[0];
    if (!first) return null;
    if (fromId !== ANY_BUDAPEST_ID && first.fromStop.id === fromId) return null;
    return first.fromStop.name;
}

/** Where the last train arrives, when that is not the station asked for. */
export function alightingElsewhere(
    itinerary: Itinerary,
    toId: string | null | undefined,
): string | null {
    const last = trains(itinerary).at(-1);
    if (!last) return null;
    if (toId !== ANY_BUDAPEST_ID && last.toStop.id === toId) return null;
    return last.toStop.name;
}

/** Colours of a city line's badge, from the feed ("009EE3" for BKK buses). */
export function cityLineColors(leg: CityLeg): {
    background: string;
    text: string;
} | null {
    const hex = /^[0-9a-f]{6}$/i;
    if (!leg.routeColor || !hex.test(leg.routeColor)) return null;
    const background = `#${leg.routeColor}`;
    if (leg.routeTextColor && hex.test(leg.routeTextColor)) {
        return { background, text: `#${leg.routeTextColor}` };
    }
    // Black or white, whichever reads better (relative luminance)
    const [r, g, b] = [0, 2, 4].map((i) => {
        const c =
            Number.parseInt(leg.routeColor?.slice(i, i + 2) ?? "0", 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    const luminance = 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
    return { background, text: luminance > 0.4 ? "#000000" : "#FFFFFF" };
}

export type CityMode = "metro" | "tram" | "trolleybus" | "bus" | "rail";

/** What a city ride is, for its icon and its spoken label. */
export function cityMode(leg: Pick<CityLeg, "mode">): CityMode {
    switch (leg.mode) {
        case "SUBWAY":
            return "metro";
        case "TRAM":
            return "tram";
        case "TROLLEYBUS":
            return "trolleybus";
        case "RAIL":
        case "SUBURBAN_RAILWAY":
            return "rail";
        default:
            return "bus";
    }
}

/** A train leg's number, a city ride's line: the chain's labels. */
export function chainLabel(leg: TrainLeg | CityRide): string {
    return leg.type === "city" ? leg.line : (leg as TransitLeg).trainNumber;
}

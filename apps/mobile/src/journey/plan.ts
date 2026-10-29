import type {
    Itinerary,
    Transfer,
    TransitLeg,
} from "@megisholavonat/api-client";
import type { DelayLevel } from "@megisholavonat/core/delay";

// Pure helpers of the journey planner. Unit tested.

/** What a transfer shows: the API's level, or a cancelled train. */
export type RiskKind = "safe" | "tight" | "likely_missed" | "canceled";

export function transferRisk(transfer: Transfer): RiskKind | null {
    if (transfer.riskSource === "canceled") return "canceled";
    return transfer.risk ?? null;
}

/** Colour on the delay scale: safe is blue like on time, missed true red. */
export function riskColorLevel(kind: RiskKind): DelayLevel {
    switch (kind) {
        case "safe":
            return "onTime";
        case "tight":
            return "moderate";
        default:
            return "severe";
    }
}

const RISK_ORDER: Record<RiskKind, number> = {
    safe: 0,
    tight: 1,
    likely_missed: 2,
    canceled: 3,
};

/** The riskiest transfer of a journey, for its summary. */
export function worstRisk(transfers: readonly Transfer[]): RiskKind | null {
    let worst: RiskKind | null = null;
    for (const transfer of transfers) {
        const kind = transferRisk(transfer);
        if (kind && (!worst || RISK_ORDER[kind] > RISK_ORDER[worst])) {
            worst = kind;
        }
    }
    return worst;
}

type Leg = Itinerary["legs"][number];
export type Ride = Extract<Leg, { type: "transit" }>;
export type Walk = Extract<Leg, { type: "walk" }>;
export type City = Extract<Leg, { type: "city" }>;

export function isRide(leg: Leg): leg is Ride {
    return leg.type === "transit";
}

export function rides(itinerary: Itinerary): Ride[] {
    return itinerary.legs.filter(isRide);
}

/** Live delay of a ride in minutes, or null without live data. */
export function rideDelay(leg: TransitLeg): number | null {
    if (!leg.realtime || leg.canceled) return null;
    return Math.max(0, leg.delayMinutes);
}

export function durationParts(minutes: number): {
    hours: number;
    minutes: number;
} {
    const total = Math.max(0, Math.round(minutes));
    return { hours: Math.floor(total / 60), minutes: total % 60 };
}

export type Step =
    | { kind: "ride"; key: string; leg: Ride }
    | { kind: "walk"; key: string; leg: Walk }
    | { kind: "city"; key: string; leg: City }
    | { kind: "transfer"; key: string; transfer: Transfer };

/** Legs in order, with each transfer right after the train it leaves. */
export function steps(itinerary: Itinerary): Step[] {
    const byFromLeg = new Map(itinerary.transfers.map((t) => [t.fromLeg, t]));
    const out: Step[] = [];
    itinerary.legs.forEach((leg, index) => {
        if (isRide(leg)) {
            out.push({ kind: "ride", key: `ride-${index}`, leg });
            const transfer = byFromLeg.get(index);
            if (transfer) {
                out.push({
                    kind: "transfer",
                    key: `transfer-${index}`,
                    transfer,
                });
            }
        } else if (leg.type === "city") {
            out.push({ kind: "city", key: `city-${index}`, leg });
        } else {
            out.push({ kind: "walk", key: `walk-${index}`, leg });
        }
    });
    return out;
}

export function itineraryKey(itinerary: Itinerary): string {
    return rides(itinerary)
        .map((leg) => `${leg.tripId}@${leg.scheduledDeparture}`)
        .join("|");
}

/** The `time` query parameter: null means now. */
export function timeParam(time: number | null): string | undefined {
    return time === null ? undefined : new Date(time).toISOString();
}

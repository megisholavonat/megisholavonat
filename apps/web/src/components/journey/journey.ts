import type {
    Itinerary,
    Transfer,
    TransitLeg,
} from "@megisholavonat/api-client";
import { secondsToMinutes } from "@megisholavonat/core/delay";

export type RiskLevel = NonNullable<Transfer["risk"]>;

const ORDER: RiskLevel[] = ["safe", "tight", "likely_missed"];

/** Same palette as delays: safe is the on-time blue, likely missed true red. */
export const RISK_TEXT: Record<RiskLevel, string> = {
    safe: "text-delay-on-time",
    tight: "text-delay-moderate",
    likely_missed: "text-delay-severe",
};

export const RISK_FILL: Record<RiskLevel, string> = {
    safe: "bg-delay-on-time-fill",
    tight: "bg-delay-moderate-fill",
    likely_missed: "bg-delay-severe-fill",
};

export const RISK_TINT: Record<RiskLevel, string> = {
    safe: "bg-delay-on-time-tint",
    tight: "bg-delay-moderate-tint",
    likely_missed: "bg-delay-severe-tint",
};

/** The riskiest transfer of a journey, if any transfer has a known risk. */
export function worstTransfer(transfers: Transfer[]): Transfer | null {
    let worst: Transfer | null = null;
    for (const transfer of transfers) {
        if (!transfer.risk) continue;
        if (
            !worst?.risk ||
            ORDER.indexOf(transfer.risk) > ORDER.indexOf(worst.risk)
        ) {
            worst = transfer;
        }
    }
    return worst;
}

export type Ride = Extract<Itinerary["legs"][number], { type: "transit" }>;

export function rides(itinerary: Itinerary): Ride[] {
    return itinerary.legs.filter((leg): leg is Ride => leg.type === "transit");
}

/** Live delay of a leg in minutes, at departure and at arrival. */
export function legDelays(leg: TransitLeg): {
    departure: number;
    arrival: number;
    live: boolean;
} {
    return {
        departure: secondsToMinutes(
            leg.expectedDeparture - leg.scheduledDeparture,
        ),
        arrival: secondsToMinutes(leg.expectedArrival - leg.scheduledArrival),
        live: leg.realtime || leg.delaySource === "gps",
    };
}

/**
 * Minutes to change between two rides, from the very times the legs show:
 * the arrival and departure times printed (scheduled), and the same two
 * moved by their live delays (expected). Null when either leg is not a ride.
 */
export function transferGap(
    from: Itinerary["legs"][number] | undefined,
    to: Itinerary["legs"][number] | undefined,
): { scheduled: number; expected: number } | null {
    if (from?.type !== "transit" || to?.type !== "transit") return null;
    const arrive = legDelays(from).arrival;
    const leave = legDelays(to).departure;
    const scheduled = Math.round(
        (to.scheduledDeparture - from.scheduledArrival) / 60,
    );
    return {
        scheduled: Math.max(0, scheduled),
        expected: Math.max(0, scheduled + leave - arrive),
    };
}

import type { Disruption } from "@megisholavonat/api-client";

// Line and network disruptions from /v1/alerts/disruptions: which ones touch
// a train, a station or the user's own trains, and in what order to list
// them. Shared by the web and the mobile app.

/** What the user rides: a followed train and the stations it is boarded or left at. */
export interface Interest {
    /** Train number, "2909" */
    trainNumber?: string | null;
    /** UIC station codes */
    stationIds?: readonly (string | null | undefined)[];
}

const SEVERITY_RANK: Record<Disruption["severity"], number> = {
    high: 0,
    medium: 1,
    low: 2,
};

/** "2909 személyvonat" -> "2909", "H1500 HÉV" -> "H1500" */
function numberOf(tripShortName: string | null | undefined): string | null {
    return tripShortName?.trim().split(/\s+/)[0] || null;
}

/** Station ids a disruption names: its stations and both ends of its stretch. */
export function disruptionStationIds(d: Disruption): Set<string> {
    const ids = new Set(d.stations.map((s) => s.id));
    if (d.segment?.fromId) ids.add(d.segment.fromId);
    if (d.segment?.toId) ids.add(d.segment.toId);
    return ids;
}

export function isDisruptionActive(d: Disruption, nowS: number): boolean {
    return (
        (d.start == null || d.start <= nowS) && (d.end == null || nowS <= d.end)
    );
}

/**
 * A train is affected when the disruption lists its trip or train number,
 * or when it calls at both ends of the disrupted stretch.
 */
export function affectsTrain(
    d: Disruption,
    train: {
        tripId?: string | null;
        tripShortName?: string | null;
        stationIds: readonly (string | null | undefined)[];
    },
): boolean {
    if (train.tripId && d.trips.some((t) => t.tripId === train.tripId)) {
        return true;
    }
    const number = numberOf(train.tripShortName);
    if (number && d.trips.some((t) => numberOf(t.tripShortName) === number)) {
        return true;
    }
    const { fromId, toId } = d.segment ?? {};
    if (!fromId || !toId) return false;
    return train.stationIds.includes(fromId) && train.stationIds.includes(toId);
}

/** The station is one the disruption names, or an end of its stretch. */
export function affectsStation(d: Disruption, stationId: string): boolean {
    return disruptionStationIds(d).has(stationId);
}

/** The disruption touches one of the user's trains or stations. */
export function affectsInterests(
    d: Disruption,
    interests: readonly Interest[],
): boolean {
    if (interests.length === 0) return false;
    const stations = disruptionStationIds(d);
    const numbers = new Set(d.trips.map((t) => numberOf(t.tripShortName)));
    return interests.some(
        (i) =>
            (i.trainNumber != null && numbers.has(i.trainNumber)) ||
            (i.stationIds ?? []).some((id) => id != null && stations.has(id)),
    );
}

/**
 * Most relevant first: the user's own trains and stations, then the worst,
 * then the newest. Returns the list with a `mine` flag per item.
 */
export function sortDisruptions(
    list: readonly Disruption[],
    interests: readonly Interest[],
): { disruption: Disruption; mine: boolean }[] {
    return list
        .map((disruption) => ({
            disruption,
            mine: affectsInterests(disruption, interests),
        }))
        .sort(
            (a, b) =>
                Number(b.mine) - Number(a.mine) ||
                SEVERITY_RANK[a.disruption.severity] -
                    SEVERITY_RANK[b.disruption.severity] ||
                (b.disruption.start ?? 0) - (a.disruption.start ?? 0) ||
                a.disruption.id.localeCompare(b.disruption.id),
        );
}

/**
 * Line glyphs to show, at most `max`: named lines (S50, H8) first, one
 * glyph per category for the rest. `more` is how many were left out.
 */
export function disruptionLines(
    d: Disruption,
    max = 4,
): { lines: Disruption["lines"]; more: number } {
    return {
        lines: d.lines.slice(0, max),
        more: Math.max(0, d.lines.length - max),
    };
}

// The kind of a stop that is not a railway station (HÉV, tram-train,
// Children's Railway): a mark in the shape of its vehicles on the map (square
// HÉV, tram-train with pointed ends, round trains) and a short label.

import type { Station } from "@megisholavonat/api-client";
import {
    isOtherStop,
    type StationType,
    stationType,
} from "@megisholavonat/core/stationType";
import { Signpost } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/** The marker shape of each kind of stop, drawn in a 20×20 box. */
function Shape({ type }: { type: StationType }) {
    if (type === "hev") {
        return <rect x="4" y="4" width="12" height="12" rx="2.5" />;
    }
    if (type === "tramtrain") {
        return <path d="M6 5h8l4 5-4 5H6l-4-5z" strokeLinejoin="round" />;
    }
    return <circle cx="10" cy="10" r="6" />;
}

/**
 * A stop's mark in lists: the signpost for railway stations, as before, and
 * the vehicle shape for the other kinds.
 */
export function StationTypeIcon({
    station,
    className,
}: {
    station: Pick<Station, "type">;
    className?: string;
}) {
    if (!isOtherStop(station)) {
        return <Signpost className={className} aria-hidden />;
    }
    return (
        <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className={className}
            aria-hidden="true"
        >
            <Shape type={stationType(station)} />
        </svg>
    );
}

/** "HÉV-megálló", "villamos-megálló", ...; nothing for railway stations. */
export function StationTypeLabel({
    station,
    className,
}: {
    station: Pick<Station, "type">;
    className?: string;
}) {
    const t = useTranslations("StationType");
    if (!isOtherStop(station)) return null;
    return (
        <span className={cn("text-caption text-ink-2", className)}>
            {t(stationType(station))}
        </span>
    );
}

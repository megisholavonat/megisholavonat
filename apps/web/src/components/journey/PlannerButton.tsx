"use client";

import type { Station } from "@megisholavonat/api-client";
import {
    type PlannerParam,
    plannerLink,
    plannerSearch,
} from "@megisholavonat/core/links";
import { ANY_BUDAPEST } from "@megisholavonat/core/planner";
import { Route as RouteIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { buttonClass } from "@/components/ui/Button";

// The planner's entry points live apart from the planner itself, which is
// loaded only when it opens

export interface PlannerState {
    from: Station | null;
    to: Station | null;
    /** Local Budapest time "YYYY-MM-DDTHH:mm", or null for now */
    time: string | null;
    arriveBy: boolean;
}

/** A station known by id only, until its name is looked up. */
export function stationStub(id: string): Station {
    return id === ANY_BUDAPEST.id
        ? ANY_BUDAPEST
        : { id, name: "", lat: 0, lon: 0 };
}

/**
 * The planner of a shared link (`plannerLink` in core links), its stations
 * known by id until their boards are loaded. Null when it names neither end.
 */
export function plannerFromParams(
    params: URLSearchParams,
): PlannerState | null {
    const link = plannerLink(params);
    if (!link) return null;
    return {
        from: link.from ? stationStub(link.from) : null,
        to: link.to ? stationStub(link.to) : null,
        time: link.time,
        arriveBy: link.arriveBy,
    };
}

/** The planner's query parameters, so a planned journey can be shared */
export function plannerParams(
    state: PlannerState,
): Partial<Record<PlannerParam, string>> {
    return plannerSearch({
        ...state,
        from: state.from?.id ?? null,
        to: state.to?.id ?? null,
    });
}

export function usePlannerState() {
    const [state, setState] = useState<PlannerState>({
        from: null,
        to: null,
        time: null,
        arriveBy: false,
    });
    return [state, setState] as const;
}

/** Opens the planner: a round button next to the search. */
export function PlannerButton({
    onClick,
    onIntent,
    className,
}: {
    onClick: () => void;
    /** A tap or click is coming: start loading the planner */
    onIntent?: () => void;
    className?: string;
}) {
    const t = useTranslations("Journey");
    return (
        <button
            type="button"
            onClick={onClick}
            onPointerEnter={onIntent}
            onPointerDown={onIntent}
            onFocus={onIntent}
            aria-label={t("open")}
            title={t("open")}
            className={buttonClass("icon", className)}
        >
            <RouteIcon className="size-5" aria-hidden />
        </button>
    );
}

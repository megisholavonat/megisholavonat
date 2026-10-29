"use client";

import type { Station } from "@megisholavonat/api-client";
import { ANY_BUDAPEST } from "@megisholavonat/core/planner";
import { Route as RouteIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { cn } from "@/lib/utils";

// The planner's entry points live apart from the planner itself, which is
// loaded only when it opens

export interface PlannerState {
    from: Station | null;
    to: Station | null;
    /** Local Budapest time "YYYY-MM-DDTHH:mm", or null for now */
    time: string | null;
    arriveBy: boolean;
}

/** The planner's query parameters, so a planned journey can be shared */
export const PLANNER_PARAMS = ["from", "to", "time", "arriveBy"] as const;
type PlannerParam = (typeof PLANNER_PARAMS)[number];

const STATION_PARAM = /^(\d{9}|budapest)$/;
const TIME_PARAM = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** A station known by id only, until its name is looked up. */
export function stationStub(id: string): Station {
    return id === ANY_BUDAPEST.id
        ? ANY_BUDAPEST
        : { id, name: "", lat: 0, lon: 0 };
}

/**
 * The planner of a shared link: `?from=005510017&to=budapest&time=
 * 2026-10-30T07:00&arriveBy=1`, a UIC code or `budapest` at either end.
 * Null when it names neither end.
 */
export function plannerFromParams(
    params: URLSearchParams,
): PlannerState | null {
    const station = (name: "from" | "to") => {
        const id = params.get(name);
        return id && STATION_PARAM.test(id) ? stationStub(id) : null;
    };
    const from = station("from");
    const to = station("to");
    if (!from && !to) return null;
    const time = params.get("time");
    return {
        from,
        to,
        time: time && TIME_PARAM.test(time) ? time : null,
        arriveBy: params.get("arriveBy") === "1",
    };
}

export function plannerParams(
    state: PlannerState,
): Partial<Record<PlannerParam, string>> {
    const params: Partial<Record<PlannerParam, string>> = {};
    if (state.from) params.from = state.from.id;
    if (state.to) params.to = state.to.id;
    if (state.time) params.time = state.time;
    if (state.arriveBy) params.arriveBy = "1";
    return params;
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
            className={cn(
                "flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-surface-2 text-ink pressable transition-colors hover:bg-line",
                className,
            )}
        >
            <RouteIcon className="size-5" aria-hidden />
        </button>
    );
}

"use client";

import type { Station } from "@megisholavonat/api-client";
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

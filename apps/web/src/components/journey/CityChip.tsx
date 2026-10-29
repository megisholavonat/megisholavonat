import type { CityLeg } from "@megisholavonat/api-client";
import {
    type CityMode,
    cityLineColors,
    cityMode,
} from "@megisholavonat/core/planner";
import { Bus, BusFront, TrainFront, TramFront } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const ICONS: Record<Exclude<CityMode, "metro">, typeof Bus> = {
    tram: TramFront,
    trolleybus: BusFront,
    bus: Bus,
    rail: TrainFront,
};

/**
 * A metro, tram or bus line as a badge in its own colours ("M2", "8E",
 * "4-6"). Metro lines are named with their M, the way the stations sign
 * them; other lines get a small icon of their vehicle.
 */
export function CityChip({
    leg,
    className,
}: {
    leg: Pick<CityLeg, "mode" | "line" | "routeColor" | "routeTextColor">;
    className?: string;
}) {
    const t = useTranslations("Journey");
    const mode = cityMode(leg);
    const colors = cityLineColors(leg as CityLeg);
    const Icon = mode === "metro" ? null : ICONS[mode];
    return (
        <span
            role="img"
            aria-label={`${t(`city_${mode}`)} ${leg.line}`}
            title={`${t(`city_${mode}`)} ${leg.line}`}
            className={cn(
                "tnum inline-flex h-5 shrink-0 items-center gap-0.5 px-1.5 text-caption leading-none font-bold",
                mode === "metro" ? "rounded-[5px]" : "rounded-[3px]",
                !colors && "bg-surface-2 text-ink",
                className,
            )}
            style={
                colors
                    ? { backgroundColor: colors.background, color: colors.text }
                    : undefined
            }
        >
            {Icon && <Icon className="size-3 shrink-0" aria-hidden />}
            {leg.line}
        </span>
    );
}

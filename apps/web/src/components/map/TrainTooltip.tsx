import type { TrainFeatureProperties } from "@megisholavonat/api-client";
import { useTranslations } from "next-intl";
import { markerDisplay } from "@/components/map/markerState";
import { DelayText } from "@/components/ui/Delay";
import { RouteGlyph } from "@/components/ui/RouteGlyph";
import { trainName, trainNumber } from "@/lib/train";

/** Hover card on desktop and cluster list row: glyph, number, name, delay. */
export function TrainTooltip({
    featureProperties: props,
}: {
    featureProperties: TrainFeatureProperties;
}) {
    const t = useTranslations("Map");
    const name = trainName(props.tripShortName);
    const { state, delay } = markerDisplay(props, Date.now() / 1000);
    return (
        <div className="flex items-center gap-1.5 py-0.5 text-sm font-semibold whitespace-nowrap">
            <RouteGlyph routeShortName={props.routeShortName} />
            <span className="tnum">{trainNumber(props.tripShortName)}</span>
            {name && <span className="font-medium text-ink-2">{name}</span>}
            {state === "inactive" ? (
                <span className="font-medium text-stale">{t("inactive")}</span>
            ) : (
                <DelayText delay={delay} stale={state === "stale"} />
            )}
        </div>
    );
}

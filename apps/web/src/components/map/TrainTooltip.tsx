import type { TrainFeatureProperties } from "@megisholavonat/api-client";
import { delayLabel } from "@megisholavonat/core/display";
import { trainName, trainNumber } from "@megisholavonat/core/trainName";
import { useTranslations } from "next-intl";
import { markerDisplay } from "@/components/map/markerState";
import { DelayText } from "@/components/ui/Delay";
import { RouteGlyph } from "@/components/ui/RouteGlyph";

/**
 * Hover card on desktop and cluster list row: glyph, number, name, delay.
 * An on-time train (up to +5) shows no delay.
 */
export function TrainTooltip({
    featureProperties: props,
}: {
    featureProperties: TrainFeatureProperties;
}) {
    const t = useTranslations("Map");
    const name = trainName(props.tripShortName);
    const { state, delay } = markerDisplay(props, Date.now() / 1000);
    const stale = state === "stale";
    const onTime = delay != null && delayLabel(delay, stale).text == null;
    return (
        <div className="flex items-center gap-1.5 py-0.5 text-sm font-semibold whitespace-nowrap">
            <RouteGlyph routeShortName={props.routeShortName} />
            <span className="tnum">{trainNumber(props.tripShortName)}</span>
            {name && <span className="font-medium text-ink-2">{name}</span>}
            {state === "inactive" ? (
                <span className="font-medium text-stale">{t("inactive")}</span>
            ) : (
                !onTime && <DelayText delay={delay} stale={stale} />
            )}
        </div>
    );
}

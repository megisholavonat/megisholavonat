import type { TrainFeatureProperties } from "@megisholavonat/api-client";
import { TrainDelay } from "@/components/ui/Delay";
import { RouteGlyph } from "@/components/ui/RouteGlyph";
import { trainName, trainNumber } from "@/lib/train";

/** Hover card on desktop: route glyph, number, name and delay. */
export function TrainTooltip({
    featureProperties: props,
}: {
    featureProperties: TrainFeatureProperties;
}) {
    const name = trainName(props.tripShortName);
    return (
        <div className="flex items-center gap-1.5 py-0.5 text-sm font-semibold whitespace-nowrap">
            <RouteGlyph routeShortName={props.routeShortName} />
            <span className="tnum">{trainNumber(props.tripShortName)}</span>
            {name && <span className="font-medium text-ink-2">{name}</span>}
            <TrainDelay train={props} />
        </div>
    );
}

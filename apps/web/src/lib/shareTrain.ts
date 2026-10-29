import type { Locale } from "@megisholavonat/core/i18n";
import { shareUrl, trainShareText } from "@megisholavonat/core/share";
import { formatSecondsAsTime } from "@megisholavonat/core/time";
import type { TrainView } from "@/components/train/useTrainView";
import { shareStatus } from "@/lib/og/model";
import { destinationOf, trainNumber } from "@/lib/train";

/** Title, short text and link for sharing a train. */
export function trainShareData(
    view: TrainView,
    locale: Locale,
    origin: string = window.location.origin,
): { title: string; text: string; url: string } {
    const { vehicle } = view;
    const number = trainNumber(vehicle.trip.tripShortName);
    // The sheet's own state and delay (core trainDisplay): a cancelled,
    // arrived or stale train has no live delay to share
    const status = shareStatus(vehicle, view.display);
    const waiting = status === "waiting";
    const next = waiting ? (view.stops[0] ?? null) : view.next;
    return {
        title: `${number} → ${destinationOf(vehicle)}`,
        text: trainShareText(locale, {
            number,
            delay:
                status === "running"
                    ? Math.max(0, Math.round(view.display.delay ?? 0))
                    : 0,
            waiting,
            status,
            next: next
                ? {
                      name: next.name,
                      time: formatSecondsAsTime(next.timing.expected),
                      estimated: !next.passed && next.timing.estimated,
                  }
                : null,
        }),
        url: shareUrl(origin, locale, { vehicleId: vehicle.vehicleId }),
    };
}

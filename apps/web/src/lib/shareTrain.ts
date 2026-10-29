import type { Locale } from "@megisholavonat/core/i18n";
import { shareUrl, trainShareText } from "@megisholavonat/core/share";
import { formatSecondsAsTime } from "@megisholavonat/core/time";
import type { TrainView } from "@/components/train/useTrainView";
import { beforeDeparture, destinationOf, trainNumber } from "@/lib/train";

/** Title, short text and link for sharing a train. */
export function trainShareData(
    view: TrainView,
    locale: Locale,
    origin: string = window.location.origin,
): { title: string; text: string; url: string } {
    const { vehicle } = view;
    const number = trainNumber(vehicle.trip.tripShortName);
    const waiting = beforeDeparture(vehicle);
    const next = waiting ? (view.stops[0] ?? null) : view.next;
    return {
        title: `${number} → ${destinationOf(vehicle)}`,
        text: trainShareText(locale, {
            number,
            delay: Math.max(0, Math.round(vehicle.delay)),
            waiting,
            next: next
                ? {
                      name: next.name,
                      time: formatSecondsAsTime(next.timing.expected),
                  }
                : null,
        }),
        url: shareUrl(origin, locale, { vehicleId: vehicle.vehicleId }),
    };
}

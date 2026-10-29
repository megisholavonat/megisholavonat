import type { Locale } from "@megisholavonat/core/i18n";
import { shareUrl } from "@megisholavonat/core/share";
import { trainNumber } from "@megisholavonat/core/trainName";
import type { TrainView } from "@/components/train/useTrainView";
import { destinationOf } from "@/lib/train";

/**
 * What sharing a train hands over: its link and a title, no prefilled
 * message (people delete it). The link's preview (og title, description
 * and image, see lib/og) tells the delay and the next stop.
 */
export function trainShareData(
    view: TrainView,
    locale: Locale,
    origin: string = window.location.origin,
): { title: string; url: string } {
    const { vehicle } = view;
    const number = trainNumber(vehicle.trip.tripShortName);
    return {
        title: `${number} → ${destinationOf(vehicle)}`,
        url: shareUrl(origin, locale, { vehicleId: vehicle.vehicleId }),
    };
}

/**
 * Shares a link through the share sheet (title and link only), or copies
 * the bare link where there is none. Null when the sheet was dismissed.
 */
export async function shareLink(data: {
    title: string;
    url: string;
}): Promise<"shared" | "copied" | null> {
    try {
        if (navigator.share) {
            await navigator.share({ title: data.title, url: data.url });
            return "shared";
        }
        await navigator.clipboard.writeText(data.url);
        return "copied";
    } catch {
        // Share sheet dismissed
        return null;
    }
}

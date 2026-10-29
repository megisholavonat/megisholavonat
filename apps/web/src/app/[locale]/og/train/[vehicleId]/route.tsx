import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";
import { genericImage, TRAIN_SKETCH_ASPECT, trainImage } from "@/lib/og/images";
import { trainCard } from "@/lib/og/model";
import { fetchTrain } from "@/lib/og/server";
import { decodeParam } from "@/lib/utils";

type Params = Promise<{ locale: string; vehicleId: string }>;

/** Preview of a train; the app card once the train is gone. */
export async function GET(_request: Request, { params }: { params: Params }) {
    const { locale: raw, vehicleId } = await params;
    const locale = hasLocale(routing.locales, raw)
        ? raw
        : routing.defaultLocale;
    const vehicle = await fetchTrain(decodeParam(vehicleId));
    if (!vehicle) return genericImage(locale);
    return trainImage(
        trainCard(vehicle, new Date(), TRAIN_SKETCH_ASPECT),
        locale,
    );
}

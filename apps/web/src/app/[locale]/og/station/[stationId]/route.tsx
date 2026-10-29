import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";
import { genericImage, stationImage } from "@/lib/og/images";
import { stationCard } from "@/lib/og/model";
import { fetchBoard } from "@/lib/og/server";
import { decodeParam } from "@/lib/utils";

type Params = Promise<{ locale: string; stationId: string }>;

/** Preview of a station's next departures; the app card if it is unknown. */
export async function GET(_request: Request, { params }: { params: Params }) {
    const { locale: raw, stationId } = await params;
    const locale = hasLocale(routing.locales, raw)
        ? raw
        : routing.defaultLocale;
    const board = await fetchBoard(decodeParam(stationId));
    if (!board) return genericImage(locale);
    return stationImage(stationCard(board), locale);
}

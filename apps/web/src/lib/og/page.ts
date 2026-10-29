import type { Locale } from "@megisholavonat/core/i18n";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { buildMetadata, type Preview, previewTarget } from "@/lib/og/metadata";
import { stationCard, trainCard } from "@/lib/og/model";
import {
    fetchBoard,
    fetchTrain,
    requestOrigin,
    SEARCH_HEADER,
} from "@/lib/og/server";

/**
 * Metadata of the map page for its `?vehicleId=` / `?station=` query. The
 * page is a client component, so the proxy hands the query over in a header.
 */
export async function pageMetadata(locale: Locale): Promise<Metadata> {
    const requestHeaders = await headers();
    const origin = requestOrigin(requestHeaders);
    const target = previewTarget(requestHeaders.get(SEARCH_HEADER) ?? "");
    const t = await getTranslations({ locale, namespace: "Home" });

    let preview: Preview = { kind: "none" };
    if (target && "vehicleId" in target) {
        const vehicle = await fetchTrain(origin, target.vehicleId);
        if (vehicle) {
            preview = {
                kind: "train",
                vehicleId: target.vehicleId,
                card: trainCard(vehicle),
            };
        }
    } else if (target) {
        const board = await fetchBoard(origin, target.station);
        if (board) {
            preview = {
                kind: "station",
                stationId: target.station,
                card: stationCard(board),
            };
        }
    }
    return buildMetadata({
        locale,
        origin,
        appTitle: t("app_title"),
        appDescription: t("app_description"),
        preview,
    });
}

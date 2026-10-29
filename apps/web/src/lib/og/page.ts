import type { Locale } from "@megisholavonat/core/i18n";
import { mapTarget } from "@megisholavonat/core/links";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { buildMetadata, type Preview } from "@/lib/og/metadata";
import { stationCard, trainCard } from "@/lib/og/model";
import {
    fetchBoard,
    fetchTrain,
    SEARCH_HEADER,
    siteUrl,
} from "@/lib/og/server";

/** The preview a page query asks for; none when it is unknown or fails. */
async function previewOf(search: string): Promise<Preview> {
    try {
        const target = mapTarget(new URLSearchParams(search));
        if (target && "vehicleId" in target) {
            const vehicle = await fetchTrain(target.vehicleId);
            if (vehicle) {
                return {
                    kind: "train",
                    vehicleId: target.vehicleId,
                    card: trainCard(vehicle),
                };
            }
        } else if (target) {
            const board = await fetchBoard(target.station);
            if (board) {
                return {
                    kind: "station",
                    stationId: target.station,
                    card: stationCard(board),
                };
            }
        }
    } catch {
        // Odd data never breaks the page: it gets the app's own card
    }
    return { kind: "none" };
}

/**
 * Metadata of the map page for its `?vehicleId=` / `?station=` query. The
 * page is a client component, so the proxy hands the query over in a header.
 * Links and the API come from the environment, never from request headers.
 */
export async function pageMetadata(locale: Locale): Promise<Metadata> {
    const requestHeaders = await headers();
    const t = await getTranslations({ locale, namespace: "Home" });
    return buildMetadata({
        locale,
        origin: siteUrl(),
        appTitle: t("app_title"),
        appDescription: t("app_description"),
        preview: await previewOf(requestHeaders.get(SEARCH_HEADER) ?? ""),
    });
}

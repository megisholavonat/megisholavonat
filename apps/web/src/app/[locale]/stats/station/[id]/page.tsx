import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { StationHistoryPage } from "@/components/stats/StationHistory";
import { decodeParam } from "@/lib/utils";
import { stationName, statsMetadata } from "../../metadata";

type Params = Promise<{ locale: string; id: string }>;

export async function generateMetadata({ params }: { params: Params }) {
    const { locale, id: raw } = await params;
    const id = decodeParam(raw);
    const name = await stationName(id);
    const t = await getTranslations({ locale, namespace: "Stats" });
    return statsMetadata({
        locale,
        path: `/stats/station/${encodeURIComponent(id)}`,
        title: name === null ? t("not_found") : name,
        description: name
            ? t("station_description", { station: name })
            : undefined,
        missing: name === null,
    });
}

/** A station the API does not know ("999") is a 404. */
export default async function Page({ params }: { params: Params }) {
    const { id: raw } = await params;
    const id = decodeParam(raw);
    if ((await stationName(id)) === null) notFound();
    return (
        <Suspense>
            <StationHistoryPage stationId={id} />
        </Suspense>
    );
}

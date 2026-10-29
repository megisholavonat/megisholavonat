import { Suspense } from "react";
import { StationHistoryPage } from "@/components/stats/StationHistory";
import { decodeParam } from "@/lib/utils";
import { statsMetadata } from "../../metadata";

type Params = Promise<{ locale: string; id: string }>;

export async function generateMetadata({ params }: { params: Params }) {
    const { locale } = await params;
    return statsMetadata(locale);
}

export default async function Page({ params }: { params: Params }) {
    const { id } = await params;
    return (
        <Suspense>
            <StationHistoryPage stationId={decodeParam(id)} />
        </Suspense>
    );
}

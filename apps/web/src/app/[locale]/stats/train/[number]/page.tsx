import { Suspense } from "react";
import { TrainHistoryPage } from "@/components/stats/TrainHistory";
import { decodeParam } from "@/lib/utils";
import { statsMetadata } from "../../metadata";

type Params = Promise<{ locale: string; number: string }>;

export async function generateMetadata({ params }: { params: Params }) {
    const { locale, number } = await params;
    return statsMetadata(locale, decodeParam(number));
}

export default async function Page({ params }: { params: Params }) {
    const { number } = await params;
    return (
        <Suspense>
            <TrainHistoryPage number={decodeParam(number)} />
        </Suspense>
    );
}

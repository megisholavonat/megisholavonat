import { Suspense } from "react";
import { TrainHistoryPage } from "@/components/stats/TrainHistory";
import { statsMetadata } from "../../metadata";

type Params = Promise<{ locale: string; number: string }>;

export async function generateMetadata({ params }: { params: Params }) {
    const { locale, number } = await params;
    return statsMetadata(locale, decodeURIComponent(number));
}

export default async function Page({ params }: { params: Params }) {
    const { number } = await params;
    return (
        <Suspense>
            <TrainHistoryPage number={decodeURIComponent(number)} />
        </Suspense>
    );
}

import { Suspense } from "react";
import { StatsPage } from "@/components/stats/StatsPage";
import { statsMetadata } from "./metadata";

export async function generateMetadata({
    params,
}: {
    params: Promise<{ locale: string }>;
}) {
    const { locale } = await params;
    return statsMetadata({ locale, path: "/stats" });
}

export default function Page() {
    return (
        <Suspense>
            <StatsPage />
        </Suspense>
    );
}

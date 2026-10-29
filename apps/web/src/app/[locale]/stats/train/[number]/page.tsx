import { huTrainSubject } from "@megisholavonat/core/share";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { TrainHistoryPage } from "@/components/stats/TrainHistory";
import { decodeParam } from "@/lib/utils";
import { statsMetadata, trainTitle } from "../../metadata";

type Params = Promise<{ locale: string; number: string }>;

export async function generateMetadata({ params }: { params: Params }) {
    const { locale, number: raw } = await params;
    const number = decodeParam(raw);
    const t = await getTranslations({ locale, namespace: "Stats" });
    const title = await trainTitle(number);
    const path = `/stats/train/${encodeURIComponent(number)}`;
    if (title === null) {
        return statsMetadata({
            locale,
            path,
            title: t("not_found"),
            missing: true,
        });
    }
    return statsMetadata({
        locale,
        path,
        title,
        description: t("train_description", {
            subject:
                locale === "hu" ? huTrainSubject(number) : `train ${number}`,
        }),
    });
}

/** A train number with no run on record ("abc") is a 404. */
export default async function Page({ params }: { params: Params }) {
    const { number: raw } = await params;
    const number = decodeParam(raw);
    if ((await trainTitle(number)) === null) notFound();
    return (
        <Suspense>
            <TrainHistoryPage number={number} />
        </Suspense>
    );
}

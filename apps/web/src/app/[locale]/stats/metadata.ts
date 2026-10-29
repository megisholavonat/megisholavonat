import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

/** "Pontosság | Mégis hol a vonat?" for the stats pages. */
export async function statsMetadata(
    locale: string,
    title?: string,
): Promise<Metadata> {
    const t = await getTranslations({ locale, namespace: "Stats" });
    const tHome = await getTranslations({ locale, namespace: "Home" });
    return {
        title: `${title ?? t("title")} | ${tHome("app_title")}`,
    };
}

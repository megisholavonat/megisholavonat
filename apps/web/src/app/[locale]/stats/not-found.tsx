import type { Locale } from "@megisholavonat/core/i18n";
import { statsPath } from "@megisholavonat/core/links";
import { getLocale, getTranslations } from "next-intl/server";
import { EmptyPage } from "@/components/seo/PageParts";

/** A stats page for a train number or station that does not exist. */
export default async function NotFound() {
    const t = await getTranslations("Stats");
    const locale = (await getLocale()) as Locale;
    return (
        <EmptyPage
            title={t("not_found")}
            hint={t("not_found_hint")}
            action={{ href: statsPath(locale), label: t("title") }}
        />
    );
}

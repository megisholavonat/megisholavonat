import type { Locale } from "@megisholavonat/core/i18n";
import { mapPath } from "@megisholavonat/core/links";
import { getLocale, getTranslations } from "next-intl/server";
import { EmptyPage } from "@/components/seo/PageParts";

/** A delay card link to a run we have no record of. */
export default async function NotFound() {
    const t = await getTranslations("DelayCard");
    const tPages = await getTranslations("Pages");
    const locale = (await getLocale()) as Locale;
    return (
        <EmptyPage
            title={t("not_found")}
            hint={t("not_found_hint")}
            action={{ href: mapPath(locale), label: tPages("to_map") }}
        />
    );
}

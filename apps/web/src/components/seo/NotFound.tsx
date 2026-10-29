import type { Locale } from "@megisholavonat/core/i18n";
import { mapPath, type PageKind } from "@megisholavonat/core/links";
import { getLocale, getTranslations } from "next-intl/server";
import { EmptyPage } from "./PageParts";

/** A station or train page for a slug or number that does not exist. */
export async function PageNotFound({ kind }: { kind: PageKind }) {
    const t = await getTranslations("Pages");
    const locale = (await getLocale()) as Locale;
    return (
        <EmptyPage
            title={t(
                kind === "station" ? "station_not_found" : "train_not_found",
            )}
            hint={t("not_found_hint")}
            action={{ href: mapPath(locale), label: t("to_map") }}
        />
    );
}

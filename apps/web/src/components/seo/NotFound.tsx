import { SearchX } from "lucide-react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { PageKind } from "@/lib/seo/paths";

/** A station or train page for a slug or number that does not exist. */
export async function PageNotFound({ kind }: { kind: PageKind }) {
    const t = await getTranslations("Pages");
    const locale = await getLocale();
    return (
        <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center gap-3 px-4 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-surface-2 text-ink-2">
                <SearchX className="size-6" aria-hidden />
            </span>
            <h1 className="text-title font-bold">
                {t(
                    kind === "station"
                        ? "station_not_found"
                        : "train_not_found",
                )}
            </h1>
            <p className="max-w-xs text-ink-2">{t("not_found_hint")}</p>
            <Link
                href={`/${locale}`}
                className="pressable mt-2 flex h-11 items-center rounded-full bg-surface-2 px-5 font-semibold hover:bg-line"
            >
                {t("to_map")}
            </Link>
        </main>
    );
}

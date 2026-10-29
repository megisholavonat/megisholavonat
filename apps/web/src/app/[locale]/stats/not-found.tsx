import { SearchX } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

/** A stats page for a train number or station that does not exist. */
export default async function NotFound() {
    const t = await getTranslations("Stats");
    return (
        <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center gap-3 px-4 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-surface-2 text-ink-2">
                <SearchX className="size-6" aria-hidden />
            </span>
            <h1 className="text-title font-bold">{t("not_found")}</h1>
            <p className="max-w-xs text-ink-2">{t("not_found_hint")}</p>
            <Link
                href="/stats"
                className="pressable mt-2 flex h-11 items-center rounded-full bg-surface-2 px-5 font-semibold hover:bg-line"
            >
                {t("title")}
            </Link>
        </main>
    );
}

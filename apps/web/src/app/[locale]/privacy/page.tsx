import type { Metadata } from "next";
import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { LuArrowLeft } from "react-icons/lu";
import PrivacyContentEn from "@/app/[locale]/privacy/PrivacyContentEn";
import PrivacyContentHu from "@/app/[locale]/privacy/PrivacyContentHu";
import { Link } from "@/i18n/navigation";

/** Update together with the notice text (and CONSENT_VERSION if needed). */
const LAST_UPDATED = new Date("2026-10-29");

export async function generateMetadata({
    params,
}: {
    params: Promise<{ locale: string }>;
}): Promise<Metadata> {
    const { locale } = await params;
    const t = await getTranslations({ locale, namespace: "PrivacyPage" });
    const tHome = await getTranslations({ locale, namespace: "Home" });
    return {
        title: `${t("title")} | ${tHome("app_title")}`,
        alternates: {
            languages: {
                hu: "https://megisholavonat.info/hu/privacy",
                en: "https://megisholavonat.info/en/privacy",
            },
        },
    };
}

export default async function PrivacyPage({
    params,
}: {
    params: Promise<{ locale: string }>;
}) {
    const { locale } = await params;
    const t = await getTranslations({ locale, namespace: "PrivacyPage" });
    const date = new Intl.DateTimeFormat(locale, {
        dateStyle: "long",
    }).format(LAST_UPDATED);

    return (
        <div className="min-h-screen bg-background">
            <main className="mx-auto max-w-3xl px-4 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-48 sm:pt-10">
                <Link
                    href="/"
                    className="inline-flex items-center gap-2 rounded-lg p-2 -ml-2 text-sm text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                >
                    <LuArrowLeft className="w-4 h-4" aria-hidden="true" />
                    {t("back_to_map")}
                </Link>

                <div className="mt-6 flex items-center gap-3">
                    <Image src="/icon1.png" alt="" width={32} height={32} />
                    <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
                        {t("title")}
                    </h1>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                    {t("last_updated", { date })}
                </p>

                <article className="mt-8 prose prose-slate dark:prose-invert max-w-none">
                    {locale === "en" ? (
                        <PrivacyContentEn />
                    ) : (
                        <PrivacyContentHu />
                    )}
                </article>
            </main>
        </div>
    );
}

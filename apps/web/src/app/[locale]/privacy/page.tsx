import { localeAlternates, privacyPath } from "@megisholavonat/core/links";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import PrivacyContentEn from "@/app/[locale]/privacy/PrivacyContentEn";
import PrivacyContentHu from "@/app/[locale]/privacy/PrivacyContentHu";
import { PageHeader } from "@/components/seo/PageHeader";
import { PageMain } from "@/components/seo/PageMain";
import { subpageMetadata } from "@/lib/og/metadata";
import { siteUrl } from "@/lib/og/server";

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
    const origin = siteUrl();
    const { hu, en } = localeAlternates(origin, privacyPath);
    return {
        ...subpageMetadata({
            locale,
            origin,
            appTitle: tHome("app_title"),
            path: "/privacy",
            title: t("title"),
            description: t("description"),
        }),
        alternates: { languages: { hu, en } },
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
        // Room below for the consent card, which stays up on this page
        <PageMain className="pb-48">
            <PageHeader
                title={t("title")}
                caption={t("last_updated", { date })}
            />
            <article className="prose max-w-none rounded-lg bg-surface p-4 [--tw-prose-body:var(--mhav-ink)] [--tw-prose-bold:var(--mhav-ink)] [--tw-prose-bullets:var(--mhav-ink-2)] [--tw-prose-captions:var(--mhav-ink-2)] [--tw-prose-code:var(--mhav-ink)] [--tw-prose-counters:var(--mhav-ink-2)] [--tw-prose-headings:var(--mhav-ink)] [--tw-prose-hr:var(--mhav-line)] [--tw-prose-lead:var(--mhav-ink-2)] [--tw-prose-links:var(--mhav-ink)] [--tw-prose-quotes:var(--mhav-ink-2)] [--tw-prose-td-borders:var(--mhav-line)] [--tw-prose-th-borders:var(--mhav-line)] sm:p-6">
                {locale === "en" ? <PrivacyContentEn /> : <PrivacyContentHu />}
            </article>
        </PageMain>
    );
}

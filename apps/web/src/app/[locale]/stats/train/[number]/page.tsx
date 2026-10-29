import { notFound, permanentRedirect } from "next/navigation";
import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";
import { trainPath } from "@/lib/seo/paths";
import { decodeParam } from "@/lib/utils";

type Params = Promise<{ locale: string; number: string }>;

/** The train's history now lives on its page: /hu/vonat/650. */
export default async function Page({ params }: { params: Params }) {
    const { locale, number } = await params;
    if (!hasLocale(routing.locales, locale)) notFound();
    permanentRedirect(trainPath(locale, decodeParam(number)));
}

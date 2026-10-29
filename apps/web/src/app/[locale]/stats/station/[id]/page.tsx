import { stationPath } from "@megisholavonat/core/links";
import { notFound, permanentRedirect } from "next/navigation";
import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";
import { lookupStation } from "@/lib/seo/data";
import { decodeParam } from "@/lib/utils";

type Params = Promise<{ locale: string; id: string }>;

/** The station's history now lives on its page: /hu/allomas/szolnok. */
export default async function Page({ params }: { params: Params }) {
    const { locale, id: raw } = await params;
    if (!hasLocale(routing.locales, locale)) notFound();
    const id = decodeParam(raw);
    if (!/^\d+$/.test(id)) notFound();
    const found = await lookupStation(id);
    if (found.kind === "missing") notFound();
    permanentRedirect(stationPath(locale, found.segment));
}

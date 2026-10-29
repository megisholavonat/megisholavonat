import { delaySummary } from "@megisholavonat/core/delaySummary";
import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";
import { delayCardImage } from "@/lib/og/delayCard";
import { genericImage } from "@/lib/og/images";
import { runParams } from "@/lib/og/runParams";
import { fetchRun } from "@/lib/og/server";

type Params = Promise<{ locale: string; number: string; date: string }>;

/** The delay card of a run; the app card for an unknown run. */
export async function GET(request: Request, { params }: { params: Params }) {
    const { locale: raw, number, date } = await params;
    const locale = hasLocale(routing.locales, raw)
        ? raw
        : routing.defaultLocale;
    const run = runParams(number, date, new URL(request.url).searchParams);
    const summary = run
        ? await fetchRun(run.number, run.date, run.stops.from)
        : null;
    if (!run || !summary) return genericImage(locale);
    return delayCardImage(delaySummary(summary, run.stops), locale);
}

import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";
import { genericImage } from "@/lib/og/images";

type Params = Promise<{ locale: string }>;

/** The app's own preview card. */
export async function GET(_request: Request, { params }: { params: Params }) {
    const { locale } = await params;
    return genericImage(
        hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    );
}

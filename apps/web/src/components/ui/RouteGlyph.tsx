import { getMavRouteName } from "@megisholavonat/core/mavRoutes";
import DOMPurify from "dompurify";
import parse from "html-react-parser";
import { cn } from "@/lib/utils";
import { mnr2007 } from "@/util/fonts";

/**
 * MÁV route / train category glyph (MNR2007 font). The glyph takes the
 * surrounding text colour.
 */
export function RouteGlyph({
    routeShortName,
    className,
}: {
    routeShortName: string;
    className?: string;
}) {
    const routeName = getMavRouteName(routeShortName);

    return (
        <span
            role="img"
            title={routeName ?? undefined}
            aria-label={routeName ?? undefined}
            className={cn(
                mnr2007.className,
                "inline-block shrink-0 leading-none",
                className,
            )}
        >
            {parse(DOMPurify.sanitize(routeShortName))}
        </span>
    );
}

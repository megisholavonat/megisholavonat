import DOMPurify from "dompurify";
import parse from "html-react-parser";
import { cn } from "@/lib/utils";
import { mnr2007 } from "@/util/fonts";
import { getMavRouteName } from "@/util/mavRoutes";

export default function MAVRouteIcon({
    routeShortName,
    className,
}: {
    routeShortName: string;
    className?: string;
}) {
    const routeName = getMavRouteName(routeShortName);

    return (
        <div
            role="img"
            title={routeName ?? undefined}
            aria-label={routeName ?? undefined}
            className={cn(
                mnr2007.className,
                "dark:bg-white dark:px-1 dark:rounded",
                className,
            )}
        >
            {parse(DOMPurify.sanitize(routeShortName))}
        </div>
    );
}

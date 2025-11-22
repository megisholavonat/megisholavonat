import DOMPurify from "dompurify";
import parse from "html-react-parser";
import { cn } from "@/lib/utils";
import { mnr2007 } from "@/util/fonts";

export default function MAVRouteIcon({
    routeShortName,
    className,
}: {
    routeShortName: string;
    className?: string;
}) {
    return (
        <div
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

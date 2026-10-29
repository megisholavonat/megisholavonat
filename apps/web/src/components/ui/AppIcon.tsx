import { cn } from "@/lib/utils";

const RAIL = "M24 76V30L50 58L76 30V76";

/**
 * The app icon (assets/brand/icon.svg): the M as a rail track with the amber
 * train dot. Switches to the dark appearance with the theme. Decorative.
 */
export function AppIcon({
    size,
    className,
}: {
    size: number;
    className?: string;
}) {
    return (
        <svg
            viewBox="0 0 100 100"
            width={size}
            height={size}
            aria-hidden="true"
            className={cn("shrink-0", className)}
        >
            <rect
                width="100"
                height="100"
                rx="23"
                className="fill-[#16181C] dark:fill-black"
            />
            <g
                fill="none"
                strokeLinejoin="round"
                strokeLinecap="round"
                className="stroke-[#16181C] dark:stroke-black"
            >
                <path
                    d={RAIL}
                    strokeWidth="13"
                    className="stroke-[#F2F3F5] dark:stroke-[#C9CDD3]"
                />
                <path d={RAIL} strokeWidth="5" />
                <circle
                    cx="76"
                    cy="30"
                    r="9"
                    strokeWidth="3"
                    className="fill-[#F2C230] dark:fill-[#FFC93D]"
                />
            </g>
        </svg>
    );
}

"use client";

import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Placeholder block with a soft shimmer sweeping across it while content
 * loads; static with reduced motion.
 */
export function Skeleton({
    className,
    style,
}: {
    className?: string;
    style?: React.CSSProperties;
}) {
    const reduce = useReducedMotion();
    return (
        <span
            aria-hidden
            className={cn(
                "relative block overflow-hidden rounded-sm bg-surface-2",
                className,
            )}
            style={style}
        >
            {!reduce && (
                <motion.span
                    className="absolute inset-y-0 left-0 w-full bg-linear-to-r from-transparent via-white/50 to-transparent dark:via-white/8"
                    initial={{ x: "-100%" }}
                    animate={{ x: "100%" }}
                    transition={{
                        duration: 1.2,
                        ease: "easeInOut",
                        repeat: Number.POSITIVE_INFINITY,
                        repeatDelay: 0.2,
                    }}
                />
            )}
        </span>
    );
}

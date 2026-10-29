"use client";

import { useState } from "react";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Z_LAYERS } from "@/util/constants";

/**
 * A short explanation that opens on tap (touch) or hover (mouse), for glyphs
 * and names whose meaning is not spelled out. A `title` alone never shows on
 * touch screens.
 */
export function TapTip({
    content,
    label,
    children,
    className,
}: {
    content: React.ReactNode;
    /** Accessible name of the trigger */
    label: string;
    children: React.ReactNode;
    className?: string;
}) {
    const [open, setOpen] = useState(false);
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
                aria-label={label}
                className={cn(
                    "cursor-pointer rounded-sm outline-offset-2 focus-visible:outline-2 focus-visible:outline-ink-2",
                    className,
                )}
                onPointerEnter={(e) => {
                    if (e.pointerType === "mouse") setOpen(true);
                }}
                onPointerLeave={(e) => {
                    if (e.pointerType === "mouse") setOpen(false);
                }}
            >
                {children}
            </PopoverTrigger>
            <PopoverContent
                side="top"
                className="w-auto max-w-72 rounded-md px-3 py-2 text-sm text-ink"
                style={{ zIndex: Z_LAYERS.TOOLTIPS }}
                onOpenAutoFocus={(e) => e.preventDefault()}
            >
                {content}
            </PopoverContent>
        </Popover>
    );
}

"use client";

import { useEffect, useRef, useState } from "react";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Z_LAYERS } from "@/util/constants";

/**
 * A short explanation that opens on tap (touch) or a resting hover (mouse),
 * for glyphs whose meaning is not spelled out. A `title` alone never shows
 * on touch screens.
 */
/** A pointer passing over does not open it, one resting on it does */
const HOVER_DELAY_MS = 500;

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
    const hover = useRef<number | null>(null);
    const cancelHover = () => {
        if (hover.current !== null) window.clearTimeout(hover.current);
        hover.current = null;
    };
    useEffect(
        () => () => {
            if (hover.current !== null) window.clearTimeout(hover.current);
        },
        [],
    );
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
                aria-label={label}
                className={cn(
                    // 44 px hit area around a 24 px glyph
                    "relative cursor-pointer rounded-sm before:absolute before:-inset-2.5",
                    className,
                )}
                onPointerEnter={(e) => {
                    if (e.pointerType !== "mouse") return;
                    cancelHover();
                    hover.current = window.setTimeout(
                        () => setOpen(true),
                        HOVER_DELAY_MS,
                    );
                }}
                onPointerLeave={(e) => {
                    if (e.pointerType !== "mouse") return;
                    cancelHover();
                    setOpen(false);
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

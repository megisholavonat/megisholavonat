"use client";

import { useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import {
    type ReactNode,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { cn } from "@/lib/utils";

export type Detent = "peek" | "half" | "full";

const ORDER: Detent[] = ["peek", "half", "full"];
/** Map visible above a full sheet */
const FULL_TOP_GAP = 56;
/** Half: share of the viewport */
const HALF_SHARE = 0.55;
/** Movement before a press on the header turns into a drag */
const DRAG_SLOP = 6;
/** Flicks faster than this (px/ms) jump a detent in their direction */
const FLICK_VELOCITY = 0.5;

function useViewportHeight(): number {
    const [height, setHeight] = useState(800);
    useLayoutEffect(() => {
        const update = () => setHeight(window.innerHeight);
        update();
        window.addEventListener("resize", update);
        return () => window.removeEventListener("resize", update);
    }, []);
    return height;
}

/**
 * Mobile web bottom sheet with peek / half / full detents. The whole header
 * drags; the handle also steps through the detents on tap. Publishes the
 * covered height as `--mhav-sheet-inset` for the map controls and the
 * consent card.
 */
export function BottomSheet({
    header,
    children,
    detents = ORDER,
    detent,
    onDetentChange,
    onDismiss,
    label,
}: {
    header: ReactNode;
    children?: ReactNode;
    detents?: Detent[];
    detent: Detent;
    onDetentChange: (detent: Detent) => void;
    /** Dragging below the lowest detent closes the sheet */
    onDismiss?: () => void;
    label: string;
}) {
    const t = useTranslations("Sheet");
    const reducedMotion = useReducedMotion() ?? false;
    const viewport = useViewportHeight();
    const headerRef = useRef<HTMLDivElement>(null);
    const [headerHeight, setHeaderHeight] = useState(96);
    const [dragHeight, setDragHeight] = useState<number | null>(null);
    const drag = useRef<{
        startY: number;
        startHeight: number;
        lastY: number;
        lastT: number;
        velocity: number;
        active: boolean;
        pointerId: number;
    } | null>(null);

    useLayoutEffect(() => {
        const el = headerRef.current;
        if (!el) return;
        const observer = new ResizeObserver(() =>
            setHeaderHeight(el.offsetHeight),
        );
        observer.observe(el);
        setHeaderHeight(el.offsetHeight);
        return () => observer.disconnect();
    }, []);

    const heights = useMemo(
        (): Record<Detent, number> => ({
            peek: headerHeight,
            half: Math.max(headerHeight, Math.round(viewport * HALF_SHARE)),
            full: viewport - FULL_TOP_GAP,
        }),
        [headerHeight, viewport],
    );
    const available = useMemo(
        () => ORDER.filter((d) => detents.includes(d)),
        [detents],
    );
    const height = dragHeight ?? heights[detent];

    // Map controls and the consent card float above the sheet
    useEffect(() => {
        const inset = Math.min(height, heights.half);
        document.documentElement.style.setProperty(
            "--mhav-sheet-inset",
            `${Math.round(inset)}px`,
        );
    }, [height, heights.half]);
    useEffect(
        () => () => {
            document.documentElement.style.removeProperty("--mhav-sheet-inset");
        },
        [],
    );

    const settle = useCallback(
        (finalHeight: number, velocity: number) => {
            // Nearest detent, nudged by the flick direction
            let target = available.reduce((best, d) =>
                Math.abs(heights[d] - finalHeight) <
                Math.abs(heights[best] - finalHeight)
                    ? d
                    : best,
            );
            const index = available.indexOf(target);
            if (velocity < -FLICK_VELOCITY && heights[target] <= finalHeight) {
                target = available[Math.min(index + 1, available.length - 1)];
            } else if (
                velocity > FLICK_VELOCITY &&
                heights[target] >= finalHeight
            ) {
                if (index === 0 && onDismiss) {
                    onDismiss();
                    return;
                }
                target = available[Math.max(index - 1, 0)];
            }
            const lowest = heights[available[0]];
            if (onDismiss && finalHeight < lowest * 0.6) {
                onDismiss();
                return;
            }
            onDetentChange(target);
        },
        [available, heights, onDetentChange, onDismiss],
    );

    const onPointerDown = (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        drag.current = {
            startY: e.clientY,
            startHeight: height,
            lastY: e.clientY,
            lastT: e.timeStamp,
            velocity: 0,
            active: false,
            pointerId: e.pointerId,
        };
    };
    const onPointerMove = (e: React.PointerEvent) => {
        const d = drag.current;
        if (!d || d.pointerId !== e.pointerId) return;
        const dy = e.clientY - d.startY;
        if (!d.active) {
            if (Math.abs(dy) < DRAG_SLOP) return;
            d.active = true;
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }
        const dt = Math.max(1, e.timeStamp - d.lastT);
        d.velocity = (e.clientY - d.lastY) / dt;
        d.lastY = e.clientY;
        d.lastT = e.timeStamp;
        const next = Math.min(
            heights.full,
            Math.max(heights.peek * 0.4, d.startHeight - dy),
        );
        setDragHeight(next);
    };
    const endDrag = (e: React.PointerEvent) => {
        const d = drag.current;
        drag.current = null;
        if (!d?.active) return;
        e.preventDefault();
        const finalHeight = d.startHeight - (e.clientY - d.startY);
        setDragHeight(null);
        settle(finalHeight, d.velocity);
    };

    const stepUp = () => {
        const index = available.indexOf(detent);
        onDetentChange(
            index === available.length - 1
                ? available[0]
                : available[index + 1],
        );
    };

    const scrollable = detent !== "peek" && dragHeight === null;

    return (
        <section
            aria-label={label}
            className={cn(
                "fixed inset-x-0 bottom-0 z-30 flex flex-col overflow-hidden rounded-t-sheet bg-surface",
                "shadow-[0_-1px_3px_rgb(20_22_26/0.08),0_-8px_24px_rgb(20_22_26/0.08)]",
                dragHeight === null &&
                    !reducedMotion &&
                    "transition-[height] duration-(--mhav-duration-sheet) ease-sheet",
            )}
            style={{ height }}
        >
            <div
                ref={headerRef}
                className="shrink-0 touch-none select-none"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
            >
                <div className="flex justify-center pt-2 pb-1">
                    <button
                        type="button"
                        onClick={stepUp}
                        className="flex h-5 w-14 cursor-grab items-center justify-center"
                        aria-label={t("resize")}
                        disabled={available.length < 2}
                    >
                        <span className="h-1 w-9 rounded-full bg-line" />
                    </button>
                </div>
                {header}
            </div>
            <div
                className={cn(
                    "min-h-0 flex-1 overscroll-contain pb-[env(safe-area-inset-bottom)]",
                    scrollable ? "overflow-y-auto" : "overflow-hidden",
                )}
            >
                {children}
            </div>
        </section>
    );
}

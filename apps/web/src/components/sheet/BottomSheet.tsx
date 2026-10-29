"use client";

import { EASING, MOTION } from "@megisholavonat/core/tokens";
import { X } from "lucide-react";
import {
    AnimatePresence,
    motion,
    useAnimate,
    usePresence,
    useReducedMotion,
} from "motion/react";
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
export const FULL_TOP_GAP = 56;
/** Half: share of the viewport */
export const HALF_SHARE = 0.55;
/** Movement before a press on the header turns into a drag */
const DRAG_SLOP = 6;
/** Flicks faster than this (px/ms) jump a detent in their direction */
const FLICK_VELOCITY = 0.5;

/** The sheet curve and duration, for motion */
export const SHEET_TRANSITION = {
    duration: MOTION.sheet.duration / 1000,
    ease: [...EASING.sheet.bezier] as [number, number, number, number],
};
/** Content swap inside the persistent sheet */
const FADE_TRANSITION = { duration: 0.16, ease: "easeOut" } as const;

export interface SheetViewport {
    /** Visible height (the visual viewport, so above the keyboard) */
    height: number;
    /** Height of the on-screen keyboard over the layout viewport */
    keyboard: number;
}

/**
 * The part of the screen a bottom sheet can use. Follows the visual
 * viewport, so a sheet with a focused field sits on top of the keyboard
 * (iOS keeps the layout viewport behind it; Android resizes it).
 */
export function useSheetViewport(): SheetViewport {
    const [viewport, setViewport] = useState<SheetViewport>({
        height: 800,
        keyboard: 0,
    });
    useLayoutEffect(() => {
        const vv = window.visualViewport;
        const update = () => {
            const height = vv?.height ?? window.innerHeight;
            const keyboard = vv
                ? Math.max(
                      0,
                      Math.round(window.innerHeight - vv.height - vv.offsetTop),
                  )
                : 0;
            setViewport((prev) =>
                prev.height === height && prev.keyboard === keyboard
                    ? prev
                    : { height, keyboard },
            );
        };
        update();
        window.addEventListener("resize", update);
        vv?.addEventListener("resize", update);
        vv?.addEventListener("scroll", update);
        return () => {
            window.removeEventListener("resize", update);
            vv?.removeEventListener("resize", update);
            vv?.removeEventListener("scroll", update);
        };
    }, []);
    return viewport;
}

export function halfHeight(viewport: number): number {
    return Math.round(viewport * HALF_SHARE);
}

/** Round close button in the sheet's top-right corner, beside the handle. */
export function SheetClose({
    onClick,
    label,
}: {
    onClick: () => void;
    label?: string;
}) {
    const t = useTranslations("Sheet");
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label ?? t("close")}
            title={label ?? t("close")}
            className="absolute -top-7 right-3 z-10 flex size-8 cursor-pointer items-center justify-center rounded-full bg-surface-2 text-ink-2 transition-colors before:absolute before:-inset-1.5 hover:bg-line hover:text-ink"
        >
            <X className="size-4.5" aria-hidden />
        </button>
    );
}

/**
 * Mobile web bottom sheet with peek / half / full detents. One sheet stays
 * mounted across home, search, train, station and planner: `contentKey`
 * cross-fades the content while the height glides between detents. It
 * slides up when it mounts, slides down when it leaves, and a drag below
 * the lowest detent carries it off screen before `onDismiss`. The whole
 * header drags; the handle also steps through the detents on tap.
 * Publishes the covered height as `--mhav-sheet-inset` for the map
 * controls and the consent card.
 */
export function BottomSheet({
    header,
    children,
    contentKey = "default",
    detents = ORDER,
    detent,
    onDetentChange,
    onDismiss,
    onPeekHeight,
    fullTopGap = FULL_TOP_GAP,
    bodyScroll = true,
    modal = false,
    label,
}: {
    header: ReactNode;
    children?: ReactNode;
    /** Changing it cross-fades the header and body */
    contentKey?: string;
    detents?: Detent[];
    detent: Detent;
    onDetentChange: (detent: Detent) => void;
    /** Dragging below the lowest detent closes the sheet */
    onDismiss?: () => void;
    /** The peek height (the header), for keeping the map selection clear */
    onPeekHeight?: (height: number) => void;
    /** Map left visible above the full detent */
    fullTopGap?: number;
    /** False when the content scrolls itself */
    bodyScroll?: boolean;
    /** Search and the planner take over the sheet like a dialog */
    modal?: boolean;
    label: string;
}) {
    const t = useTranslations("Sheet");
    const reducedMotion = useReducedMotion() ?? false;
    const { height: viewport, keyboard } = useSheetViewport();
    const headerRef = useRef<HTMLDivElement>(null);
    const [headerHeight, setHeaderHeight] = useState(96);
    const [dragHeight, setDragHeight] = useState<number | null>(null);
    const [isPresent, safeToRemove] = usePresence();
    const [scope, animate] = useAnimate<HTMLElement>();
    const dismissing = useRef(false);
    const drag = useRef<{
        startY: number;
        startHeight: number;
        lastY: number;
        lastT: number;
        velocity: number;
        active: boolean;
        pointerId: number;
    } | null>(null);

    const transition = reducedMotion ? { duration: 0 } : SHEET_TRANSITION;

    // Slide up on mount, down on unmount
    // biome-ignore lint/correctness/useExhaustiveDependencies: presence only
    useEffect(() => {
        if (!scope.current) return;
        if (isPresent) {
            void animate(scope.current, { y: ["100%", "0%"] }, transition);
        } else {
            void animate(scope.current, { y: "100%" }, transition).then(() =>
                safeToRemove?.(),
            );
        }
    }, [isPresent]);

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

    useEffect(() => {
        onPeekHeight?.(headerHeight);
    }, [headerHeight, onPeekHeight]);

    const heights = useMemo(
        (): Record<Detent, number> => ({
            peek: headerHeight,
            half: Math.min(
                viewport - fullTopGap,
                Math.max(headerHeight, halfHeight(viewport)),
            ),
            full: Math.max(headerHeight, viewport - fullTopGap),
        }),
        [headerHeight, viewport, fullTopGap],
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

    /** Carry the sheet off screen, swap the content, bring it back up */
    const dismiss = useCallback(() => {
        if (!onDismiss || dismissing.current) return;
        const el = scope.current;
        if (!el || reducedMotion) {
            setDragHeight(null);
            onDismiss();
            return;
        }
        dismissing.current = true;
        void animate(el, { y: "100%" }, SHEET_TRANSITION).then(() => {
            setDragHeight(null);
            onDismiss();
            dismissing.current = false;
            requestAnimationFrame(() => {
                void animate(el, { y: "0%" }, SHEET_TRANSITION);
            });
        });
    }, [onDismiss, scope, animate, reducedMotion]);

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
                    dismiss();
                    return;
                }
                target = available[Math.max(index - 1, 0)];
            }
            const lowest = heights[available[0]];
            if (onDismiss && finalHeight < lowest * 0.6) {
                dismiss();
                return;
            }
            setDragHeight(null);
            onDetentChange(target);
        },
        [available, heights, onDetentChange, onDismiss, dismiss],
    );

    const onPointerDown = (e: React.PointerEvent) => {
        if (e.button !== 0 || dismissing.current) return;
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
            // A drag from the search field should not leave the keyboard up
            if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur();
            }
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
        settle(d.startHeight - (e.clientY - d.startY), d.velocity);
    };

    const stepUp = () => {
        const index = available.indexOf(detent);
        onDetentChange(
            index === available.length - 1
                ? available[0]
                : available[index + 1],
        );
    };

    const scrollable = bodyScroll && detent !== "peek" && dragHeight === null;
    const fade = reducedMotion ? { duration: 0 } : FADE_TRANSITION;

    return (
        // biome-ignore lint/a11y/useAriaPropsSupportedByRole: the role is dialog whenever aria-modal is set
        <section
            ref={scope}
            aria-label={label}
            role={modal ? "dialog" : undefined}
            aria-modal={modal || undefined}
            className={cn(
                "fixed inset-x-0 z-30 flex flex-col overflow-hidden rounded-t-sheet bg-surface",
                "shadow-[0_-1px_3px_rgb(20_22_26/0.08),0_-8px_24px_rgb(20_22_26/0.08)]",
                dragHeight === null &&
                    !reducedMotion &&
                    "transition-[height,bottom] duration-(--mhav-duration-sheet) ease-sheet",
            )}
            // Off screen until the enter animation runs
            style={{ height, bottom: keyboard, transform: "translateY(100%)" }}
        >
            <div
                ref={headerRef}
                className="relative shrink-0 touch-none select-none"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
            >
                <div className="flex justify-center pt-2 pb-1">
                    <button
                        type="button"
                        onClick={stepUp}
                        className="relative flex h-5 w-14 cursor-grab items-center justify-center before:absolute before:-inset-x-2 before:-inset-y-3"
                        aria-label={t("resize")}
                        disabled={available.length < 2}
                    >
                        <span className="h-1 w-9 rounded-full bg-line" />
                    </button>
                </div>
                <AnimatePresence mode="popLayout" initial={false}>
                    <motion.div
                        key={contentKey}
                        className="relative"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={fade}
                    >
                        {header}
                    </motion.div>
                </AnimatePresence>
            </div>
            <div
                className={cn(
                    "relative min-h-0 flex-1 overscroll-contain",
                    bodyScroll
                        ? "pb-[env(safe-area-inset-bottom)]"
                        : "flex flex-col",
                    scrollable ? "overflow-y-auto" : "overflow-hidden",
                )}
            >
                <AnimatePresence mode="popLayout" initial={false}>
                    <motion.div
                        key={contentKey}
                        className={cn(
                            !bodyScroll && "flex min-h-0 flex-1 flex-col",
                        )}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={fade}
                    >
                        {children}
                    </motion.div>
                </AnimatePresence>
            </div>
        </section>
    );
}

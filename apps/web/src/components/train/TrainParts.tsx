"use client";

import type {
    InfoService,
    TrainFeatureProperties,
} from "@megisholavonat/api-client";
import {
    DELAY_REASON_TEXTS,
    normalizeAlertText,
} from "@megisholavonat/core/delayReasons";
import { formatSecondsAsTime } from "@megisholavonat/core/time";
import {
    formatUICCode,
    vehicleTypeFromUICCode,
} from "@megisholavonat/core/uic";
import {
    dataAppearsFalsified,
    isActive,
    isFarFromRoute,
} from "@megisholavonat/core/vehicle";
import { formatDistanceToNow } from "date-fns";
import { enGB, hu } from "date-fns/locale";
import {
    ArrowRight,
    ArrowUpRight,
    Check,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Info,
    Share,
    Star,
    X,
} from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
    DelayTile,
    type Level,
    levelOf,
    TEXT_CLASS,
    TINT_CLASS,
} from "@/components/ui/Delay";
import { PlatformBadge } from "@/components/ui/Platform";
import { useReasonLabel } from "@/components/ui/Reason";
import { ReasonIcon } from "@/components/ui/ReasonIcon";
import { RouteGlyph } from "@/components/ui/RouteGlyph";
import { Skeleton } from "@/components/ui/Skeleton";
import { TapTip } from "@/components/ui/TapTip";
import { findFollow, useFollows } from "@/hooks/useFollows";
import {
    destinationOf,
    type TrainAlert,
    type TrainReason,
    trainName,
    trainNumber,
} from "@/lib/train";
import { cn } from "@/lib/utils";
import { mnr2007 } from "@/util/fonts";
import type { StopView, TrainView } from "./useTrainView";

export function IconButton({
    label,
    onClick,
    children,
    className,
}: {
    label: string;
    onClick: () => void;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label}
            title={label}
            className={cn(
                "pressable flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-surface-2 text-ink hover:bg-line",
                className,
            )}
        >
            {children}
        </button>
    );
}

export function CloseButton({ onClick }: { onClick: () => void }) {
    const t = useTranslations("Train");
    return (
        <IconButton label={t("close")} onClick={onClick}>
            <X className="size-5" aria-hidden />
        </IconButton>
    );
}

export function BackButton({ onClick }: { onClick: () => void }) {
    const t = useTranslations("Train");
    return (
        <IconButton
            label={t("back")}
            onClick={onClick}
            className="size-9 rounded-md"
        >
            <ChevronLeft className="size-5" aria-hidden />
        </IconButton>
    );
}

/** "Ŭ 10 → Záhony": glyph, number and destination. */
export function TrainTitle({
    routeShortName,
    tripShortName,
    destination,
    withName = false,
    className,
}: {
    routeShortName: string;
    tripShortName: string;
    destination: string | null;
    withName?: boolean;
    className?: string;
}) {
    const name = withName ? trainName(tripShortName) : null;
    return (
        <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
            <RouteGlyph routeShortName={routeShortName} className="text-lg" />
            <span className="tnum shrink-0">
                {trainNumber(tripShortName)}
                {name ? ` ${name}` : ""}
            </span>
            {destination === null ? (
                // Destination arrives with the details
                <Skeleton className="h-4 w-28 shrink" />
            ) : (
                destination && (
                    <>
                        <ArrowRight className="size-4 shrink-0" aria-hidden />
                        <span className="truncate">{destination}</span>
                    </>
                )
            )}
        </span>
    );
}

function TimeText({
    seconds,
    estimated = false,
    level,
    className,
}: {
    seconds: number;
    estimated?: boolean;
    level: ReturnType<typeof levelOf> | null;
    className?: string;
}) {
    return (
        <span
            className={cn(
                "tnum",
                level && level !== "onTime" ? TEXT_CLASS[level] : "text-ink",
                className,
            )}
        >
            {estimated ? "≈" : ""}
            {formatSecondsAsTime(seconds)}
        </span>
    );
}

/** "Szolnok 17:28 ~~17:05~~": the next stop with its expected time. */
export function NextStopLine({
    stop,
    stale,
}: {
    stop: StopView;
    stale: boolean;
}) {
    const { timing } = stop;
    const late = timing.delay >= 1;
    return (
        <span className="flex min-w-0 items-baseline gap-1.5 text-headline">
            <span className="truncate">{stop.name}</span>
            <TimeText
                seconds={timing.expected}
                estimated={stale || timing.estimated}
                level={null}
                className="shrink-0"
            />
            {late && (
                <s className="tnum shrink-0 text-caption font-normal text-ink-2">
                    {formatSecondsAsTime(timing.scheduled)}
                </s>
            )}
        </span>
    );
}

/** Peek row: delay tile, title, next stop, and a platform or close button. */
export function TrainSummary({
    view,
    fallback,
    trailing,
}: {
    view: TrainView | null;
    fallback: TrainFeatureProperties | null;
    trailing?: React.ReactNode;
}) {
    const t = useTranslations("Train");
    const vehicle = view?.vehicle;
    const delay = vehicle?.delay ?? fallback?.delay ?? 0;
    const stale = view?.stale ?? !!fallback?.isStale;
    const routeShortName =
        vehicle?.trip.route.shortName ?? fallback?.routeShortName ?? "";
    const tripShortName =
        vehicle?.trip.tripShortName ?? fallback?.tripShortName ?? "";
    return (
        <div className="flex items-center gap-3 px-4 pb-3">
            <DelayTile delay={delay} stale={stale} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <TrainTitle
                    routeShortName={routeShortName}
                    tripShortName={tripShortName}
                    destination={vehicle ? destinationOf(vehicle) : null}
                    className="text-[15px] font-medium"
                />
                {view?.next ? (
                    <NextStopLine stop={view.next} stale={stale} />
                ) : (
                    <Skeleton className="my-0.5 h-4 w-40" />
                )}
                {view?.usuallyLate && (
                    <span className="text-caption text-delay-slight">
                        {t(
                            view.usuallyLate === "veryLate"
                                ? "usually_very_late"
                                : "usually_late",
                        )}
                    </span>
                )}
            </div>
            {trailing}
        </div>
    );
}

/** Whether this train is followed (by number, preferring its own stops). */
export function useIsFollowed(view: TrainView | null): boolean {
    const follows = useFollows();
    if (!view) return false;
    return !!findFollow(
        follows,
        trainNumber(view.vehicle.trip.tripShortName),
        view.stops.map((s) => s.stationId),
    );
}

/** Star button for the full sheet header. */
export function FollowIconButton({
    view,
    onFollow,
}: {
    view: TrainView;
    onFollow: () => void;
}) {
    const t = useTranslations("Follow");
    const followed = useIsFollowed(view);
    return (
        <IconButton
            label={followed ? t("following") : t("follow")}
            onClick={onFollow}
            className={
                followed
                    ? undefined
                    : "bg-action text-on-action hover:bg-action"
            }
        >
            <Star
                className={cn("size-5", followed && "fill-current")}
                aria-hidden
            />
        </IconButton>
    );
}

/** Follow, share and ticket. */
export function TrainActions({
    view,
    onFollow,
}: {
    view: TrainView;
    onFollow: () => void;
}) {
    const t = useTranslations("Train");
    const tFollow = useTranslations("Follow");
    const followed = useIsFollowed(view);
    const [copied, setCopied] = useState(false);
    const share = async () => {
        const url = window.location.href;
        const title = `${trainNumber(view.vehicle.trip.tripShortName)} → ${destinationOf(view.vehicle)}`;
        try {
            if (navigator.share) {
                await navigator.share({ title, url });
                return;
            }
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Share sheet dismissed
        }
    };
    return (
        <div className="flex gap-2">
            <button
                type="button"
                onClick={onFollow}
                aria-pressed={followed}
                className={cn(
                    "flex h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-full px-4 text-[15px] font-semibold",
                    followed
                        ? "bg-surface-2 text-ink hover:bg-line"
                        : "bg-action text-on-action",
                )}
            >
                <Star
                    className={cn("size-4.5", followed && "fill-current")}
                    aria-hidden
                />
                {followed ? tFollow("following") : tFollow("follow")}
            </button>
            <IconButton
                label={copied ? t("copied") : t("share")}
                onClick={share}
            >
                {copied ? (
                    <Check className="size-5" aria-hidden />
                ) : (
                    <Share className="size-5" aria-hidden />
                )}
            </IconButton>
            <a
                href={view.ticketUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-11 shrink-0 items-center justify-center gap-1 rounded-full bg-surface-2 px-4 text-[15px] font-semibold text-ink transition-colors hover:bg-line"
            >
                {t("ticket")}
                <ArrowUpRight className="size-4" aria-hidden />
            </a>
        </div>
    );
}

/** "okt. 29. 1:30 – 4:34", in Budapest time. */
function formatValidity(start: number, end: number, locale: string): string {
    const format = new Intl.DateTimeFormat(
        locale === "hu" ? "hu-HU" : "en-GB",
        {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "Europe/Budapest",
        },
    );
    try {
        return format.formatRange(new Date(start * 1000), new Date(end * 1000));
    } catch {
        return `${format.format(new Date(start * 1000))} – ${format.format(new Date(end * 1000))}`;
    }
}

/** Header of an alert: "Késés oka: Más vonat", or "Közlemény" for free text. */
function AlertTitle({ alert }: { alert: TrainAlert }) {
    const t = useTranslations("Train");
    const tDelay = useTranslations("Delay");
    const label = useReasonLabel();
    if (!alert.code) return <>{t("notice")}</>;
    return (
        <>
            {tDelay.rich("reason", {
                reason: label(alert.code),
                b: (chunks) => <b className="font-semibold">{chunks}</b>,
            })}
        </>
    );
}

/** One alert in full: title, MÁV's text, "More information", validity. */
function AlertItem({
    alert,
    level,
    framed,
}: {
    alert: TrainAlert;
    level: Level;
    /** Its own tinted card (detail view) rather than a row in a card */
    framed: boolean;
}) {
    const t = useTranslations("Train");
    const locale = useLocale();
    const tint = alert.code ? level : "stale";
    // MÁV's stock sentence for a known reason says nothing the title doesn't
    const showText = !Object.hasOwn(
        DELAY_REASON_TEXTS,
        normalizeAlertText(alert.text),
    );
    return (
        <div
            className={cn(
                "flex items-start gap-2.5",
                framed && cn("rounded-md px-3 py-2.5", TINT_CLASS[tint]),
            )}
        >
            {alert.code ? (
                <ReasonIcon
                    code={alert.code}
                    className={cn(
                        "mt-0.5 size-4.5 shrink-0",
                        TEXT_CLASS[level],
                    )}
                />
            ) : (
                <Info
                    className="mt-0.5 size-4.5 shrink-0 text-ink-2"
                    aria-hidden
                />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
                <p className="text-ink">
                    <AlertTitle alert={alert} />
                </p>
                {showText && <p className="text-ink-2">{alert.text}</p>}
                {alert.url && (
                    <a
                        href={alert.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex w-fit items-center gap-0.5 font-semibold text-ink underline-offset-2 hover:underline"
                    >
                        {t("more_info")}
                        <ArrowUpRight className="size-3.5" aria-hidden />
                    </a>
                )}
                {alert.end > alert.start && (
                    <p className="tnum text-caption text-ink-2">
                        {t("valid", {
                            range: formatValidity(
                                alert.start,
                                alert.end,
                                locale,
                            ),
                        })}
                    </p>
                )}
            </div>
        </div>
    );
}

/**
 * MÁV's alerts for the train. Compact (half sheet): one tinted row reading
 * "Késés oka: Más vonat", only for a known reason; tap it for every alert in
 * full. Detailed: every alert with its text, link and validity. The tint
 * follows the train's actual delay, so an on-time train is never orange.
 */
export function ReasonBanner({
    reason,
    delay,
    detailed = false,
}: {
    reason: TrainReason;
    delay: number;
    detailed?: boolean;
}) {
    const t = useTranslations("Train");
    const tDelay = useTranslations("Delay");
    const label = useReasonLabel();
    const [open, setOpen] = useState(false);
    const level = levelOf(delay);
    // A delay reason explains a delay: none on a train that is on time
    const late = level !== "onTime";
    const alerts = late ? reason.alerts : reason.alerts.filter((a) => !a.code);
    if (detailed) {
        if (alerts.length === 0) return null;
        return (
            <div className="flex flex-col gap-2">
                {alerts.map((alert) => (
                    <AlertItem
                        key={`${alert.start}-${alert.text}`}
                        alert={alert}
                        level={level}
                        framed
                    />
                ))}
            </div>
        );
    }
    if (!late || !reason.code) return null;
    const others = alerts.length - 1;
    return (
        <div className={cn("rounded-md", TINT_CLASS[level])}>
            <button
                type="button"
                onClick={() => setOpen(!open)}
                aria-expanded={open}
                className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm"
            >
                <ReasonIcon
                    code={reason.code}
                    className={cn("size-4.5 shrink-0", TEXT_CLASS[level])}
                />
                <span className="min-w-0 flex-1 truncate text-ink">
                    {tDelay.rich("reason", {
                        reason: label(reason.code),
                        b: (chunks) => (
                            <b className="font-semibold">{chunks}</b>
                        ),
                    })}
                </span>
                {others > 0 && !open && (
                    <span className="shrink-0 text-caption text-ink-2">
                        {t("more_alerts", { count: others })}
                    </span>
                )}
                <ChevronDown
                    className={cn(
                        "size-4 shrink-0 text-ink-2 transition-transform",
                        open && "rotate-180",
                    )}
                    aria-hidden
                />
            </button>
            {open && (
                <div className="flex flex-col gap-3 border-t border-ink/8 px-3 pt-2.5 pb-3">
                    {alerts.map((alert) => (
                        <AlertItem
                            key={`${alert.start}-${alert.text}`}
                            alert={alert}
                            level={level}
                            framed={false}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

/** "Szolnok: 3 in 10 on time" with a ten-step bar. */
export function Punctuality({
    punctuality,
}: {
    punctuality: NonNullable<TrainView["punctuality"]>;
}) {
    const t = useTranslations("Train");
    const { onTimeOf10 } = punctuality;
    return (
        <div className="flex items-center gap-3 text-sm">
            <div className="flex gap-0.5" aria-hidden>
                {Array.from({ length: 10 }, (_, i) => (
                    <span
                        // biome-ignore lint/suspicious/noArrayIndexKey: fixed ten steps
                        key={i}
                        className={cn(
                            "h-3.5 w-2 rounded-[2px]",
                            i < onTimeOf10
                                ? "bg-delay-on-time-fill"
                                : "bg-surface-2",
                        )}
                    />
                ))}
            </div>
            <span className="text-ink">
                {t.rich("punctuality", {
                    station: punctuality.station,
                    count: onTimeOf10,
                    b: (chunks) => <b className="font-semibold">{chunks}</b>,
                })}
            </span>
        </div>
    );
}

/**
 * The train's fraction between its last and next stop, dead-reckoned from
 * its speed between position reports so the marker keeps moving. It never
 * runs past 97 % of the segment on its own; the next report corrects it.
 */
function useLiveFraction(view: TrainView): number {
    const { position, vehicle, stale } = view;
    const speed = vehicle.speed ?? 0;
    const moving =
        !stale &&
        speed > 0.5 &&
        position.fromIndex >= 0 &&
        position.segmentKm != null &&
        position.segmentKm > 0;
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!moving) return;
        setNow(Date.now());
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [moving]);
    if (!moving || !position.segmentKm) return position.fraction;
    const seconds = Math.min(
        120,
        Math.max(0, now / 1000 - vehicle.lastUpdated),
    );
    const km = (speed * seconds) / 1000;
    return Math.min(
        Math.max(position.fraction, 0.97),
        position.fraction + km / position.segmentKm,
    );
}

/** "még 8 km · 112 km/h", or "Cegléd · áll" while standing at a stop. */
function positionLabel(
    view: TrainView,
    fraction: number,
    t: ReturnType<typeof useTranslations<"Train">>,
): { place: string | null; motion: string } {
    const { position, vehicle } = view;
    const speed = Math.round((vehicle.speed ?? 0) * 3.6);
    const motion = speed > 0 ? `${speed} km/h` : t("standing");
    const segment = position.segmentKm;
    if (segment == null) return { place: null, motion };
    const done = fraction * segment;
    const left = (1 - fraction) * segment;
    const from = view.stops[position.fromIndex];
    if (done < 0.4 && from) return { place: from.name, motion };
    const km = left >= 2 ? Math.round(left) : Math.round(left * 10) / 10;
    return { place: t("to_go", { km }), motion };
}

/** Rail centre, in the 18 px dot column */
const RAIL_X = 9;
/** Marker centre to stop-dot centre at the ends of a segment */
const MARKER_GAP = 13;
/** Label centre to a stop name's centre, so they never overlap */
const LABEL_GAP = 20;

/**
 * Stop list with a progress rail: passed track in ink-2, track ahead in the
 * line colour, and the train placed proportionally between its last and next
 * stop (like a transit app), labelled with its distance and speed. The marker
 * glides between position reports; it jumps with reduced motion.
 */
export function StopList({
    view,
    upcomingOnly = false,
}: {
    view: TrainView;
    upcomingOnly?: boolean;
}) {
    const t = useTranslations("Train");
    const reduce = useReducedMotion();
    const fraction = useLiveFraction(view);
    const { position } = view;
    const stops = upcomingOnly
        ? view.stops.filter((s) => !s.passed).slice(0, 4)
        : view.stops;
    const shown = new Set(stops.map((s) => s.index));
    // The position row sits between the last and the next stop
    const showNow =
        position.fromIndex >= 0 &&
        shown.has(position.toIndex) &&
        (upcomingOnly || shown.has(position.fromIndex));

    const listRef = useRef<HTMLOListElement>(null);
    const dots = useRef(new Map<number, HTMLSpanElement>());
    const nowRef = useRef<HTMLLIElement>(null);
    const [layout, setLayout] = useState<{
        dots: Map<number, number>;
        nowTop: number | null;
    } | null>(null);
    // The layout the marker may glide in; a new layout places it at once
    const [glideFor, setGlideFor] = useState<typeof layout>(null);
    const shape = `${stops.map((s) => s.index).join(",")}|${showNow}`;

    // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the rows change
    useLayoutEffect(() => {
        const list = listRef.current;
        if (!list) return;
        const measure = () => {
            const top = list.getBoundingClientRect().top;
            const ys = new Map<number, number>();
            for (const [index, el] of dots.current) {
                const r = el.getBoundingClientRect();
                ys.set(index, r.top + r.height / 2 - top);
            }
            const now = nowRef.current?.getBoundingClientRect();
            setLayout({ dots: ys, nowTop: now ? now.top - top : null });
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(list);
        return () => observer.disconnect();
    }, [shape]);

    // Glide between position updates only, never on (re)layout
    useEffect(() => {
        if (!layout || glideFor === layout) return;
        const id = requestAnimationFrame(() => setGlideFor(layout));
        return () => cancelAnimationFrame(id);
    }, [layout, glideFor]);

    let rail: {
        top: number;
        bottom: number;
        train: number;
        label: number;
    } | null = null;
    if (layout && stops.length > 0) {
        const first = stops[0];
        const last = stops[stops.length - 1];
        const firstY = layout.dots.get(first?.index ?? -1);
        const lastY = layout.dots.get(last?.index ?? -1);
        if (firstY != null && lastY != null) {
            // Keep the marker clear of the stop dots it travels between
            const toY = layout.dots.get(position.toIndex);
            const fromDot = layout.dots.get(position.fromIndex);
            const fromY =
                fromDot != null
                    ? fromDot + MARKER_GAP
                    : upcomingOnly && layout.nowTop != null
                      ? layout.nowTop + MARKER_GAP
                      : undefined;
            const train =
                position.fromIndex < 0
                    ? firstY
                    : fromY != null && toY != null
                      ? fromY + Math.max(0, toY - MARKER_GAP - fromY) * fraction
                      : null;
            if (train != null) {
                const top =
                    upcomingOnly && layout.nowTop != null
                        ? layout.nowTop
                        : firstY;
                // The label rides with the marker, clear of the stop names
                const low =
                    fromDot != null
                        ? fromDot + LABEL_GAP
                        : (layout.nowTop ?? train) + LABEL_GAP / 2;
                const high = toY != null ? toY - LABEL_GAP : train;
                const label =
                    low <= high ? Math.min(high, Math.max(low, train)) : train;
                rail = { top, bottom: lastY, train, label };
            }
        }
    }
    const glide =
        layout && glideFor === layout && !reduce ? "1000ms linear" : undefined;

    const setDot = (index: number) => (el: HTMLSpanElement | null) => {
        if (el) dots.current.set(index, el);
        else dots.current.delete(index);
    };

    return (
        <div className="relative">
            {rail && (
                <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0"
                >
                    <span
                        className="absolute w-0.5 -translate-x-1/2 rounded-full bg-line"
                        style={{
                            left: RAIL_X,
                            top: rail.top,
                            height: Math.max(0, rail.bottom - rail.top),
                        }}
                    />
                    <span
                        className="absolute w-0.5 -translate-x-1/2 rounded-full bg-ink-2"
                        style={{
                            left: RAIL_X,
                            top: rail.top,
                            height: Math.max(0, rail.train - rail.top),
                            transition: glide && `height ${glide}`,
                        }}
                    />
                </div>
            )}
            <ol ref={listRef} className="relative flex flex-col">
                {stops.map((stop) => (
                    <Fragment key={`${stop.index}-${stop.name}`}>
                        {showNow && stop.index === position.toIndex && (
                            <li ref={nowRef} className="h-9">
                                {rail && (
                                    <PositionLabel
                                        {...positionLabel(view, fraction, t)}
                                        top={rail.label}
                                        glide={glide}
                                    />
                                )}
                            </li>
                        )}
                        <li>
                            <StopRow
                                stop={stop}
                                stops={view.stops}
                                stale={view.stale}
                                dotRef={setDot(stop.index)}
                            />
                        </li>
                    </Fragment>
                ))}
            </ol>
            {rail && (
                <span
                    role="img"
                    aria-label={t("position")}
                    className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2"
                    style={{
                        left: RAIL_X,
                        top: rail.train,
                        transition: glide && `top ${glide}`,
                    }}
                >
                    <svg
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        aria-hidden="true"
                        className={cn(
                            "block",
                            view.stale ? "text-stale" : "text-ink",
                        )}
                    >
                        <path
                            d="M8 14.5L14.5 2.5H1.5z"
                            fill="currentColor"
                            stroke="var(--mhav-surface)"
                            strokeWidth="2"
                            strokeLinejoin="round"
                            paintOrder="stroke"
                        />
                    </svg>
                </span>
            )}
        </div>
    );
}

/** "még 8 km · 112 km/h" beside the marker; placed in the list's frame. */
function PositionLabel({
    place,
    motion,
    top,
    glide,
}: {
    place: string | null;
    motion: string;
    top: number;
    glide: string | undefined;
}) {
    return (
        <span
            className="absolute right-0 left-[26px] flex -translate-y-1/2 items-center gap-1 truncate text-caption font-bold text-ink"
            style={{ top, transition: glide && `top ${glide}` }}
        >
            {place && (
                <>
                    <span className="truncate">{place}</span>
                    <span aria-hidden>·</span>
                </>
            )}
            <span className="shrink-0">{motion}</span>
        </span>
    );
}

/** Services valid at a stop (or the whole trip), each explained on tap. */
function ServiceList({
    services,
    stops,
    className,
}: {
    services: InfoService[];
    stops: StopView[];
    className?: string;
}) {
    if (services.length === 0) return null;
    return (
        <span className={cn("flex flex-wrap gap-1", className)}>
            {services.map((service) => {
                const from = stops[service.fromStopIndex]?.name;
                const till = stops[service.tillStopIndex]?.name;
                const range =
                    from &&
                    till &&
                    (service.fromStopIndex > 0 ||
                        service.tillStopIndex < stops.length - 1)
                        ? `${from} – ${till}`
                        : null;
                return (
                    <TapTip
                        key={`${service.fontCode}-${service.name}`}
                        label={service.name}
                        content={
                            <span className="flex flex-col">
                                <span>{service.name}</span>
                                {range && (
                                    <span className="text-caption text-ink-2">
                                        {range}
                                    </span>
                                )}
                            </span>
                        }
                        className="flex min-h-6 min-w-6 items-center justify-center"
                    >
                        <span className={mnr2007.className} aria-hidden>
                            {String.fromCharCode(Number(service.fontCode))}
                        </span>
                    </TapTip>
                );
            })}
        </span>
    );
}

function StopRow({
    stop,
    stops,
    stale,
    dotRef,
}: {
    stop: StopView;
    stops: StopView[];
    stale: boolean;
    dotRef: (el: HTMLSpanElement | null) => void;
}) {
    const t = useTranslations("Train");
    const { timing } = stop;
    const level = levelOf(timing.delay);
    const estimated = !stop.passed && (stale || timing.estimated);
    const strong = stop.isNext || stop.isLast;
    const name = (
        <span
            className={cn(
                "block truncate text-left text-[15px] leading-[22px]",
                stop.passed ? "text-ink-2" : "text-ink",
                strong && "font-semibold",
            )}
        >
            {stop.name}
        </span>
    );
    return (
        <div className="grid min-h-11 grid-cols-[18px_minmax(0,1fr)_auto_34px] items-start gap-x-2 py-[11px]">
            <span className="flex h-[22px] items-center justify-center">
                <span
                    ref={dotRef}
                    aria-hidden
                    className={cn(
                        "relative z-[1] shrink-0 rounded-full",
                        stop.passed
                            ? "size-2.5 bg-ink-2 ring-2 ring-surface"
                            : stop.isLast
                              ? "size-3 bg-ink ring-2 ring-surface"
                              : stop.isNext
                                ? "size-3 border-2 border-ink bg-surface"
                                : "size-3 border-2 border-line bg-surface",
                    )}
                />
            </span>
            <span className="flex min-w-0 flex-col">
                {stop.county ? (
                    <TapTip
                        label={`${stop.name}, ${t("county", { county: stop.county })}`}
                        content={t("county", { county: stop.county })}
                        className="min-w-0"
                    >
                        {name}
                    </TapTip>
                ) : (
                    name
                )}
                <ServiceList
                    services={stop.services}
                    stops={stops}
                    className="text-sm text-ink-2"
                />
            </span>
            <span className="flex flex-col items-end">
                <TimeText
                    seconds={timing.expected}
                    estimated={estimated}
                    level={level}
                    className={cn(
                        "text-[15px] leading-[22px] font-semibold",
                        stop.passed && "opacity-80",
                    )}
                />
                {timing.departure && (
                    <span className="tnum text-caption text-ink-2">
                        {t("departs", {
                            time: `${estimated ? "≈" : ""}${formatSecondsAsTime(timing.departure.expected)}`,
                        })}
                    </span>
                )}
            </span>
            <span className="flex h-[22px] items-center justify-end">
                {stop.platform && (
                    <PlatformBadge
                        platform={stop.platform}
                        predicted={stop.platformPredicted}
                        passed={stop.passed}
                    />
                )}
            </span>
        </div>
    );
}

/** Service glyphs (bike, restaurant, ...) valid for the whole trip. */
export function ServiceGlyphs({ view }: { view: TrainView }) {
    return (
        <ServiceList
            services={view.services}
            stops={view.stops}
            className="gap-1.5 text-lg text-ink-2"
        />
    );
}

/** Collapsible vehicle facts and data-quality notes. */
export function VehicleDetails({ view }: { view: TrainView }) {
    const t = useTranslations("Train");
    const locale = useLocale();
    const [open, setOpen] = useState(false);
    const { vehicle } = view;
    const farFromRoute = isFarFromRoute(vehicle);
    const mismatch =
        isActive(vehicle) && dataAppearsFalsified(vehicle, view.stale);
    const rows: [string, string][] = [
        [
            t("vehicle_type_label"),
            t(`vehicle_type.${vehicleTypeFromUICCode(vehicle.vehicleId)}`),
        ],
        [t("uic"), formatUICCode(vehicle.vehicleId)],
        [t("speed"), `${Math.round((vehicle.speed ?? 0) * 3.6)} km/h`],
        [
            t("updated"),
            formatDistanceToNow(new Date(vehicle.lastUpdated * 1000), {
                addSuffix: true,
                locale: locale === "hu" ? hu : enGB,
            }),
        ],
    ];
    return (
        <div className="rounded-md bg-surface-2">
            <button
                type="button"
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-3 text-[15px] font-semibold"
                onClick={() => setOpen(!open)}
                aria-expanded={open}
            >
                <ChevronRight
                    className={cn(
                        "size-4 transition-transform",
                        open && "rotate-90",
                    )}
                    aria-hidden
                />
                {t("vehicle")}
            </button>
            {open && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-3 pb-3 text-sm">
                    {rows.map(([label, value]) => (
                        <div key={label} className="contents">
                            <dt className="text-ink-2">{label}</dt>
                            <dd className="tnum">{value}</dd>
                        </div>
                    ))}
                    {(farFromRoute || mismatch) && (
                        <p className="col-span-2 mt-1 text-ink-2">
                            {farFromRoute
                                ? t("far_from_route")
                                : t("data_mismatch")}
                        </p>
                    )}
                </dl>
            )}
        </div>
    );
}

/** Skeleton while the details load: action pills and stop rows (S6). */
export function StopListSkeleton() {
    return (
        <div className="flex flex-col gap-4 py-1" aria-hidden>
            <div className="flex gap-2">
                <Skeleton className="h-11 flex-1 rounded-full" />
                <Skeleton className="size-11 rounded-full" />
                <Skeleton className="h-11 w-20 rounded-full" />
            </div>
            <div className="flex flex-col gap-5 pt-1">
                {[100, 70, 55].map((w) => (
                    <div key={w} className="flex items-center gap-3">
                        <Skeleton className="size-2.5 rounded-full" />
                        <Skeleton
                            className="h-3.5"
                            style={{ width: `${w * 0.6}%` }}
                        />
                        <Skeleton className="ml-auto h-3.5 w-11" />
                    </div>
                ))}
            </div>
        </div>
    );
}

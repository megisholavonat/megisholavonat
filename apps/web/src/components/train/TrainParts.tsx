"use client";

import type { TrainFeatureProperties } from "@megisholavonat/api-client";
import {
    DELAY_REASON_TEXTS,
    DELAY_REASONS,
    normalizeAlertText,
} from "@megisholavonat/core/delayReasons";
import type { Locale } from "@megisholavonat/core/i18n";
import { formatSecondsAsTime } from "@megisholavonat/core/time";
import {
    formatUICCode,
    vehicleTypeFromUICCode,
} from "@megisholavonat/core/uic";
import {
    dataAppearsFalsified,
    isFarFromRoute,
} from "@megisholavonat/core/vehicle";
import { formatDistanceToNow } from "date-fns";
import { enGB, hu } from "date-fns/locale";
import {
    ArrowRight,
    ArrowUpRight,
    Check,
    ChevronLeft,
    ChevronRight,
    Share,
    Triangle,
    X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import {
    DelayTile,
    levelOf,
    TEXT_CLASS,
    TINT_CLASS,
} from "@/components/ui/Delay";
import { PlatformBadge } from "@/components/ui/Platform";
import { ReasonIcon } from "@/components/ui/ReasonIcon";
import { RouteGlyph } from "@/components/ui/RouteGlyph";
import {
    destinationOf,
    type TrainReason,
    trainName,
    trainNumber,
} from "@/lib/train";
import { cn } from "@/lib/utils";
import { mnr2007 } from "@/util/fonts";
import { type StopView, type TrainView, useShownDelay } from "./useTrainView";

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
                "flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-surface-2 text-ink transition-colors hover:bg-line",
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
            {destination && (
                <>
                    <ArrowRight className="size-4 shrink-0" aria-hidden />
                    <span className="truncate">{destination}</span>
                </>
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
    const { delay, stale } = useShownDelay(view, fallback);
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
                    <span className="h-5 w-40 animate-pulse rounded-sm bg-surface-2" />
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

/** Ticket and share. Following comes with the commute features. */
export function TrainActions({ view }: { view: TrainView }) {
    const t = useTranslations("Train");
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
            <a
                href={view.ticketUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full bg-action px-4 text-[15px] font-semibold text-on-action"
            >
                {t("ticket")}
                <ArrowUpRight className="size-4" aria-hidden />
            </a>
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
        </div>
    );
}

function reasonLabel(
    reason: TrainReason,
    locale: Locale,
    fallback: string,
): string {
    return reason.code ? DELAY_REASONS[reason.code][locale] : fallback;
}

/**
 * Delay reason. Compact: icon + short label, only for known reasons.
 * Detailed: label plus MÁV's full text.
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
    const locale = useLocale() as Locale;
    if (!detailed && !reason.code) return null;
    const level = levelOf(Math.max(delay, 5));
    const label = reasonLabel(reason, locale, t("disruption"));
    // MÁV's stock sentence for a known reason says nothing the label doesn't
    const showText =
        detailed &&
        !Object.hasOwn(DELAY_REASON_TEXTS, normalizeAlertText(reason.text));
    return (
        <div
            className={cn(
                "flex items-start gap-2.5 rounded-md px-3 py-2.5",
                TINT_CLASS[level],
            )}
        >
            <ReasonIcon
                code={reason.code}
                className={cn("mt-0.5 size-4.5 shrink-0", TEXT_CLASS[level])}
            />
            <div className="min-w-0 text-sm">
                <p className="font-semibold text-ink">{label}</p>
                {showText && <p className="mt-0.5 text-ink-2">{reason.text}</p>}
            </div>
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

/** Stop list: past stops grey, the train's position, platforms. */
export function StopList({
    view,
    upcomingOnly = false,
}: {
    view: TrainView;
    upcomingOnly?: boolean;
}) {
    const t = useTranslations("Train");
    const speed = Math.round((view.vehicle.speed ?? 0) * 3.6);
    const nextIndex = view.next?.index ?? -1;
    const stops = upcomingOnly
        ? view.stops.filter((s) => !s.passed).slice(0, 4)
        : view.stops;
    return (
        <ol className="flex flex-col">
            {stops.map((stop) => (
                <li key={`${stop.index}-${stop.name}`}>
                    {stop.index === nextIndex && nextIndex > 0 && (
                        <div className="flex items-center gap-3 py-1.5 text-caption font-bold text-ink">
                            <Triangle
                                className="ml-[3px] size-2.5 rotate-180 fill-current"
                                aria-hidden
                            />
                            <span>
                                {speed > 0 ? `${speed} km/h` : t("standing")}
                            </span>
                        </div>
                    )}
                    <StopRow stop={view.stops[stop.index]} stale={view.stale} />
                </li>
            ))}
        </ol>
    );
}

function StopRow({ stop, stale }: { stop: StopView; stale: boolean }) {
    const { timing } = stop;
    const level = levelOf(timing.delay);
    return (
        <div className="flex min-h-11 items-center gap-3 py-1">
            <span
                aria-hidden
                className={cn(
                    "size-2.5 shrink-0 rounded-full",
                    stop.passed
                        ? "bg-ink-2/60"
                        : stop.isLast
                          ? "bg-ink"
                          : stop.isNext
                            ? "border-2 border-ink"
                            : "border-[1.5px] border-ink-2",
                )}
            />
            <span
                className={cn(
                    "min-w-0 flex-1 truncate text-[15px]",
                    stop.passed ? "text-ink-2" : "text-ink",
                    (stop.isNext || stop.isLast) && "font-semibold",
                )}
                title={stop.county ?? undefined}
            >
                {stop.name}
            </span>
            <TimeText
                seconds={timing.expected}
                estimated={!stop.passed && (stale || timing.estimated)}
                level={level}
                className={cn(
                    "text-[15px] font-semibold",
                    stop.passed && "opacity-80",
                )}
            />
            <span className="flex w-9 justify-end">
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
    const last = view.stops.length - 1;
    const services = view.vehicle.trip.infoServices.filter(
        (s) =>
            s.displayable !== false &&
            s.fromStopIndex === 0 &&
            s.tillStopIndex === last,
    );
    if (services.length === 0) return null;
    return (
        <div className="flex flex-wrap gap-1.5 text-lg text-ink-2">
            {services.map((service) => (
                <span
                    key={`${service.fontCode}-${service.name}`}
                    role="img"
                    aria-label={service.name}
                    title={service.name}
                    className={mnr2007.className}
                >
                    {String.fromCharCode(Number(service.fontCode))}
                </span>
            ))}
        </div>
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
        view.display.state === "running" &&
        dataAppearsFalsified(vehicle, view.stale);
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

/** Skeleton rows while the details load. */
export function StopListSkeleton() {
    return (
        <div className="flex flex-col gap-4 py-2" aria-hidden>
            {[60, 45, 52].map((w) => (
                <div key={w} className="flex items-center gap-3">
                    <span className="size-2.5 rounded-full bg-surface-2" />
                    <span
                        className="h-4 rounded-sm bg-surface-2"
                        style={{ width: `${w}%` }}
                    />
                    <span className="ml-auto h-4 w-10 rounded-sm bg-surface-2" />
                </div>
            ))}
        </div>
    );
}

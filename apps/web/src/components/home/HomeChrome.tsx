"use client";

import type { TrainFeatureCollection } from "@megisholavonat/api-client";
import { STALE_GREY_AFTER_S } from "@megisholavonat/core/constants";
import {
    Clock,
    Layers,
    Moon,
    RefreshCw,
    Settings as SettingsIcon,
    TriangleAlert,
} from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { FILL_CLASS, type Level } from "@/components/ui/Delay";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { type Settings, setSetting, useSettings } from "@/hooks/useSettings";
import { cn } from "@/lib/utils";

/** Minutes without fresh positions after which the whole map is flagged */
export const FEED_STALE_MINUTES = STALE_GREY_AFTER_S / 60;
/** With no trains and data this old, the source is considered down */
const FEED_DOWN_MINUTES = 15;

export type FeedState =
    | { kind: "loading" }
    | { kind: "ok" }
    | { kind: "stale"; minutes: number }
    | { kind: "empty" }
    | { kind: "source_down"; since: Date | null }
    | { kind: "unreachable" };

export function feedState(
    data: TrainFeatureCollection | undefined,
    isError: boolean,
    isPending: boolean,
): FeedState {
    if (isPending) return { kind: "loading" };
    if (isError && !data) return { kind: "unreachable" };
    if (!data) return { kind: "loading" };
    const age = data.dataAgeMinutes ?? null;
    const hasTrains = data.features.length > 0;
    if (
        data.noDataReceived ||
        (age !== null && age >= FEED_DOWN_MINUTES && !hasTrains)
    ) {
        return {
            kind: "source_down",
            since: age !== null ? new Date(Date.now() - age * 60_000) : null,
        };
    }
    if (!hasTrains) return { kind: "empty" };
    if (age !== null && age >= FEED_STALE_MINUTES) {
        return { kind: "stale", minutes: Math.floor(age) };
    }
    return { kind: "ok" };
}

const LEGEND: { level: Level; key: string }[] = [
    { level: "onTime", key: "on_time" },
    { level: "slight", key: "slight" },
    { level: "moderate", key: "moderate" },
    { level: "severe", key: "severe" },
    { level: "stale", key: "stale" },
];

function Swatch({ level }: { level: Level }) {
    return (
        <span
            aria-hidden
            className={cn(
                "size-2.5 shrink-0 rounded-full",
                level === "stale"
                    ? "border border-dashed border-stale"
                    : FILL_CLASS[level],
            )}
        />
    );
}

/**
 * Delay colours. Desktop: one quiet row. Phone: just the dots, tapping
 * shows the labels.
 */
export function Legend({ isDesktop }: { isDesktop: boolean }) {
    const t = useTranslations("Legend");
    const [open, setOpen] = useState(false);
    const expanded = isDesktop || open;
    const content = (
        <span className={cn("flex items-center", expanded ? "gap-3" : "gap-1")}>
            {LEGEND.map(({ level, key }) => (
                <span key={key} className="flex items-center gap-1.5">
                    <Swatch level={level} />
                    {expanded && (
                        <span className="text-caption font-semibold whitespace-nowrap text-ink">
                            {t(key)}
                        </span>
                    )}
                </span>
            ))}
        </span>
    );
    if (isDesktop) {
        return (
            <div
                role="img"
                aria-label={t("label")}
                className="floating-card rounded-md px-3 py-2"
            >
                {content}
            </div>
        );
    }
    return (
        <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-label={t("label")}
            className="floating-card flex h-11 cursor-pointer items-center rounded-full px-4"
        >
            {content}
        </button>
    );
}

/** "7 perce nincs friss adat" pill at the top of the map. */
export function StaleBanner({ minutes }: { minutes: number }) {
    const t = useTranslations("States");
    return (
        <div
            role="status"
            className="floating-card flex h-9 items-center gap-2 rounded-full px-3.5 text-sm font-semibold"
        >
            <Clock className="size-4" aria-hidden />
            {t("stale", { minutes })}
        </div>
    );
}

const timeFormat = new Intl.DateTimeFormat("hu-HU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Budapest",
});

/** Empty and error states, shown in the home sheet / card. */
export function FeedMessage({
    state,
    onRetry,
}: {
    state: FeedState;
    onRetry: () => void;
}) {
    const t = useTranslations("States");
    if (state.kind === "empty") {
        return (
            <div className="flex items-center gap-3">
                <span className="flex size-11 items-center justify-center rounded-md bg-surface-2">
                    <Moon className="size-5" aria-hidden />
                </span>
                <p className="text-headline">{t("no_trains")}</p>
            </div>
        );
    }
    if (state.kind !== "source_down" && state.kind !== "unreachable") {
        return null;
    }
    return (
        <div className="flex flex-col gap-3" role="alert">
            <div className="flex items-center gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-delay-moderate-tint">
                    <TriangleAlert
                        className="size-5 text-delay-moderate"
                        aria-hidden
                    />
                </span>
                <div className="min-w-0">
                    <p className="text-headline">
                        {state.kind === "source_down"
                            ? t("source_down")
                            : t("unreachable")}
                    </p>
                    {state.kind === "source_down" && state.since && (
                        <p className="text-sm text-ink-2">
                            {t("since", {
                                time: timeFormat.format(state.since),
                            })}
                        </p>
                    )}
                </div>
            </div>
            <button
                type="button"
                onClick={onRetry}
                className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-full bg-action text-[15px] font-semibold text-on-action"
            >
                <RefreshCw className="size-4" aria-hidden />
                {t("retry")}
            </button>
        </div>
    );
}

export function SettingsButton({
    onClick,
    className,
}: {
    onClick: () => void;
    className?: string;
}) {
    const t = useTranslations("Settings");
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={t("title")}
            title={t("title")}
            className={className ?? "map-button"}
        >
            <SettingsIcon className="size-5" aria-hidden />
        </button>
    );
}

/** Desktop: what the map shows, one click away. */
export function LayersButton() {
    const t = useTranslations("Settings");
    const settings = useSettings();
    const rows: [keyof Settings, string][] = [
        ["showRailwayOverlay", t("railway_lines")],
        ["showStationNames", t("station_names")],
        ["showTrains", t("trains")],
        ["showHev", t("hev")],
        ["showTramTrains", t("tramtrain")],
    ];
    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label={t("layers")}
                    title={t("layers")}
                    className="map-button rounded-md"
                >
                    <Layers className="size-5" aria-hidden />
                </button>
            </PopoverTrigger>
            <PopoverContent
                align="end"
                className="w-64 rounded-lg border-line p-1"
            >
                {rows.map(([key, label]) => (
                    <label
                        key={key}
                        htmlFor={`layer-${key}`}
                        className="flex h-11 cursor-pointer items-center gap-3 px-3 text-[15px]"
                    >
                        <span className="flex-1">{label}</span>
                        <Switch
                            id={`layer-${key}`}
                            checked={settings[key] as boolean}
                            onCheckedChange={(checked) =>
                                setSetting(key, checked)
                            }
                        />
                    </label>
                ))}
            </PopoverContent>
        </Popover>
    );
}

/** App mark + name, for the desktop card. */
export function Wordmark() {
    const t = useTranslations("Home");
    return (
        <div className="flex min-w-0 items-center gap-2.5">
            <Image
                src="/icon1.png"
                alt=""
                width={28}
                height={28}
                className="rounded-[7px]"
                priority
            />
            <h1 className="truncate text-headline font-bold tracking-tight">
                {t("app_title")}
            </h1>
        </div>
    );
}

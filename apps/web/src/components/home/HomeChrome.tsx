"use client";

import type { TrainFeatureCollection } from "@megisholavonat/api-client";
import { STALE_GREY_AFTER_S } from "@megisholavonat/core/constants";
import { LEVEL_FROM_MIN } from "@megisholavonat/core/delay";
import { formatClock } from "@megisholavonat/core/time";
import {
    Clock,
    Layers,
    Moon,
    RefreshCw,
    Settings as SettingsIcon,
    TriangleAlert,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { AppIcon } from "@/components/ui/AppIcon";
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

type LegendLevel = Level | "inactive";

const LEGEND: { level: LegendLevel; key: string; from?: string }[] = [
    { level: "onTime", key: "on_time", from: `${LEVEL_FROM_MIN.onTime}` },
    { level: "slight", key: "slight", from: `${LEVEL_FROM_MIN.slight}` },
    { level: "moderate", key: "moderate", from: `${LEVEL_FROM_MIN.moderate}` },
    { level: "severe", key: "severe", from: `${LEVEL_FROM_MIN.severe}+` },
    { level: "stale", key: "stale" },
    { level: "inactive", key: "inactive" },
];
/** The delay steps, each with the minute it starts from */
const STEPS = LEGEND.filter((l) => l.from);

const EASE_SHEET = [0.32, 0.72, 0, 1] as const;

/** A stale marker's label: its last known delay with a "?" */
const STALE_SAMPLE = "+12?";

function Swatch({ level }: { level: LegendLevel }) {
    if (level === "stale") {
        // The map's hollow dashed pill, with its last delay and a "?"
        return (
            <span
                aria-hidden
                className="tnum flex h-4 shrink-0 items-center rounded-full border-[1.5px] border-dashed border-stale px-1 text-[10px] leading-none font-bold text-stale"
            >
                {STALE_SAMPLE}
            </span>
        );
    }
    return (
        <span
            aria-hidden
            className={cn(
                "size-2.5 shrink-0 rounded-full",
                level === "inactive"
                    ? "bg-stale-fill ring-1 ring-stale"
                    : FILL_CLASS[level],
            )}
        />
    );
}

/** "6+ perc" for the delay steps, the plain label otherwise. */
function useLegendLabel() {
    const t = useTranslations("Legend");
    return (level: LegendLevel, key: string, withUnit: boolean) =>
        withUnit && level !== "stale" && level !== "inactive"
            ? `${t(key)} ${t("minutes")}`
            : level === "stale"
              ? `${STALE_SAMPLE} ${t(key)}`
              : t(key);
}

/**
 * Delay colours. Desktop: one quiet row, "Késés" first so the steps read as
 * minutes late. Phone: a slim pill with each colour and the minute it starts
 * from; tapping opens the full list above it, the grey markers included.
 */
export function Legend({ isDesktop }: { isDesktop: boolean }) {
    const t = useTranslations("Legend");
    const label = useLegendLabel();
    const [open, setOpen] = useState(false);
    const reduceMotion = useReducedMotion() ?? false;
    const rootRef = useRef<HTMLDivElement>(null);
    const listId = useId();

    // Tap anywhere else (or Esc) folds it back
    useEffect(() => {
        if (!open) return;
        const onPointer = (e: PointerEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false);
        };
        document.addEventListener("pointerdown", onPointer);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("pointerdown", onPointer);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    if (isDesktop) {
        return (
            <div
                role="img"
                aria-label={`${t("label")}: ${LEGEND.map(({ level, key }) => label(level, key, true)).join(", ")}`}
                className="floating-card mb-2 flex items-center gap-3 rounded-md px-3 py-2 dark:ring-1 dark:ring-line"
            >
                <span className="text-caption font-normal text-ink-2">
                    {t("title")}
                </span>
                {LEGEND.map(({ level, key }) => (
                    <span key={key} className="flex items-center gap-1.5">
                        <Swatch level={level} />
                        <span className="text-caption font-semibold whitespace-nowrap text-ink">
                            {key === "severe"
                                ? label(level, key, true)
                                : t(key)}
                        </span>
                    </span>
                ))}
            </div>
        );
    }
    return (
        <div ref={rootRef} className="relative">
            <AnimatePresence>
                {open && (
                    <motion.div
                        id={listId}
                        key="legend"
                        initial={{
                            opacity: 0,
                            scale: reduceMotion ? 1 : 0.92,
                            y: reduceMotion ? 0 : 8,
                        }}
                        animate={{
                            opacity: 1,
                            scale: 1,
                            y: 0,
                            transition: {
                                duration: reduceMotion ? 0.12 : 0.24,
                                ease: EASE_SHEET,
                            },
                        }}
                        exit={{
                            opacity: 0,
                            scale: reduceMotion ? 1 : 0.96,
                            y: reduceMotion ? 0 : 4,
                            transition: { duration: 0.15, ease: "easeIn" },
                        }}
                        style={{ transformOrigin: "bottom left" }}
                        className="floating-card absolute bottom-full left-0 mb-2 flex min-w-40 flex-col gap-2 rounded-lg px-3.5 py-3 dark:ring-1 dark:ring-line"
                    >
                        <span className="text-caption font-normal text-ink-2">
                            {t("title")}
                        </span>
                        <ul
                            aria-label={t("label")}
                            className="flex flex-col gap-2"
                        >
                            {LEGEND.map(({ level, key }) => (
                                <li
                                    key={key}
                                    className="flex items-center gap-2.5"
                                >
                                    <span className="flex w-6 shrink-0 justify-center">
                                        <Swatch level={level} />
                                    </span>
                                    <span className="text-sm font-semibold whitespace-nowrap text-ink">
                                        {level === "stale"
                                            ? t(key)
                                            : label(level, key, true)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </motion.div>
                )}
            </AnimatePresence>
            <button
                type="button"
                onClick={() => setOpen(!open)}
                aria-expanded={open}
                aria-controls={open ? listId : undefined}
                aria-label={t("label")}
                // Slim over the map, with a 44 px tap target all the same
                className="floating-card pressable relative flex h-8 cursor-pointer items-center gap-2 rounded-full px-3 before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] dark:ring-1 dark:ring-line"
            >
                {/* The dots say what they are: never a context-free key */}
                <span
                    aria-hidden
                    className="text-caption font-semibold text-ink-2"
                >
                    {t("title")}
                </span>
                {STEPS.map(({ level, key, from }) => (
                    <span
                        key={key}
                        aria-hidden
                        className="flex items-center gap-1"
                    >
                        <Swatch level={level} />
                        <span className="tnum text-caption font-semibold text-ink">
                            {from}
                        </span>
                    </span>
                ))}
                <span aria-hidden className="text-caption text-ink-2">
                    {t("minutes")}
                </span>
            </button>
        </div>
    );
}

/**
 * "7 perce nincs friss adat" pill at the top of the map. Pass `null` (and
 * keep it mounted) to let it fade out instead of vanishing.
 */
export function StaleBanner({ minutes }: { minutes: number | null }) {
    const t = useTranslations("States");
    const reduceMotion = useReducedMotion() ?? false;
    return (
        <AnimatePresence>
            {minutes !== null && (
                <motion.div
                    key="stale"
                    role="status"
                    initial={{ opacity: 0, y: reduceMotion ? 0 : -8 }}
                    animate={{
                        opacity: 1,
                        y: 0,
                        transition: { duration: 0.24, ease: EASE_SHEET },
                    }}
                    exit={{
                        opacity: 0,
                        y: reduceMotion ? 0 : -8,
                        transition: { duration: 0.2, ease: "easeIn" },
                    }}
                    className="floating-card flex h-9 items-center gap-2 rounded-full px-3.5 text-sm font-semibold dark:ring-1 dark:ring-line"
                >
                    <Clock className="size-4" aria-hidden />
                    {t("stale", { minutes })}
                </motion.div>
            )}
        </AnimatePresence>
    );
}

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
            <div className="flex animate-in items-center gap-3 duration-200 fade-in-0 motion-reduce:animate-none">
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
        <div
            className="flex animate-in flex-col gap-3 duration-200 fade-in-0 motion-reduce:animate-none"
            role="alert"
        >
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
                    {state.kind === "source_down" && (
                        // Boards and the planner keep working from the
                        // timetable while the live feed is out
                        <p className="tnum text-sm text-ink-2">
                            {state.since
                                ? `${t("since", {
                                      time: formatClock(
                                          state.since.getTime() / 1000,
                                      ),
                                  })} · ${t("timetable")}`
                                : t("timetable")}
                        </p>
                    )}
                </div>
            </div>
            <button
                type="button"
                onClick={onRetry}
                className="pressable flex h-11 cursor-pointer items-center justify-center gap-2 rounded-full bg-action text-[15px] font-semibold text-on-action"
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
            className={cn("pressable", className ?? "map-button")}
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
        <div className="flex min-w-0 items-center gap-2">
            <AppIcon size={26} />
            <h1 className="truncate text-headline font-extrabold tracking-[-0.02em]">
                {t("app_title")}
            </h1>
        </div>
    );
}

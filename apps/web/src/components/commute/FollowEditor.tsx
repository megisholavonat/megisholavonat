"use client";

import {
    defaultBoardingIndex,
    localWeekday,
    tripRun,
} from "@megisholavonat/core/commute";
import { formatSecondsAsTime } from "@megisholavonat/core/time";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronDown, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useRecentStations } from "@/components/search/useSearch";
import { TrainTitle } from "@/components/train/TrainParts";
import type { TrainView } from "@/components/train/useTrainView";
import {
    type Follow,
    findFollow,
    removeFollow,
    saveFollow,
    useFollows,
} from "@/hooks/useFollows";
import { destinationOf, stationIdOf, trainNumber } from "@/lib/train";
import { cn } from "@/lib/utils";

/** What the editor opens on: a live train, or a saved follow. */
export type FollowTarget =
    | { kind: "train"; view: TrainView }
    | { kind: "follow"; follow: Follow };

interface BoardingOption {
    key: string;
    stationId: string;
    name: string;
    lat: number;
    lon: number;
    /** Local time of day, seconds */
    departureS: number;
    /** Local date of this run's departure */
    date: string | null;
    /** Scheduled time from here to the end of the trip, s */
    runS: number | null;
    /** Index of the stop in the train's stoptimes; -1 for a saved one */
    index: number;
}

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const WORKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [6, 7];

function optionOf(follow: Follow): BoardingOption {
    return {
        key: `saved-${follow.fromStationId}`,
        stationId: follow.fromStationId,
        name: follow.fromName,
        lat: follow.fromLat,
        lon: follow.fromLon,
        departureS: follow.departureS,
        date: follow.date,
        runS: follow.runS ?? null,
        index: -1,
    };
}

function trainOptions(view: TrainView, now: Date): BoardingOption[] {
    const { trip } = view.vehicle;
    const stoptimes = trip.stoptimes;
    const options: BoardingOption[] = [];
    const end = stoptimes.at(-1)?.scheduledArrival ?? null;
    stoptimes.forEach((stoptime, i) => {
        // Nobody boards at the last stop
        if (i === stoptimes.length - 1) return;
        const stationId = stationIdOf(stoptime.stop);
        if (!stationId) return;
        const departure = stoptime.scheduledDeparture;
        // The real day: OTP dates HÉVs after midnight and train 10 off by one
        const run = tripRun(trip, departure, now);
        options.push({
            key: `${i}-${stationId}`,
            stationId,
            name: stoptime.stop.name,
            lat: stoptime.stop.lat,
            lon: stoptime.stop.lon,
            departureS: run.timeOfDay,
            date: run.date,
            runS: end === null ? null : Math.max(0, end - departure),
            index: i,
        });
    });
    return options;
}

/** Day chips: H K Sze Cs P Szo V. */
function DayPicker({
    days,
    onChange,
}: {
    days: number[];
    onChange: (days: number[]) => void;
}) {
    const t = useTranslations("Follow");
    const locale = useLocale();
    const longNames = useMemo(() => {
        const format = new Intl.DateTimeFormat(locale, { weekday: "long" });
        // 2026-11-02 is a Monday
        return WEEKDAYS.map((d) =>
            format.format(new Date(Date.UTC(2026, 10, 1 + d, 12))),
        );
    }, [locale]);
    return (
        <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-caption font-semibold text-ink-2">
                {t("days")}
            </legend>
            <div className="flex justify-between gap-1">
                {WEEKDAYS.map((day, i) => {
                    const on = days.includes(day);
                    return (
                        <button
                            key={day}
                            type="button"
                            aria-pressed={on}
                            aria-label={longNames[i]}
                            title={longNames[i]}
                            onClick={() =>
                                onChange(
                                    on
                                        ? days.filter((d) => d !== day)
                                        : [...days, day].sort(),
                                )
                            }
                            className={cn(
                                "flex size-11 cursor-pointer items-center justify-center rounded-full text-sm font-semibold transition-colors",
                                on
                                    ? "bg-action text-on-action"
                                    : // Outlined, not greyed: off, not unavailable
                                      "border-2 border-line bg-surface text-ink hover:border-ink-2",
                            )}
                        >
                            {t(`day_${day}`)}
                        </button>
                    );
                })}
            </div>
            {days.length === 0 && (
                <p className="text-caption text-ink-2">{t("today_only")}</p>
            )}
        </fieldset>
    );
}

/**
 * Follow setup: days and boarding station. A bottom sheet on phones, a
 * dialog on desktop. No alerts on the web.
 */
export function FollowEditor({
    target,
    onClose,
    isDesktop,
}: {
    target: FollowTarget | null;
    onClose: () => void;
    isDesktop: boolean;
}) {
    const t = useTranslations("Follow");
    const tTrain = useTranslations("Train");
    const follows = useFollows();
    const recent = useRecentStations();

    // The last target stays on screen while the editor animates out
    const [shown, setShown] = useState(target);
    if (target && target !== shown) setShown(target);
    const open = !!target;

    const setup = useMemo(() => {
        const current = shown;
        if (!current) return null;
        if (current.kind === "follow") {
            const { follow } = current;
            return {
                existing: follow,
                trainNumber: follow.trainNumber,
                routeShortName: follow.routeShortName,
                destination: follow.destination,
                options: [optionOf(follow)],
            };
        }
        const { vehicle } = current.view;
        const number = trainNumber(vehicle.trip.tripShortName);
        const options = trainOptions(current.view, new Date());
        const existing = findFollow(follows, number, options);
        if (
            existing &&
            !options.some((o) => o.stationId === existing.fromStationId)
        ) {
            options.unshift(optionOf(existing));
        }
        return {
            existing,
            trainNumber: number,
            routeShortName: vehicle.trip.route.shortName,
            destination: destinationOf(vehicle),
            options,
        };
    }, [shown, follows]);

    const [days, setDays] = useState<number[]>([]);
    const [boardingKey, setBoardingKey] = useState("");

    // Fresh choices whenever the editor opens on something
    // biome-ignore lint/correctness/useExhaustiveDependencies: only on open
    useEffect(() => {
        if (!target || !setup) return;
        const { existing, options } = setup;
        if (existing) {
            setDays(existing.weekdays);
            setBoardingKey(
                options.find((o) => o.stationId === existing.fromStationId)
                    ?.key ?? "",
            );
            return;
        }
        setDays(localWeekday() <= 5 ? WORKDAYS : WEEKEND);
        // A station the user looked at recently still ahead of the train,
        // else its next stop; never one it has already passed
        const view = target.kind === "train" ? target.view : null;
        const routeOptions = options.filter((o) => o.index >= 0);
        const index = defaultBoardingIndex(
            view?.vehicle.trip.stoptimes.map((st) => stationIdOf(st.stop)) ??
                [],
            view?.next?.index ?? null,
            recent.map((s) => s.id),
        );
        setBoardingKey(
            (routeOptions.find((o) => o.index >= index) ?? options[0])?.key ??
                "",
        );
    }, [target]);

    const boarding = setup?.options.find((o) => o.key === boardingKey);

    const save = () => {
        if (!setup || !boarding) return;
        saveFollow({
            id: setup.existing?.id,
            trainNumber: setup.trainNumber,
            routeShortName: setup.routeShortName,
            destination: setup.destination,
            fromStationId: boarding.stationId,
            fromName: boarding.name,
            fromLat: boarding.lat,
            fromLon: boarding.lon,
            departureS: boarding.departureS,
            runS: boarding.runS,
            weekdays: days,
            date: days.length === 0 ? boarding.date : null,
        });
        onClose();
    };

    const unfollow = () => {
        if (setup?.existing) removeFollow(setup.existing.id);
        onClose();
    };

    return (
        <DialogPrimitive.Root
            open={open}
            onOpenChange={(open) => !open && onClose()}
        >
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 duration-(--mhav-duration-sheet) ease-sheet data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
                <DialogPrimitive.Content
                    aria-describedby={undefined}
                    className={cn(
                        "fixed z-50 flex flex-col gap-5 bg-surface p-4 outline-none motion-reduce:animate-none",
                        "data-[state=closed]:animate-out data-[state=open]:animate-in",
                        isDesktop
                            ? "top-1/2 left-1/2 w-[400px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-sheet shadow-2xl duration-200 ease-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
                            : "inset-x-0 bottom-0 max-h-[calc(100dvh-56px)] overflow-y-auto rounded-t-sheet pb-[max(env(safe-area-inset-bottom),16px)] duration-(--mhav-duration-sheet) ease-sheet data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
                    )}
                >
                    {!isDesktop && (
                        <span
                            aria-hidden
                            className="mx-auto -mt-2 -mb-3 h-1.5 w-9 rounded-full bg-line"
                        />
                    )}
                    {setup && (
                        <>
                            <div className="flex items-center gap-2">
                                <DialogPrimitive.Title className="min-w-0 flex-1 text-headline">
                                    <TrainTitle
                                        routeShortName={setup.routeShortName}
                                        tripShortName={setup.trainNumber}
                                        destination={setup.destination}
                                    />
                                </DialogPrimitive.Title>
                                <DialogPrimitive.Close
                                    aria-label={tTrain("close")}
                                    className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-surface-2 text-ink hover:bg-line"
                                >
                                    <X className="size-5" aria-hidden />
                                </DialogPrimitive.Close>
                            </div>
                            <DayPicker days={days} onChange={setDays} />
                            <label className="flex flex-col gap-1.5">
                                <span className="text-caption font-semibold text-ink-2">
                                    {t("boarding")}
                                </span>
                                <span className="relative flex">
                                    <select
                                        value={boardingKey}
                                        onChange={(e) =>
                                            setBoardingKey(e.target.value)
                                        }
                                        disabled={setup.options.length < 2}
                                        className="tnum h-12 w-full cursor-pointer appearance-none rounded-md border border-line bg-surface pr-10 pl-4 text-body text-ink disabled:cursor-default"
                                    >
                                        {setup.options.map((o) => (
                                            <option key={o.key} value={o.key}>
                                                {`${o.name} · ${formatSecondsAsTime(o.departureS)}`}
                                            </option>
                                        ))}
                                    </select>
                                    {setup.options.length > 1 && (
                                        <ChevronDown
                                            className="pointer-events-none absolute top-1/2 right-3 size-5 -translate-y-1/2 text-ink-2"
                                            aria-hidden
                                        />
                                    )}
                                </span>
                            </label>
                            <div className="flex flex-col gap-1">
                                <button
                                    type="button"
                                    onClick={save}
                                    disabled={!boarding}
                                    className="flex h-12 cursor-pointer items-center justify-center rounded-full bg-action text-[15px] font-semibold text-on-action disabled:opacity-50"
                                >
                                    {t("save")}
                                </button>
                                {setup.existing && (
                                    <button
                                        type="button"
                                        onClick={unfollow}
                                        className="flex h-11 cursor-pointer items-center justify-center rounded-full text-[15px] font-semibold text-delay-severe hover:bg-surface-2"
                                    >
                                        {t("unfollow")}
                                    </button>
                                )}
                            </div>
                        </>
                    )}
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}

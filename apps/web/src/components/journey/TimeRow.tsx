"use client";

import { toLocalInput } from "@megisholavonat/core/time";
import { CalendarDays, Clock } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { cn } from "@/lib/utils";
import type { PlannerState } from "./PlannerButton";

type Mode = "now" | "depart" | "arrive";
const MODES: Mode[] = ["now", "depart", "arrive"];

/** The sheet's ease, as the station board's and stats' switches use it */
const EASE = [0.32, 0.72, 0, 1] as const;

export function modeOf(state: PlannerState): Mode {
    if (state.time === null) return "now";
    return state.arriveBy ? "arrive" : "depart";
}

/** The state after picking a mode: a set time starts from the current one. */
export function withMode(
    state: PlannerState,
    mode: Mode,
    now: Date = new Date(),
): PlannerState {
    if (mode === "now") return { ...state, time: null, arriveBy: false };
    return {
        ...state,
        arriveBy: mode === "arrive",
        time: state.time ?? toLocalInput(now),
    };
}

/**
 * When to travel: now, or leaving or arriving at a set time. A set time
 * shows its day and its time as two visible fields; "now" has no field.
 */
export function TimeRow({
    state,
    onChange,
    surface,
}: {
    state: PlannerState;
    onChange: (state: PlannerState) => void;
    surface: string;
}) {
    const t = useTranslations("Journey");
    const reduceMotion = useReducedMotion() ?? false;
    const mode = modeOf(state);
    const [date = "", clock = ""] = state.time?.split("T") ?? [];
    const duration = reduceMotion ? 0 : 0.24;

    return (
        <fieldset className="flex min-w-0 flex-col">
            <legend className="sr-only">{t("time")}</legend>
            <ModeSwitch
                value={mode}
                labels={{
                    now: t("now"),
                    depart: t("depart"),
                    arrive: t("arrive"),
                }}
                onChange={(next) => onChange(withMode(state, next))}
                surface={surface}
                duration={duration}
            />
            <AnimatePresence initial={false}>
                {state.time !== null && (
                    <motion.div
                        key="when"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration, ease: EASE }}
                        // Room for the focus ring, which the clip would cut
                        className="-mx-1 -mb-1 overflow-hidden px-1 pb-1"
                    >
                        <div className="flex gap-2 pt-2">
                            <PickerField
                                type="date"
                                label={t("date")}
                                icon={CalendarDays}
                                value={date}
                                min={toLocalInput(new Date()).slice(0, 10)}
                                onChange={(value) =>
                                    onChange({
                                        ...state,
                                        time: `${value}T${clock}`,
                                    })
                                }
                                surface={surface}
                                className="flex-[3]"
                            />
                            <PickerField
                                type="time"
                                label={t("time_of_day")}
                                icon={Clock}
                                value={clock}
                                onChange={(value) =>
                                    onChange({
                                        ...state,
                                        time: `${date}T${value}`,
                                    })
                                }
                                surface={surface}
                                className="flex-[2]"
                            />
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </fieldset>
    );
}

/**
 * One choice of three, as native radio buttons: arrow keys move between
 * them and the selection reads as such. Each label is the whole segment.
 */
function ModeSwitch({
    value,
    labels,
    onChange,
    surface,
    duration,
}: {
    value: Mode;
    labels: Record<Mode, string>;
    onChange: (mode: Mode) => void;
    surface: string;
    duration: number;
}) {
    const id = useId();
    return (
        <div className={cn("grid grid-cols-3 rounded-md p-0.5", surface)}>
            {MODES.map((mode) => {
                const checked = value === mode;
                return (
                    <label
                        key={mode}
                        className={cn(
                            "focus-field relative flex h-9 cursor-pointer items-center justify-center rounded-[8px] px-3 text-sm transition-colors",
                            checked
                                ? "font-semibold text-ink"
                                : "text-ink-2 hover:text-ink",
                        )}
                    >
                        <input
                            type="radio"
                            name={id}
                            value={mode}
                            checked={checked}
                            onChange={() => onChange(mode)}
                            className="sr-only"
                        />
                        {checked && (
                            <motion.span
                                layoutId={`${id}-pill`}
                                aria-hidden
                                className="absolute inset-0 rounded-[8px] bg-canvas shadow-sm dark:bg-line"
                                transition={{ duration, ease: EASE }}
                            />
                        )}
                        <span className="relative truncate">
                            {labels[mode]}
                        </span>
                    </label>
                );
            })}
        </div>
    );
}

/**
 * A native date or time input that fills its whole field, so every part
 * of the field is the input itself and a click opens its picker.
 */
function PickerField({
    type,
    label,
    icon: Icon,
    value,
    min,
    onChange,
    surface,
    className,
}: {
    type: "date" | "time";
    label: string;
    icon: typeof Clock;
    value: string;
    min?: string;
    onChange: (value: string) => void;
    surface: string;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "focus-field relative flex h-11 min-w-0 items-center rounded-md",
                surface,
                className,
            )}
        >
            <Icon
                aria-hidden
                className="pointer-events-none absolute left-3 size-4 text-ink-2"
            />
            <input
                type={type}
                aria-label={label}
                value={value}
                min={min}
                required
                onChange={(e) => {
                    // A half-typed value reads as empty: keep the last one
                    if (e.target.value) onChange(e.target.value);
                }}
                onClick={(e) => {
                    try {
                        e.currentTarget.showPicker();
                    } catch {
                        // Not supported, or already open: typing still works
                    }
                }}
                className="tnum h-full w-full min-w-0 cursor-pointer appearance-none rounded-md bg-transparent pr-3 pl-9 text-sm font-semibold text-ink outline-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-date-and-time-value]:text-left"
            />
        </div>
    );
}

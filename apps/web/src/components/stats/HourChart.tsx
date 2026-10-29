"use client";

import type { HourPunctuality } from "@megisholavonat/api-client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { overallShare } from "./figures";
import { Of10Text, of10 } from "./StatsParts";

export { overallShare };

/** Hours with fewer passages than this are left empty */
const MIN_HOUR_SAMPLES = 20;
const TICKS = [10, 5, 0];

function hourLabel(hour: number): string {
    return `${hour}:00–${(hour + 1) % 24}:00`;
}

/**
 * On-time share by scheduled hour: one blue column per hour on a 0-10 scale
 * ("out of ten"). Each column is a button: hover, focus or tap shows its
 * tooltip, and its label reads the value.
 */
export function HourChart({ hours }: { hours: HourPunctuality[] }) {
    const t = useTranslations("Stats");
    const [active, setActive] = useState<number | null>(null);
    const usable = (h: HourPunctuality) =>
        h.onTimeShare != null && h.n >= MIN_HOUR_SAMPLES;
    const current = active == null ? null : hours[active];

    return (
        <figure className="flex flex-col gap-2" aria-label={t("by_hour")}>
            {/* What the y axis counts: runs on time out of ten */}
            <p className="text-caption font-normal text-ink-2" aria-hidden>
                {t("hour_axis")}
            </p>
            <div className="flex gap-2">
                {/* y axis: runs out of ten */}
                <div
                    className="tnum flex h-36 flex-col justify-between text-right text-caption font-normal text-ink-2"
                    aria-hidden
                >
                    {TICKS.map((tick) => (
                        <span key={tick} className="-my-2 leading-4">
                            {tick}
                        </span>
                    ))}
                </div>
                <div className="relative min-w-0 flex-1">
                    {/* hairline grid */}
                    <div
                        className="pointer-events-none absolute inset-x-0 top-0 flex h-36 flex-col justify-between"
                        aria-hidden
                    >
                        {TICKS.map((tick) => (
                            <span key={tick} className="h-px bg-line" />
                        ))}
                    </div>
                    <div className="relative flex h-36 items-end gap-0.5">
                        {hours.map((h, i) => (
                            <button
                                key={h.hour}
                                type="button"
                                aria-label={`${hourLabel(h.hour)}: ${
                                    usable(h)
                                        ? t.markup("of10", {
                                              count: of10(h.onTimeShare ?? 0),
                                              b: (chunks) => chunks,
                                          })
                                        : t("few_data")
                                }`}
                                className="flex h-full min-w-0 flex-1 cursor-default items-end justify-center rounded-t-[4px] p-0 [--focus-offset:0px]"
                                onPointerEnter={() => setActive(i)}
                                onPointerLeave={() => setActive(null)}
                                onFocus={() => setActive(i)}
                                onBlur={() => setActive(null)}
                                onClick={() => setActive(i)}
                            >
                                {usable(h) && (
                                    <span
                                        className={cn(
                                            "w-full max-w-4 rounded-t-[4px] bg-delay-on-time-fill transition-opacity",
                                            active != null &&
                                                active !== i &&
                                                "opacity-50",
                                        )}
                                        style={{
                                            height: `${(h.onTimeShare ?? 0) * 100}%`,
                                        }}
                                    />
                                )}
                            </button>
                        ))}
                    </div>
                    {current && (
                        <div
                            className="floating-card pointer-events-none absolute border border-line -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap"
                            style={{
                                left: `clamp(70px, ${((active ?? 0) + 0.5) * (100 / hours.length)}%, calc(100% - 70px))`,
                            }}
                        >
                            <p className="tnum text-caption text-ink-2">
                                {hourLabel(current.hour)}
                            </p>
                            {usable(current) ? (
                                <Of10Text share={current.onTimeShare ?? 0} />
                            ) : (
                                <span className="text-ink-2">
                                    {t("few_data")}
                                </span>
                            )}
                        </div>
                    )}
                    {/* x axis */}
                    <div
                        className="tnum mt-1 flex text-caption font-normal text-ink-2"
                        aria-hidden
                    >
                        {hours.map((h) => (
                            <span
                                key={h.hour}
                                className="min-w-0 flex-1 overflow-visible text-center"
                            >
                                {h.hour % 6 === 0 ? h.hour : ""}
                            </span>
                        ))}
                    </div>
                </div>
            </div>
        </figure>
    );
}

"use client";

import type { Disruption } from "@megisholavonat/api-client";
import { getDisruptionsOptions } from "@megisholavonat/api-client/react-query";
import {
    affectsStation,
    affectsTrain,
    disruptionLines,
    type Interest,
    isDisruptionActive,
    sortDisruptions,
} from "@megisholavonat/core/disruptions";
import { formatValidity, formatValidityDate } from "@megisholavonat/core/time";
import { EASING } from "@megisholavonat/core/tokens";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ChevronDown, TriangleAlert } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import { SheetClose } from "@/components/sheet/BottomSheet";
import { BackButton } from "@/components/train/TrainParts";
import type { TrainView } from "@/components/train/useTrainView";
import { RouteGlyph } from "@/components/ui/RouteGlyph";
import type { Follow } from "@/hooks/useFollows";
import { useNow } from "@/hooks/useNow";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";

/** The feed changes slowly; the API caches it for two minutes */
const REFRESH_MS = 2 * 60_000;
const EASE = [...EASING.sheet.bezier] as [number, number, number, number];

/** Severity colour of the warning sign. Red only where trains do not run. */
const SEVERITY_TEXT: Record<Disruption["severity"], string> = {
    high: "text-delay-severe",
    medium: "text-delay-moderate",
    low: "text-ink-2",
};

/** Active disruptions, worst and newest first (the API's order). */
export function useDisruptions(): Disruption[] {
    const now = useNow();
    const query = useQuery({
        ...getDisruptionsOptions(),
        refetchInterval: REFRESH_MS,
        staleTime: REFRESH_MS,
    });
    return useMemo(
        () =>
            (query.data ?? []).filter((d) => isDisruptionActive(d, now / 1000)),
        [query.data, now],
    );
}

/** The followed trains and their boarding stations, for ranking. */
export function interestsOf(follows: readonly Follow[]): Interest[] {
    return follows.map((f) => ({
        trainNumber: f.trainNumber,
        stationIds: [f.fromStationId],
    }));
}

/** "Pótlóbusz Mándok és Tornyospálca között", in the UI language. */
function useTitle() {
    const t = useTranslations("Disruptions");
    const locale = useLocale();
    return (d: Disruption) => {
        const effect = t(`effect_${d.effect}`);
        if (d.segment) {
            return t("between", {
                effect,
                from: d.segment.fromName,
                to: d.segment.toName,
            });
        }
        // MÁV's own first sentence reads better than a bare category
        return locale === "hu" ? d.title : effect;
    };
}

/** "okt. 17. – nov. 6.", with times when it is within a day. */
function useValidity() {
    const t = useTranslations("Disruptions");
    const locale = useLocale();
    return (d: Disruption) => {
        if (d.start != null && d.end != null) {
            return formatValidity(d.start, d.end, locale);
        }
        if (d.start != null) {
            return t("since", { date: formatValidityDate(d.start, locale) });
        }
        return d.end != null
            ? t("until", { date: formatValidityDate(d.end, locale) })
            : null;
    };
}

/** Glyphs of the affected lines, the named ones with their name. */
function LineGlyphs({ disruption }: { disruption: Disruption }) {
    const { lines, more } = disruptionLines(disruption);
    if (lines.length === 0) return null;
    return (
        <span className="flex shrink-0 items-center gap-1.5 text-ink">
            {/* The MÁV glyph already spells a named line ("H8") */}
            {lines.map((line) => (
                <RouteGlyph
                    key={line.shortName}
                    routeShortName={line.shortName}
                    className="text-[17px]"
                />
            ))}
            {more > 0 && (
                <span className="text-caption font-semibold text-ink-2">
                    +{more}
                </span>
            )}
        </span>
    );
}

/** A web address in MÁV's text ("Részletek: mavinform.hu") */
const WEB_ADDRESS =
    /\b((?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:hu|eu|com|org|at)(?:\/[^\s),;]*[^\s),;.])?)/gi;

/** MÁV's text with its web addresses as links. */
export function Linked({ text }: { text: string }) {
    const parts = text.split(WEB_ADDRESS);
    return parts.map((part, i) =>
        i % 2 === 1 ? (
            <a
                // biome-ignore lint/suspicious/noArrayIndexKey: parts of one fixed text
                key={i}
                href={/^https?:/i.test(part) ? part : `https://${part}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-ink underline underline-offset-2"
            >
                {part}
            </a>
        ) : (
            part
        ),
    );
}

/** MÁV's text, the other notices of the event and the source link. */
function FullText({ disruption }: { disruption: Disruption }) {
    const t = useTranslations("Disruptions");
    const mavinform = disruption.url.includes("mavinform");
    return (
        <div className="flex flex-col gap-2 text-sm">
            {[disruption.description, ...disruption.details].map((text) => (
                <p key={text} className="whitespace-pre-line text-ink-2">
                    <Linked text={text.replace(/\n{2,}/g, "\n").trim()} />
                </p>
            ))}
            <a
                href={disruption.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-8 w-fit items-center gap-0.5 font-semibold text-ink underline-offset-2 hover:underline"
            >
                {mavinform ? t("source_mavinform") : t("source")}
                <ArrowUpRight className="size-3.5" aria-hidden />
            </a>
        </div>
    );
}

/**
 * One disruption: lines, title, validity and cause; tap for MÁV's full
 * text. `mine`: it touches a followed train or its station.
 */
export function DisruptionItem({
    disruption,
    mine = false,
    defaultOpen = false,
    framed = false,
}: {
    disruption: Disruption;
    mine?: boolean;
    defaultOpen?: boolean;
    /** A tinted card of its own (train and station sheets) */
    framed?: boolean;
}) {
    const t = useTranslations("Disruptions");
    const title = useTitle();
    const validity = useValidity()(disruption);
    const reduced = useReducedMotion() ?? false;
    const [open, setOpen] = useState(defaultOpen);
    const bodyId = useId();
    const meta = [
        disruption.cause !== "other" ? t(`cause_${disruption.cause}`) : null,
        validity,
    ].filter(Boolean);
    return (
        <article
            className={cn(
                "flex flex-col",
                framed
                    ? "rounded-md bg-delay-moderate-tint"
                    : "border-b border-line last:border-b-0",
            )}
        >
            <button
                type="button"
                onClick={() => {
                    if (!open) {
                        track("disruption_expanded", {
                            context: framed ? "detail" : "list",
                            affects_follow: mine,
                        });
                    }
                    setOpen(!open);
                }}
                aria-expanded={open}
                aria-controls={bodyId}
                className={cn(
                    "flex w-full cursor-pointer items-start gap-2.5 text-left",
                    framed ? "px-3 py-2.5" : "py-3",
                )}
            >
                <TriangleAlert
                    className={cn(
                        "mt-0.5 size-4.5 shrink-0",
                        SEVERITY_TEXT[disruption.severity],
                    )}
                    aria-hidden
                />
                {/* The title always sits beside the icon; the lines, the
                    "yours" badge and the validity follow on one row under
                    it, so every item has the same left edge */}
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-[15px] leading-5 font-semibold text-ink">
                        {title(disruption)}
                    </span>
                    {(disruption.lines.length > 0 ||
                        mine ||
                        meta.length > 0) && (
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <LineGlyphs disruption={disruption} />
                            {mine && (
                                <span className="rounded-full bg-action px-2 py-0.5 text-[11px] leading-[14px] font-semibold text-on-action">
                                    {t("mine")}
                                </span>
                            )}
                            {meta.length > 0 && (
                                <span className="tnum text-caption text-ink-2">
                                    {meta.join(" · ")}
                                </span>
                            )}
                        </span>
                    )}
                </span>
                <ChevronDown
                    className={cn(
                        "mt-0.5 size-4 shrink-0 text-ink-2 transition-transform duration-200 motion-reduce:transition-none",
                        open && "rotate-180",
                    )}
                    aria-hidden
                />
            </button>
            <AnimatePresence initial={false}>
                {open && (
                    <motion.div
                        id={bodyId}
                        key="text"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={
                            reduced
                                ? { duration: 0 }
                                : { duration: 0.24, ease: EASE }
                        }
                        className="overflow-hidden"
                    >
                        <div
                            className={cn(
                                "pb-3",
                                framed ? "pr-3 pl-10" : "pr-6 pl-7",
                            )}
                        >
                            <FullText disruption={disruption} />
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </article>
    );
}

/** The list, the user's own lines first. */
export function DisruptionList({
    disruptions,
    follows,
}: {
    disruptions: Disruption[];
    follows: readonly Follow[];
}) {
    const t = useTranslations("Disruptions");
    const sorted = useMemo(
        () => sortDisruptions(disruptions, interestsOf(follows)),
        [disruptions, follows],
    );
    if (sorted.length === 0) {
        return <p className="py-8 text-center text-ink-2">{t("empty")}</p>;
    }
    return (
        <div className="flex flex-col">
            {sorted.map(({ disruption, mine }) => (
                <DisruptionItem
                    key={disruption.id}
                    disruption={disruption}
                    mine={mine}
                />
            ))}
        </div>
    );
}

/**
 * "2 forgalmi zavar" on home, only while there are any. Tinted like the
 * delay reasons; a dot marks one on the user's own trains.
 */
export function DisruptionChip({
    disruptions,
    follows,
    onClick,
    className,
}: {
    disruptions: Disruption[];
    follows: readonly Follow[];
    onClick: () => void;
    className?: string;
}) {
    const t = useTranslations("Disruptions");
    const reduced = useReducedMotion() ?? false;
    const mine = useMemo(
        () =>
            sortDisruptions(disruptions, interestsOf(follows)).filter(
                (d) => d.mine,
            ).length,
        [disruptions, follows],
    );
    return (
        <AnimatePresence initial={false}>
            {disruptions.length > 0 && (
                <motion.div
                    key="chip"
                    initial={{ opacity: 0, y: reduced ? 0 : 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: reduced ? 0 : 0.2, ease: EASE }}
                    className={cn("flex", className)}
                >
                    <button
                        type="button"
                        onClick={onClick}
                        aria-haspopup="dialog"
                        className="pressable relative flex h-8 cursor-pointer before:absolute before:-inset-y-1.5 before:inset-x-0 items-center gap-1.5 rounded-full bg-delay-moderate-tint pr-3 pl-2.5 text-sm font-semibold text-ink"
                    >
                        <TriangleAlert
                            className="size-4 text-delay-moderate"
                            aria-hidden
                        />
                        <span className="tnum">
                            {t("chip", { count: disruptions.length })}
                        </span>
                        {mine > 0 && (
                            <span className="tnum font-normal text-ink-2">
                                · {t("chip_mine", { count: mine })}
                            </span>
                        )}
                    </button>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

/** Phones: the list's title in the bottom sheet. */
export function DisruptionsSheetHeader({
    count,
    onClose,
}: {
    count: number;
    onClose: () => void;
}) {
    const t = useTranslations("Disruptions");
    return (
        <>
            <SheetClose onClick={onClose} />
            <div className="flex items-baseline gap-2 px-4 pr-14 pb-1">
                <h2 className="truncate text-title">{t("title")}</h2>
                <span className="tnum text-ink-2">{count}</span>
            </div>
        </>
    );
}

export function DisruptionsSheetBody({
    disruptions,
    follows,
}: {
    disruptions: Disruption[];
    follows: readonly Follow[];
}) {
    return (
        <div className="px-4 pb-6">
            <DisruptionList disruptions={disruptions} follows={follows} />
        </div>
    );
}

/** Desktop: a docked panel in place of the home card. */
export function DisruptionsPanel({
    disruptions,
    follows,
    onClose,
}: {
    disruptions: Disruption[];
    follows: readonly Follow[];
    onClose: () => void;
}) {
    const t = useTranslations("Disruptions");
    return (
        <section
            aria-label={t("title")}
            className="floating-card flex max-h-full w-[400px] max-w-full flex-col overflow-hidden rounded-sheet"
        >
            <div className="flex items-center gap-3 border-b border-line p-4">
                <BackButton onClick={onClose} />
                <h2 className="min-w-0 flex-1 truncate text-title">
                    {t("title")}
                </h2>
                <span className="tnum text-ink-2">{disruptions.length}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4">
                <DisruptionList disruptions={disruptions} follows={follows} />
            </div>
        </section>
    );
}

/**
 * In a train's sheet: the disruptions on its way, by trip, train number or
 * both ends of the stretch.
 */
export function TrainDisruptions({ view }: { view: TrainView }) {
    const disruptions = useDisruptions();
    const { trip } = view.vehicle;
    const affecting = useMemo(() => {
        const stationIds = view.stops.map((s) => s.stationId);
        return disruptions.filter((d) =>
            affectsTrain(d, {
                tripId: trip.gtfsId,
                tripShortName: trip.tripShortName,
                stationIds,
            }),
        );
    }, [disruptions, trip.gtfsId, trip.tripShortName, view.stops]);
    return <Affecting disruptions={affecting} />;
}

/** In a station's board: the disruptions naming the station. */
export function StationDisruptions({ stationId }: { stationId: string }) {
    const disruptions = useDisruptions();
    const affecting = useMemo(
        () => disruptions.filter((d) => affectsStation(d, stationId)),
        [disruptions, stationId],
    );
    return <Affecting disruptions={affecting} />;
}

function Affecting({ disruptions }: { disruptions: Disruption[] }) {
    const t = useTranslations("Disruptions");
    if (disruptions.length === 0) return null;
    return (
        <section aria-label={t("title")} className="flex flex-col gap-2">
            {disruptions.map((d) => (
                <DisruptionItem key={d.id} disruption={d} framed />
            ))}
        </section>
    );
}

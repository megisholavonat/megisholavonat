// The delay summary card (1200x630): one run's delay at the rider's stop,
// scheduled vs actual, labelled as our GPS measurement. Drawn with next/og
// like the other previews (see images.tsx).

import { delayReasonLabel } from "@megisholavonat/core/delayReasons";
import {
    clockTime,
    type DelaySummary,
    MEASUREMENT_NOTE,
} from "@megisholavonat/core/delaySummary";
import type { Locale } from "@megisholavonat/core/i18n";
import { COLORS, DELAY_SCALE } from "@megisholavonat/core/tokens";
import { ellipsis, Frame, Glyph, render, tint } from "@/lib/og/images";
import { glyphText } from "@/lib/og/model";

const C = COLORS.light;
const SCALE = DELAY_SCALE.light;

export const CARD_TEXT = {
    hu: {
        minutesLate: "perc késés",
        cancelled: "elmaradt",
        unknown: "nincs mérés",
        soFar: "eddig",
        departure: "Indulás",
        arrival: "Érkezés",
        lastMeasured: "Utolsó mérés",
        reason: (label: string) => `Késés oka: ${label}`,
    },
    en: {
        minutesLate: "min late",
        cancelled: "cancelled",
        unknown: "not measured",
        soFar: "so far",
        departure: "Departs",
        arrival: "Arrives",
        lastMeasured: "Last measured",
        reason: (label: string) => `Delay cause: ${label}`,
    },
} as const;

/** "2026. október 27., kedd"; "Tuesday 27 October 2026". */
export function runDateLabel(locale: Locale, date: string): string {
    return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-GB", {
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "long",
        timeZone: "UTC",
    }).format(new Date(`${date}T12:00:00Z`));
}

/** The big number and its caption, with their colours. */
export function cardDelay(card: DelaySummary, locale: Locale) {
    const t = CARD_TEXT[locale];
    switch (card.outcome) {
        case "late":
        case "onTime":
            return {
                // Minutes as a number, as the sheet
                big: card.delay ? `+${card.delay}` : "0",
                caption: `${t.minutesLate}${card.soFar ? ` · ${t.soFar}` : ""}`,
                color: SCALE[card.level].text,
                background: tint(card.level),
            };
        case "cancelled":
            return {
                big: "×",
                caption: t.cancelled,
                color: SCALE.severe.text,
                background: tint("severe"),
            };
        default:
            return {
                big: "?",
                caption: t.unknown,
                color: C.ink2,
                background: C.surface2,
            };
    }
}

function TimeRow({
    label,
    name,
    scheduled,
    actual,
    color,
    connector,
}: {
    label: string;
    name: string;
    scheduled: number | null;
    actual: number | null;
    color: string;
    /** Height of the line down to the next row; 0 for the last */
    connector: number;
}) {
    const late = actual != null && scheduled != null && actual !== scheduled;
    return (
        <div style={{ display: "flex", alignItems: "flex-start" }}>
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    width: 28,
                    marginRight: 20,
                    marginTop: 8,
                }}
            >
                <div
                    style={{
                        width: 22,
                        height: 22,
                        borderRadius: 11,
                        border: `5px solid ${C.ink}`,
                        background: C.surface,
                    }}
                />
                {connector > 0 && (
                    <div
                        style={{
                            width: 5,
                            height: connector,
                            background: C.ink,
                        }}
                    />
                )}
            </div>
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    flex: 1,
                    minWidth: 0,
                }}
            >
                <div style={{ fontSize: 24, fontWeight: 600, color: C.ink2 }}>
                    {label}
                </div>
                <div style={{ display: "flex", alignItems: "baseline" }}>
                    <div
                        style={{
                            fontSize: 36,
                            fontWeight: 700,
                            maxWidth: 360,
                            ...ellipsis,
                        }}
                    >
                        {name}
                    </div>
                    {scheduled != null && (
                        <div
                            style={{
                                marginLeft: 18,
                                fontSize: 36,
                                fontWeight: 600,
                                // Grey when not measured: only the schedule
                                color: late || actual == null ? C.ink2 : C.ink,
                                textDecoration: late ? "line-through" : "none",
                            }}
                        >
                            {clockTime(scheduled)}
                        </div>
                    )}
                    {late && actual != null && (
                        <div
                            style={{
                                marginLeft: 14,
                                fontSize: 36,
                                fontWeight: 800,
                                color,
                            }}
                        >
                            {clockTime(actual)}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export function delayCardImage(card: DelaySummary, locale: Locale) {
    const t = CARD_TEXT[locale];
    const delay = cardDelay(card, locale);
    const shown = card.outcome === "late" || card.outcome === "onTime";
    const notes = [
        card.reason && card.outcome !== "onTime"
            ? t.reason(delayReasonLabel(card.reason, locale))
            : null,
    ].filter((n): n is string => !!n);
    // Without a measured arrival (not recorded, or the run is on its way)
    // the last measured stop ends the timeline: a bare scheduled arrival
    // next to the delay would read as an on-time one
    const rows = [
        { label: t.departure, stop: card.from },
        shown && card.measuredAt
            ? { label: t.lastMeasured, stop: card.measuredAt }
            : { label: t.arrival, stop: card.to },
    ];
    return render((icon) => (
        <Frame icon={icon} locale={locale}>
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    flex: 1,
                    minWidth: 0,
                }}
            >
                <div style={{ display: "flex", alignItems: "center" }}>
                    <Glyph
                        glyph={glyphText(card.routeShortName)}
                        color={C.ink}
                        size={40}
                    />
                    <div style={{ fontSize: 34, fontWeight: 800 }}>
                        {card.number}
                    </div>
                    {card.name && (
                        <div
                            style={{
                                marginLeft: 14,
                                // The destination keeps its room first
                                flexShrink: 4,
                                minWidth: 0,
                                fontSize: 28,
                                fontWeight: 600,
                                color: C.ink2,
                                ...ellipsis,
                            }}
                        >
                            {card.name}
                        </div>
                    )}
                    {/* Where the rider was going, also when its arrival
                        was not measured and the timeline ends before it */}
                    <div
                        style={{
                            marginLeft: 14,
                            marginRight: 24,
                            flexShrink: 1,
                            minWidth: 0,
                            fontSize: 30,
                            fontWeight: 700,
                            ...ellipsis,
                        }}
                    >
                        {`→ ${card.to.name}`}
                    </div>
                    <div
                        style={{
                            flexShrink: 0,
                            marginLeft: "auto",
                            fontSize: 28,
                            fontWeight: 600,
                            color: C.ink2,
                        }}
                    >
                        {runDateLabel(locale, card.date)}
                    </div>
                </div>
                <div
                    style={{
                        display: "flex",
                        alignItems: "stretch",
                        marginTop: 28,
                        flex: 1,
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "center",
                            width: 300,
                            padding: "22px 34px",
                            borderRadius: 28,
                            background: delay.background,
                            border:
                                card.outcome === "unknown"
                                    ? `3px dashed ${C.ink2}`
                                    : `3px solid ${delay.background}`,
                        }}
                    >
                        <div
                            style={{
                                fontSize: 128,
                                fontWeight: 800,
                                lineHeight: 1,
                                letterSpacing: -4,
                                color: delay.color,
                            }}
                        >
                            {delay.big}
                        </div>
                        <div
                            style={{
                                marginTop: 10,
                                fontSize: 30,
                                fontWeight: 700,
                                color: delay.color,
                            }}
                        >
                            {delay.caption}
                        </div>
                    </div>
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "center",
                            marginLeft: 44,
                            flex: 1,
                            minWidth: 0,
                        }}
                    >
                        {rows.map((row, i) => (
                            <TimeRow
                                key={row.label}
                                label={row.label}
                                name={row.stop.name}
                                scheduled={row.stop.scheduled}
                                actual={shown ? row.stop.actual : null}
                                color={delay.color}
                                connector={
                                    i === rows.length - 1
                                        ? 0
                                        : rows.length > 2
                                          ? 44
                                          : 70
                                }
                            />
                        ))}
                    </div>
                </div>
                {notes.length > 0 && (
                    <div
                        style={{
                            marginTop: 14,
                            fontSize: 24,
                            fontWeight: 600,
                            color: C.ink2,
                            ...ellipsis,
                        }}
                    >
                        {notes.join(" · ")}
                    </div>
                )}
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        alignSelf: "flex-start",
                        marginTop: 14,
                        padding: "6px 16px",
                        borderRadius: 10,
                        border: `2px solid ${C.line}`,
                        fontSize: 22,
                        fontWeight: 600,
                        color: C.ink2,
                    }}
                >
                    {MEASUREMENT_NOTE[locale]}
                </div>
            </div>
        </Frame>
    ));
}

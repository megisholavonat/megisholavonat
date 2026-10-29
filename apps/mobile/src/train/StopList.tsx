import type {
    InfoService,
    VehiclePositionWithDelay,
} from "@megisholavonat/api-client";
import type { DelayLevel } from "@megisholavonat/core/delay";
import { formatSecondsAsTime } from "@megisholavonat/core/time";
import { useEffect, useRef, useState } from "react";
import {
    Animated,
    Easing,
    type LayoutChangeEvent,
    StyleSheet,
    Text,
    View,
    type ViewStyle,
} from "react-native";
import { useTranslations } from "use-intl";
import { type AppTheme, useAppTheme } from "../theme/ThemeProvider";
import { delayTextColor, PlatformBadge } from "../ui/ds";
import { Icon } from "../ui/Icon";
import { useReduceMotion } from "../ui/motion";
import {
    type PlaceLabel,
    placeLabel,
    type RailPosition,
    railPosition,
    speedKmh,
} from "./position";
import { MNR2007_FONT } from "./RouteIcon";
import { type StopRow, serviceGlyph } from "./trainData";

/** Horizontal centre of the rail, in the 18 pt dot column */
const RAIL_X = 9;
const MARKER = 20;
/** How often a moving train's position glides on between refreshes */
const TICK_MS = 1000;
/** A new position from the API slides over this long */
const UPDATE_MS = 600;

function Dot({ row, theme }: { row: StopRow; theme: AppTheme }) {
    let style: ViewStyle;
    if (row.state === "passed") {
        style = { width: 9, height: 9, backgroundColor: theme.colors.ink2 };
    } else if (row.isLast) {
        style = { width: 11, height: 11, backgroundColor: theme.colors.ink };
    } else {
        style = {
            width: 11,
            height: 11,
            borderWidth: 2,
            // Filled so the rail doesn't show through
            backgroundColor: theme.colors.surface,
            borderColor:
                row.state === "next" ? theme.colors.ink : theme.stale.fill,
        };
    }
    return <View style={[styles.dot, style]} />;
}

/**
 * The train's position on the rail, gliding on at its last speed between
 * refreshes (once a second) so it moves smoothly. Doesn't glide with
 * reduced motion or when the train isn't running.
 */
function useRailPosition(
    details: VehiclePositionWithDelay,
    glide: boolean,
): RailPosition | null {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        if (!glide) return;
        const timer = setInterval(() => setNow(new Date()), TICK_MS);
        return () => clearInterval(timer);
    }, [glide]);
    return railPosition(details, now, glide);
}

export function placeText(
    t: ReturnType<typeof useTranslations<"Train">>,
    label: PlaceLabel,
    rows: readonly StopRow[],
): string | null {
    const stop = rows[label.stop]?.name;
    if (!stop) return null;
    if (label.kind === "at") return t("position_at", { stop });
    if (label.kind === "after") return t("position_after", { stop });
    return t("position_before", { stop });
}

/**
 * The stop list of the train sheet: a rail through the stops, passed in
 * ink, with the train placed proportionally between its last and next stop
 * (Google Maps transit style), labelled with where it is and its speed.
 */
export function StopList({
    details,
    rows,
    services,
    nextPlatformPrediction,
    stale,
    running,
    level,
}: {
    details: VehiclePositionWithDelay;
    rows: StopRow[];
    /** Services valid on part of the trip, by stop index */
    services: InfoService[][];
    /** Predicted platform of the next stop ("4?"), when not announced */
    nextPlatformPrediction: string | null;
    /** Old data: times grey and uncertain */
    stale: boolean;
    /** Under way with a live position (not waiting, arrived or stale) */
    running: boolean;
    /** Colour of the train on the rail */
    level: DelayLevel | "stale";
}) {
    const theme = useAppTheme();
    const t = useTranslations("Train");
    const reduceMotion = useReduceMotion();
    const glide = running && !reduceMotion;
    const position = useRailPosition(details, glide);
    const fraction = useSegmentFraction(position, !reduceMotion, glide);
    const [centers, setCenters] = useState<(number | undefined)[]>([]);

    const onRowLayout = (index: number) => (event: LayoutChangeEvent) => {
        const { y, height } = event.nativeEvent.layout;
        const center = y + height / 2;
        setCenters((previous) => {
            if (previous[index] === center) return previous;
            const next = [...previous];
            next[index] = center;
            return next;
        });
    };

    const speed = details.speed ?? null;
    const label = position ? placeLabel(position, speed) : null;
    const place = label ? placeText(t, label, rows) : null;
    const nowLabel = [
        place,
        running && speed != null && speed > 0
            ? t("speed", { speed: speedKmh(speed) })
            : null,
    ]
        .filter(Boolean)
        .join(" · ");
    const between = position !== null && position.from < position.to;
    let lastPassed = -1;
    rows.forEach((r, i) => {
        if (r.state === "passed") lastPassed = i;
    });

    return (
        <View>
            <Rail
                centers={centers}
                count={rows.length}
                position={position}
                fraction={fraction}
                level={level}
                fallbackPassed={lastPassed}
            />
            {rows.map((row, index) => {
                const passed = row.state === "passed";
                const next = row.state === "next";
                const time = formatSecondsAsTime(row.expected);
                const timeText = row.approximate ? `≈${time}` : time;
                const weight = next
                    ? "700"
                    : row.isLast || row.isFirst
                      ? "600"
                      : "400";
                const predicted =
                    next && !row.platform ? nextPlatformPrediction : null;
                const secondary = row.secondary
                    ? t(
                          row.secondary.kind === "arrival"
                              ? "arrival_short"
                              : "departure_short",
                          {
                              time: formatSecondsAsTime(row.secondary.expected),
                          },
                      )
                    : null;
                const stopServices = services[index] ?? [];
                const showNow =
                    between && position?.to === index && nowLabel !== "";
                return [
                    showNow ? (
                        <View
                            key={`${row.key}-now`}
                            style={styles.now}
                            accessible
                            accessibilityLabel={t("position_a11y", {
                                place: nowLabel,
                            })}
                        >
                            <Text
                                style={[
                                    styles.nowText,
                                    theme.tabularNums,
                                    { color: theme.colors.ink },
                                ]}
                                numberOfLines={1}
                            >
                                {nowLabel}
                            </Text>
                        </View>
                    ) : null,
                    <View
                        key={row.key}
                        onLayout={onRowLayout(index)}
                        style={styles.row}
                        accessible
                        accessibilityLabel={[
                            row.name,
                            passed ? t("passed") : null,
                            row.approximate ? t("expected", { time }) : time,
                            secondary,
                            row.platform ?? predicted,
                            ...stopServices.map((s) => s.name),
                        ]
                            .filter(Boolean)
                            .join(", ")}
                    >
                        <View style={styles.dotCell}>
                            <Dot row={row} theme={theme} />
                        </View>
                        <View style={styles.nameCell}>
                            <Text
                                style={[
                                    theme.type.body,
                                    styles.name,
                                    {
                                        color: passed
                                            ? theme.colors.ink2
                                            : theme.colors.ink,
                                        fontWeight: weight,
                                    },
                                ]}
                                numberOfLines={1}
                            >
                                {row.name}
                            </Text>
                            {stopServices.length > 0 ? (
                                <Text
                                    style={[
                                        styles.services,
                                        { color: theme.colors.ink2 },
                                    ]}
                                    allowFontScaling={false}
                                >
                                    {stopServices.map(serviceGlyph).join(" ")}
                                </Text>
                            ) : null}
                        </View>
                        <View style={styles.timeCell}>
                            <Text
                                style={[
                                    styles.time,
                                    theme.tabularNums,
                                    {
                                        color: delayTextColor(
                                            theme,
                                            row.delay,
                                            stale && !passed,
                                        ),
                                        fontWeight: passed ? "600" : weight,
                                    },
                                ]}
                            >
                                {timeText}
                            </Text>
                            {secondary ? (
                                <Text
                                    style={[
                                        styles.secondary,
                                        theme.tabularNums,
                                        { color: theme.colors.ink2 },
                                    ]}
                                    numberOfLines={1}
                                >
                                    {secondary}
                                </Text>
                            ) : null}
                        </View>
                        <View style={styles.platformCell}>
                            {row.platform ? (
                                <PlatformBadge
                                    platform={row.platform}
                                    muted={passed}
                                    size={28}
                                />
                            ) : predicted ? (
                                <PlatformBadge
                                    platform={predicted}
                                    predicted
                                    size={28}
                                />
                            ) : null}
                        </View>
                    </View>,
                ];
            })}
            <TrainMarker
                centers={centers}
                position={position}
                fraction={fraction}
                level={level}
            />
        </View>
    );
}

/**
 * 0–1 along the current segment, animated to each new value: linear from
 * tick to tick while gliding, eased for a jump. A new segment snaps.
 */
function useSegmentFraction(
    position: RailPosition | null,
    animate: boolean,
    glide: boolean,
): Animated.Value {
    const value = useRef(new Animated.Value(position?.fraction ?? 0)).current;
    const segment = useRef<string | null>(null);
    const key = position ? `${position.from}-${position.to}` : null;
    const fraction = position?.fraction ?? 0;
    useEffect(() => {
        const sameSegment = segment.current === key;
        segment.current = key;
        if (!animate || !sameSegment) {
            value.setValue(fraction);
            return;
        }
        const animation = Animated.timing(value, {
            toValue: fraction,
            duration: glide ? TICK_MS : UPDATE_MS,
            easing: glide ? Easing.linear : Easing.out(Easing.quad),
            useNativeDriver: true,
        });
        animation.start();
        return () => animation.stop();
    }, [key, fraction, animate, glide, value]);
    return value;
}

function Rail({
    centers,
    count,
    position,
    fraction,
    level,
    fallbackPassed,
}: {
    centers: (number | undefined)[];
    count: number;
    position: RailPosition | null;
    fraction: Animated.Value;
    level: DelayLevel | "stale";
    /** Last passed stop, when there is no position */
    fallbackPassed: number;
}) {
    const theme = useAppTheme();
    const first = centers[0];
    const last = centers[count - 1];
    if (first === undefined || last === undefined || last <= first) {
        return null;
    }
    const length = last - first;
    const at = (index: number) => ((centers[index] ?? first) - first) / length;

    let scale: Animated.AnimatedInterpolation<number> | number = 0;
    if (position) {
        scale = fraction.interpolate({
            inputRange: [0, 1],
            outputRange: [at(position.from), at(position.to)],
            extrapolate: "clamp",
        });
    } else if (fallbackPassed >= 0) {
        scale = at(fallbackPassed);
    }
    const passedColor =
        level === "stale" ? theme.stale.fill : theme.colors.ink2;
    return (
        <>
            <View
                style={[
                    styles.rail,
                    {
                        top: first,
                        height: length,
                        backgroundColor: theme.colors.line,
                    },
                ]}
                pointerEvents="none"
            />
            <Animated.View
                style={[
                    styles.rail,
                    styles.passed,
                    {
                        top: first,
                        height: length,
                        backgroundColor: passedColor,
                        transform: [{ scaleY: scale }],
                    },
                ]}
                pointerEvents="none"
            />
        </>
    );
}

function TrainMarker({
    centers,
    position,
    fraction,
    level,
}: {
    centers: (number | undefined)[];
    position: RailPosition | null;
    fraction: Animated.Value;
    level: DelayLevel | "stale";
}) {
    const theme = useAppTheme();
    if (!position) return null;
    const from = centers[position.from];
    const to = centers[position.to];
    if (from === undefined || to === undefined) return null;
    const fill = level === "stale" ? theme.stale.fill : theme.delay[level].fill;
    const glyph =
        level === "stale" ? theme.colors.surface : theme.delay[level].label;
    return (
        <Animated.View
            style={[
                styles.marker,
                {
                    backgroundColor: fill,
                    borderColor: theme.colors.surface,
                    transform: [
                        {
                            translateY: fraction.interpolate({
                                inputRange: [0, 1],
                                outputRange: [
                                    from - MARKER / 2,
                                    to - MARKER / 2,
                                ],
                                extrapolate: "clamp",
                            }),
                        },
                    ],
                },
            ]}
            pointerEvents="none"
            accessible={false}
            importantForAccessibility="no-hide-descendants"
        >
            <Icon name="train-front" size={11} color={glyph} />
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: "row",
        alignItems: "center",
        minHeight: 44,
        gap: 8,
    },
    dotCell: { width: 18, alignItems: "center" },
    dot: { borderRadius: 6 },
    nameCell: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    name: { flexShrink: 1 },
    services: { fontFamily: MNR2007_FONT, fontSize: 16 },
    timeCell: { minWidth: 60, alignItems: "flex-end" },
    time: { fontSize: 16 },
    secondary: { fontSize: 12, marginTop: 1 },
    platformCell: { width: 34, alignItems: "flex-end" },
    now: {
        justifyContent: "center",
        minHeight: 30,
        paddingLeft: 26,
    },
    nowText: { fontSize: 13, fontWeight: "700" },
    rail: {
        position: "absolute",
        left: RAIL_X - 1.5,
        width: 3,
        borderRadius: 1.5,
    },
    passed: { transformOrigin: "top" },
    marker: {
        position: "absolute",
        top: 0,
        left: RAIL_X - MARKER / 2,
        width: MARKER,
        height: MARKER,
        borderRadius: MARKER / 2,
        borderWidth: 2,
        alignItems: "center",
        justifyContent: "center",
    },
});

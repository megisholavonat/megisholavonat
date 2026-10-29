import type { Station } from "@megisholavonat/api-client";
import {
    getStationBoardOptions,
    planJourneysOptions,
} from "@megisholavonat/api-client/react-query";
import { isAnyBudapest } from "@megisholavonat/core/planner";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { useTranslations } from "use-intl";
import { useAppTheme } from "../theme/ThemeProvider";
import { Skeleton, StateBlock } from "../ui/ds";
import { Icon } from "../ui/Icon";
import { Segmented } from "../ui/Segmented";
import { ItineraryCard } from "./ItineraryCard";
import { itineraryKey, timeParam } from "./plan";
import { type Field, planner, usePlanner } from "./store";
import { TimeField } from "./TimeField";

// Live delays and risks change by the minute
const REFRESH_MS = 60_000;

/**
 * A station from a shared link is known by its id only: its name comes
 * with its board.
 */
function useStationNameLookup(
    station: Station | null,
    onFound: (station: Station) => void,
) {
    const stub = !!station && !station.name;
    const board = useQuery({
        ...getStationBoardOptions({
            path: { stationId: station?.id ?? "" },
            query: { limit: 1 },
        }),
        enabled: stub,
        staleTime: Number.POSITIVE_INFINITY,
    });
    const found = stub ? board.data?.station : undefined;
    const onFoundRef = useRef(onFound);
    onFoundRef.current = onFound;
    useEffect(() => {
        if (found) onFoundRef.current(found);
    }, [found]);
}

/** Journey planner: from, to, when; journeys with their transfer risk. */
export function JourneyPlanner({ onPick }: { onPick: (field: Field) => void }) {
    const theme = useAppTheme();
    const t = useTranslations("Journey");
    const tc = useTranslations("Common");
    const { from, to, time, arriveBy } = usePlanner();
    const stationName = (station: Station) =>
        isAnyBudapest(station) ? t("any_budapest") : station.name || "…";
    useStationNameLookup(from, (station) => planner.set({ from: station }));
    useStationNameLookup(to, (station) => planner.set({ to: station }));
    const [open, setOpen] = useState<string | null>(null);

    const ready = !!from && !!to && from.id !== to.id;
    const journeys = useQuery({
        ...planJourneysOptions({
            query: {
                from: from?.id ?? "",
                to: to?.id ?? "",
                time: timeParam(time),
                arriveBy,
                limit: 6,
                // Metro, tram and bus to and from the trains
                cityTransit: true,
            },
        }),
        enabled: ready,
        refetchInterval: REFRESH_MS,
        placeholderData: (previous) => previous,
    });
    const itineraries = ready ? journeys.data?.itineraries : undefined;

    return (
        <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            contentContainerStyle={styles.content}
        >
            <View
                style={[
                    styles.group,
                    {
                        backgroundColor: theme.colors.surface,
                        borderRadius:
                            Platform.OS === "ios" ? theme.radii.lg : 20,
                    },
                ]}
            >
                <View style={styles.flex}>
                    <StationRow
                        label={t("from")}
                        placeholder={t("pick_from")}
                        name={from ? stationName(from) : undefined}
                        onPress={() => onPick("from")}
                    />
                    <View
                        style={[
                            styles.divider,
                            { backgroundColor: theme.colors.line },
                        ]}
                    />
                    <StationRow
                        label={t("to")}
                        placeholder={t("pick_to")}
                        name={to ? stationName(to) : undefined}
                        onPress={() => onPick("to")}
                    />
                </View>
                <Pressable
                    onPress={() => planner.swap()}
                    accessibilityRole="button"
                    accessibilityLabel={t("swap")}
                    android_ripple={{
                        color: theme.colors.line,
                        borderless: true,
                    }}
                    hitSlop={8}
                    style={[
                        styles.swap,
                        { backgroundColor: theme.colors.surface2 },
                    ]}
                >
                    <Icon name="swap" size={20} color={theme.colors.ink} />
                </Pressable>
            </View>

            <Segmented
                options={[
                    { value: "depart", label: t("depart") },
                    { value: "arrive", label: t("arrive") },
                ]}
                value={arriveBy ? "arrive" : "depart"}
                onChange={(value) =>
                    planner.set({ arriveBy: value === "arrive" })
                }
            />
            <TimeField
                value={time}
                onChange={(value) => planner.set({ time: value })}
            />

            {!ready ? null : itineraries ? (
                itineraries.length > 0 ? (
                    <View style={styles.results}>
                        {itineraries.map((itinerary) => {
                            const key = itineraryKey(itinerary);
                            return (
                                <ItineraryCard
                                    key={key}
                                    itinerary={itinerary}
                                    fromId={from?.id}
                                    toId={to?.id}
                                    expanded={open === key}
                                    onToggle={() =>
                                        setOpen(open === key ? null : key)
                                    }
                                />
                            );
                        })}
                    </View>
                ) : (
                    <StateBlock icon="route" title={t("empty")} />
                )
            ) : journeys.isError ? (
                <StateBlock
                    icon="warning"
                    tone="warning"
                    title={t("error")}
                    action={{
                        label: tc("retry"),
                        onPress: () => journeys.refetch(),
                    }}
                />
            ) : (
                <View style={styles.results}>
                    {[0.6, 0.45, 0.55].map((w) => (
                        <View
                            key={w}
                            style={[
                                styles.skeleton,
                                {
                                    backgroundColor: theme.colors.surface,
                                    borderRadius:
                                        Platform.OS === "ios"
                                            ? theme.radii.lg
                                            : 20,
                                },
                            ]}
                        >
                            <Skeleton width={`${w * 100}%`} height={20} />
                            <Skeleton width="35%" height={14} />
                        </View>
                    ))}
                </View>
            )}
        </ScrollView>
    );
}

function StationRow({
    label,
    placeholder,
    name,
    onPress,
}: {
    label: string;
    placeholder: string;
    name: string | undefined;
    onPress: () => void;
}) {
    const theme = useAppTheme();
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={name ? `${label}: ${name}` : placeholder}
            android_ripple={{ color: theme.colors.line }}
            style={({ pressed }) => [
                styles.row,
                pressed &&
                    Platform.OS === "ios" && {
                        backgroundColor: theme.colors.surface2,
                    },
            ]}
        >
            <Text
                style={[
                    theme.type.caption,
                    styles.rowLabel,
                    { color: theme.colors.ink2 },
                ]}
            >
                {label}
            </Text>
            <Text
                style={[
                    theme.type.body,
                    styles.flex,
                    {
                        color: name ? theme.colors.ink : theme.colors.ink2,
                        fontWeight: name ? "600" : "400",
                    },
                ]}
                numberOfLines={1}
            >
                {name ?? placeholder}
            </Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    content: { padding: 16, gap: 14 },
    group: {
        flexDirection: "row",
        alignItems: "center",
        overflow: "hidden",
        paddingRight: 12,
    },
    flex: { flex: 1 },
    row: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        minHeight: 56,
        paddingHorizontal: 16,
    },
    rowLabel: { width: 56 },
    divider: { height: StyleSheet.hairlineWidth, marginLeft: 84 },
    swap: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
    },
    results: { gap: 12, paddingTop: 4 },
    skeleton: { padding: 16, gap: 10 },
});

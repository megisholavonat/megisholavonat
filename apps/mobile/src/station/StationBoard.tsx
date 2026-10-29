import {
    getStationBoardOptions,
    getStationPlatformsOptions,
} from "@megisholavonat/api-client/react-query";
import { DELAY_REASONS } from "@megisholavonat/core/delayReasons";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFormatter, useLocale, useTranslations } from "use-intl";
import { useAppTheme } from "../theme/ThemeProvider";
import { RouteIcon } from "../train/RouteIcon";
import { CloseButton } from "../ui/CloseButton";
import { DelayChip, PlatformBadge, Skeleton, StateBlock } from "../ui/ds";
import { Segmented } from "../ui/Segmented";
import { SheetHandle } from "../ui/SheetHandle";
import { type BoardRow, boardRows } from "./board";

type Kind = "departures" | "arrivals";

const BOARD_REFRESH_MS = 60_000;
const PLATFORMS_STALE_MS = 6 * 3600_000;

/** Screen 3: a station's departures and arrivals, in a native sheet. */
export function StationBoard({
    stationId,
    initialName,
    onClose,
    onTrain,
}: {
    stationId: string;
    /** Shown until the board loads (from search) */
    initialName?: string;
    onClose: () => void;
    onTrain: (vehicleId: string) => void;
}) {
    const theme = useAppTheme();
    const t = useTranslations("Station");
    const tc = useTranslations("Common");
    const [kind, setKind] = useState<Kind>("departures");

    const board = useQuery({
        ...getStationBoardOptions({
            path: { stationId },
            query: { kind, limit: 40 },
        }),
        refetchInterval: BOARD_REFRESH_MS,
    });
    const { data: platforms } = useQuery({
        ...getStationPlatformsOptions({ path: { stationId } }),
        staleTime: PLATFORMS_STALE_MS,
    });
    const rows = useMemo(
        () =>
            board.data
                ? boardRows(board.data.entries, platforms?.predictions)
                : null,
        [board.data, platforms],
    );

    const name = board.data?.station.name ?? initialName ?? "";

    return (
        <ScrollView contentContainerStyle={styles.container}>
            <SheetHandle />
            <View style={styles.header}>
                <Text
                    style={[
                        theme.type.title,
                        styles.flex,
                        { color: theme.colors.ink },
                    ]}
                    numberOfLines={2}
                    accessibilityRole="header"
                >
                    {name}
                </Text>
                <CloseButton onPress={onClose} />
            </View>
            <Segmented
                options={[
                    { value: "departures", label: t("departures") },
                    { value: "arrivals", label: t("arrivals") },
                ]}
                value={kind}
                onChange={setKind}
            />
            {rows ? (
                rows.length > 0 ? (
                    <View>
                        {rows.map((row, index) => (
                            <BoardRowView
                                key={row.key}
                                row={row}
                                kind={kind}
                                last={index === rows.length - 1}
                                onPress={
                                    row.vehicleId
                                        ? () => onTrain(row.vehicleId as string)
                                        : undefined
                                }
                            />
                        ))}
                    </View>
                ) : (
                    <StateBlock icon="noTrains" title={t("empty")} />
                )
            ) : board.isError ? (
                <StateBlock
                    icon="warning"
                    tone="warning"
                    title={t("error")}
                    action={{
                        label: tc("retry"),
                        onPress: () => board.refetch(),
                    }}
                />
            ) : (
                <View style={styles.skeleton}>
                    {[0.5, 0.7, 0.4, 0.6].map((w) => (
                        <View key={w} style={styles.skeletonRow}>
                            <Skeleton width={46} height={18} />
                            <Skeleton width={`${w * 100}%`} height={16} />
                        </View>
                    ))}
                </View>
            )}
        </ScrollView>
    );
}

function BoardRowView({
    row,
    kind,
    last,
    onPress,
}: {
    row: BoardRow;
    kind: Kind;
    last: boolean;
    onPress?: () => void;
}) {
    const theme = useAppTheme();
    const t = useTranslations("Station");
    const format = useFormatter();
    const locale = useLocale();
    const time = format.dateTime(new Date(row.time * 1000), {
        hour: "2-digit",
        minute: "2-digit",
    });
    const place =
        kind === "arrivals" && row.place
            ? t("from", { name: row.place })
            : row.place;
    const reason = row.reason ? DELAY_REASONS[row.reason][locale] : null;

    return (
        <Pressable
            onPress={onPress}
            disabled={!onPress}
            android_ripple={{ color: theme.colors.line }}
            accessibilityRole={onPress ? "button" : undefined}
            style={[
                styles.row,
                !last && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: theme.colors.line,
                },
            ]}
        >
            <View style={styles.timeCell}>
                <Text
                    style={[
                        styles.time,
                        theme.tabularNums,
                        {
                            color: theme.colors.ink,
                            textDecorationLine: row.canceled
                                ? "line-through"
                                : "none",
                        },
                    ]}
                >
                    {time}
                </Text>
                {row.realtime && !row.canceled ? (
                    <DelayChip delay={row.delay} small />
                ) : null}
            </View>
            <View style={styles.flex}>
                <Text
                    style={[styles.place, { color: theme.colors.ink }]}
                    numberOfLines={1}
                >
                    {place}
                </Text>
                <View style={styles.sub}>
                    <RouteIcon
                        routeShortName={row.routeShortName}
                        color={theme.colors.ink2}
                        size={18}
                    />
                    <Text
                        style={[styles.subText, { color: theme.colors.ink2 }]}
                        numberOfLines={1}
                    >
                        {row.trainNumber}
                        {row.canceled ? (
                            <Text style={{ color: theme.delay.severe.text }}>
                                {` · ${t("canceled")}`}
                            </Text>
                        ) : reason ? (
                            <Text style={{ color: theme.delay.severe.text }}>
                                {` · ${reason}`}
                            </Text>
                        ) : null}
                    </Text>
                </View>
            </View>
            <View style={styles.platformCell}>
                {row.platform ? (
                    <PlatformBadge
                        platform={row.platform}
                        predicted={row.predicted}
                    />
                ) : null}
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: 18,
        paddingTop: 18,
        paddingBottom: 32,
        gap: 12,
    },
    header: { flexDirection: "row", alignItems: "center", gap: 10 },
    flex: { flex: 1 },
    row: {
        flexDirection: "row",
        alignItems: "center",
        minHeight: 60,
        paddingVertical: 8,
        gap: 10,
    },
    timeCell: { width: 58, gap: 2 },
    time: { fontSize: 18, fontWeight: "700" },
    place: { fontSize: 16, fontWeight: "600" },
    sub: { flexDirection: "row", alignItems: "center", gap: 4 },
    subText: { fontSize: 13, flexShrink: 1 },
    platformCell: { width: 40, alignItems: "flex-end" },
    skeleton: { gap: 22, paddingTop: 8 },
    skeletonRow: { flexDirection: "row", gap: 12, alignItems: "center" },
});

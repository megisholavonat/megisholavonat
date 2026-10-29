import {
    getStationPlatformsOptions,
    getTrainStationHistoryOptions,
} from "@megisholavonat/api-client/react-query";
import { DELAY_REASONS } from "@megisholavonat/core/delayReasons";
import { minutesSinceUpdate, staleness } from "@megisholavonat/core/stale";
import { useQuery } from "@tanstack/react-query";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useFormatter, useLocale, useTranslations } from "use-intl";
import { useAppTheme } from "../theme/ThemeProvider";
import { RouteIcon } from "../train/RouteIcon";
import {
    beforeDeparture,
    isUsuallyLate,
    mainAlert,
    predictedPlatform,
} from "../train/trainData";
import { DelayChip, PlatformBadge } from "../ui/ds";
import { Icon } from "../ui/Icon";
import type { LiveFollow } from "./live";
import { type LocalFollow, type Run, trainNumber } from "./model";

const STATION_DATA_STALE_MS = 6 * 3600_000;
/** Rows on home; more follows wait until these have left */
const MAX_ROWS = 3;

export interface CommuteItem {
    follow: LocalFollow;
    run: Run;
    live: LiveFollow | undefined;
}

/**
 * "Újpest 17:24 · 2 · pontos": the next run of a follow (design board 1,
 * the peek of home). Platform "6?" when only predicted; the delay reason,
 * or "usually late" before departure, in plain words below.
 */
function CommuteRow({
    item,
    first,
    onPress,
}: {
    item: CommuteItem;
    first: boolean;
    onPress: () => void;
}) {
    const theme = useAppTheme();
    const t = useTranslations("Home");
    const tt = useTranslations("Train");
    const format = useFormatter();
    const locale = useLocale();
    const { follow, run, live } = item;
    const board = follow.stops[follow.from];
    const number = trainNumber(follow.tripShortName);
    const stationId = board?.stationId ?? "";

    const departed = live?.board?.state === "passed";
    const notYetDeparted = live
        ? !departed && beforeDeparture(live.details)
        : true;
    const announced = live?.board?.platform ?? null;

    const { data: platforms } = useQuery({
        ...getStationPlatformsOptions({
            path: { stationId },
            query: { trainNumber: number },
        }),
        enabled: !!stationId && !!number && !announced && run.dayOffset <= 1,
        staleTime: STATION_DATA_STALE_MS,
    });
    const { data: history } = useQuery({
        ...getTrainStationHistoryOptions({
            path: { trainNumber: number, stationId },
        }),
        enabled: !!stationId && !!number && notYetDeparted,
        staleTime: STATION_DATA_STALE_MS,
    });
    const predicted = announced
        ? null
        : predictedPlatform(platforms?.predictions, number);

    const day =
        run.dayOffset === 0
            ? null
            : run.dayOffset === 1
              ? t("tomorrow")
              : format.dateTime(new Date(run.departure), { weekday: "short" });
    const time = format.dateTime(new Date(run.departure), {
        hour: "2-digit",
        minute: "2-digit",
    });

    const lastUpdated = live?.details.lastUpdated;
    const stale =
        lastUpdated !== undefined && staleness(lastUpdated) !== "fresh";
    const delay = live
        ? Math.round(
              departed || !live.board ? live.details.delay : live.board.delay,
          )
        : null;

    const reason = live ? mainAlert(live.details.trip.alerts)?.reason : null;
    const note = reason
        ? DELAY_REASONS[reason.code][locale]
        : notYetDeparted && isUsuallyLate(history)
          ? tt("usually_late")
          : null;

    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            android_ripple={{ color: theme.colors.line }}
            style={({ pressed }) => [
                styles.row,
                !first && {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: theme.colors.line,
                },
                pressed && Platform.OS === "ios" && { opacity: 0.6 },
            ]}
        >
            <View style={styles.line}>
                <RouteIcon
                    routeShortName={follow.routeShortName}
                    color={theme.colors.ink}
                />
                <Text
                    style={[
                        theme.type.headline,
                        theme.tabularNums,
                        styles.flex,
                        { color: theme.colors.ink },
                    ]}
                    numberOfLines={1}
                >
                    {[board?.name, day, time].filter(Boolean).join(" ")}
                </Text>
                {announced ? (
                    <PlatformBadge platform={announced} />
                ) : predicted ? (
                    <PlatformBadge platform={predicted} predicted />
                ) : null}
                {delay !== null ? (
                    <DelayChip
                        delay={delay}
                        staleMinutes={
                            stale && lastUpdated !== undefined
                                ? minutesSinceUpdate(lastUpdated)
                                : null
                        }
                    />
                ) : null}
            </View>
            {note ? (
                <Text
                    style={[styles.note, { color: theme.colors.ink2 }]}
                    numberOfLines={1}
                >
                    {note}
                </Text>
            ) : null}
        </Pressable>
    );
}

/** My commute on home: the next runs of followed trains, soonest first. */
export function CommuteCard({
    items,
    onOpen,
}: {
    items: CommuteItem[];
    onOpen: (item: CommuteItem) => void;
}) {
    const theme = useAppTheme();
    const t = useTranslations("Home");
    if (items.length === 0) return null;
    return (
        <View
            style={[
                styles.card,
                {
                    backgroundColor: theme.colors.surface,
                    borderRadius: Platform.OS === "ios" ? 22 : 24,
                },
            ]}
            accessibilityLabel={t("my_commute")}
        >
            {items.slice(0, MAX_ROWS).map((item, i) => (
                <CommuteRow
                    key={item.follow.id}
                    item={item}
                    first={i === 0}
                    onPress={() => onOpen(item)}
                />
            ))}
        </View>
    );
}

/** Home without follows: one tonal button towards search (design board 1). */
export function FollowPrompt({ onPress }: { onPress: () => void }) {
    const theme = useAppTheme();
    const t = useTranslations("Home");
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            android_ripple={{ color: theme.colors.line }}
            style={({ pressed }) => [
                styles.prompt,
                { backgroundColor: theme.colors.surface2 },
                pressed && Platform.OS === "ios" && { opacity: 0.6 },
            ]}
        >
            <Icon name="follow" size={20} color={theme.colors.ink} />
            <Text style={[styles.promptLabel, { color: theme.colors.ink }]}>
                {t("follow_cta")}
            </Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    card: {
        paddingHorizontal: 14,
        overflow: "hidden",
        shadowColor: "#000",
        shadowOpacity: 0.12,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 4 },
        elevation: 3,
    },
    row: { paddingVertical: 12, gap: 2 },
    line: { flexDirection: "row", alignItems: "center", gap: 10 },
    flex: { flex: 1 },
    note: { fontSize: 14, marginLeft: 32 },
    prompt: {
        height: 52,
        borderRadius: 26,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        overflow: "hidden",
        elevation: 2,
    },
    promptLabel: { fontSize: 15, fontWeight: "600" },
});

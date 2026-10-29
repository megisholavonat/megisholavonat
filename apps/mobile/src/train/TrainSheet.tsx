import type { TrainFeatureProperties } from "@megisholavonat/api-client";
import {
    getStationPlatformsOptions,
    getTrainDetailsOptions,
    getTrainStationHistoryOptions,
    getTrainsOptions,
} from "@megisholavonat/api-client/react-query";
import { getDelayLevel } from "@megisholavonat/core/delay";
import { DELAY_REASONS } from "@megisholavonat/core/delayReasons";
import { minutesSinceUpdate, staleness } from "@megisholavonat/core/stale";
import { ticketUrl } from "@megisholavonat/core/ticket";
import {
    formatSecondsAsTime,
    serviceDayStart,
} from "@megisholavonat/core/time";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { type ReactNode, useMemo } from "react";
import {
    Platform,
    ScrollView,
    Share,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { useLocale, useTranslations } from "use-intl";
import { WEB_URL } from "../config";
import { findFollowFor } from "../follow/model";
import { useFollows } from "../follow/store";
import { withAlpha } from "../theme/palette";
import { useAppTheme } from "../theme/ThemeProvider";
import { CloseButton } from "../ui/CloseButton";
import { delayTextColor, PlatformBadge, Skeleton, StateBlock } from "../ui/ds";
import { Icon, isIconName } from "../ui/Icon";
import { SheetHandle } from "../ui/SheetHandle";
import { RouteIcon } from "./RouteIcon";
import { StopList } from "./StopList";
import { TrainActions } from "./TrainActions";
import {
    beforeDeparture,
    isUsuallyLate,
    mainAlert,
    predictedPlatform,
    stopRows,
    trainTitle,
} from "./trainData";

const DETAILS_REFRESH_MS = 15_000;
const HISTORY_STALE_MS = 6 * 3600_000;

/**
 * The train sheet body: header, delay at the next stop, actions, delay
 * reason and the stop list. Presented in a native sheet with peek, half and
 * full detents (see the root layout); the peek shows the first two rows.
 */
export function TrainSheet({
    vehicleId,
    onClose,
}: {
    vehicleId: string;
    onClose: () => void;
}) {
    const theme = useAppTheme();
    const t = useTranslations("Train");
    const tc = useTranslations("Common");
    const locale = useLocale();
    const router = useRouter();
    const follows = useFollows();

    // The map's feed is cached, so the header shows before the details load
    const { data: feature } = useQuery({
        ...getTrainsOptions(),
        refetchOnMount: false,
        select: (fc): TrainFeatureProperties | undefined =>
            fc.features.find((f) => f.properties.vehicleId === vehicleId)
                ?.properties,
    });
    const {
        data: details,
        isError,
        refetch,
    } = useQuery({
        ...getTrainDetailsOptions({ path: { vehicle_id: vehicleId } }),
        refetchInterval: DETAILS_REFRESH_MS,
    });

    const rows = useMemo(() => (details ? stopRows(details) : []), [details]);
    const next = rows.find((r) => r.state === "next") ?? null;
    const last = rows.at(-1) ?? null;
    const first = rows[0] ?? null;

    const tripShortName = details?.trip.tripShortName ?? feature?.tripShortName;
    const title = tripShortName
        ? trainTitle(tripShortName, last?.name ?? null)
        : null;
    const trainNumber = title?.number ?? "";

    const notYetDeparted = details ? beforeDeparture(details) : false;
    const { data: history } = useQuery({
        ...getTrainStationHistoryOptions({
            path: { trainNumber, stationId: first?.uic ?? "" },
        }),
        enabled: notYetDeparted && !!trainNumber && !!first?.uic,
        staleTime: HISTORY_STALE_MS,
    });
    const { data: platforms } = useQuery({
        ...getStationPlatformsOptions({
            path: { stationId: next?.uic ?? "" },
            query: { trainNumber },
        }),
        enabled: !!next?.uic && !next.platform && !!trainNumber,
        staleTime: HISTORY_STALE_MS,
    });
    const nextPrediction = predictedPlatform(
        platforms?.predictions,
        trainNumber,
    );

    const routeShortName =
        details?.trip.route.shortName ?? feature?.routeShortName;
    const lastUpdated = details?.lastUpdated ?? feature?.lastUpdated;
    const stale =
        feature?.isStale === true ||
        (lastUpdated !== undefined && staleness(lastUpdated) !== "fresh");
    const delay = Math.round(details?.delay ?? feature?.delay ?? 0);

    if (isError && !details) {
        return (
            <View style={styles.container}>
                <Header onClose={onClose} routeShortName={routeShortName}>
                    {title?.number ?? ""}
                </Header>
                <StateBlock
                    icon="warning"
                    title={t("not_found")}
                    action={{ label: tc("retry"), onPress: () => refetch() }}
                />
            </View>
        );
    }

    const alert = details ? mainAlert(details.trip.alerts) : null;
    const reason = alert?.reason ?? feature?.reason ?? null;
    const reasonInfo = reason ? DELAY_REASONS[reason.code] : null;

    const delayColor = delayTextColor(theme, delay, stale);
    const onTime = getDelayLevel(delay) === "onTime";
    const delayLabel = onTime ? tc("on_time") : tc("delay_short", { delay });
    // Stale: the last known delay, marked uncertain ("+23?")
    const bigDelay = stale ? `${delayLabel}?` : delayLabel;

    const nowLabel = details
        ? [
              details.vehicleProgress.lastStop,
              details.speed != null && details.speed > 0
                  ? t("speed", { speed: Math.round(details.speed) })
                  : null,
          ]
              .filter(Boolean)
              .join(" · ")
        : null;

    const onShare = () => {
        const url = `${WEB_URL}/?vehicleId=${encodeURIComponent(vehicleId)}`;
        const name = title
            ? `${title.number}${title.name ? ` ${title.name}` : ""} → ${title.destination ?? ""}`
            : "";
        // iOS shares the URL as a link; Android only takes text
        Share.share(
            Platform.OS === "ios"
                ? { message: name, url }
                : { message: t("share_text", { train: name, url }) },
        );
    };
    const following = details
        ? findFollowFor(follows, details) !== null
        : false;
    const onFollow = () =>
        router.push({ pathname: "/follow", params: { vehicleId } });
    const onTicket = () => {
        const from = next ?? first;
        const departure =
            details && from
                ? serviceDayStart(details.trip.serviceDate) / 1000 +
                  from.scheduled
                : null;
        WebBrowser.openBrowserAsync(ticketUrl(from?.uic, last?.uic, departure));
    };

    return (
        <ScrollView
            contentContainerStyle={styles.container}
            // The sheet grows to the next detent before the list scrolls
            contentInsetAdjustmentBehavior="automatic"
        >
            <SheetHandle />
            <Header onClose={onClose} routeShortName={routeShortName}>
                {title ? (
                    <>
                        {title.number}
                        {title.name ? ` ${title.name}` : ""}
                        {title.destination ? ` → ${title.destination}` : ""}
                    </>
                ) : null}
            </Header>

            <View style={styles.summary}>
                <Text
                    style={[
                        theme.type.delayXl,
                        theme.tabularNums,
                        styles.bigDelay,
                        onTime && styles.bigOnTime,
                        { color: delayColor },
                    ]}
                    accessibilityLabel={
                        onTime ? tc("on_time") : tc("delay_a11y", { delay })
                    }
                    numberOfLines={1}
                    adjustsFontSizeToFit
                >
                    {bigDelay}
                </Text>
                <View
                    style={[
                        styles.nextStop,
                        { borderLeftColor: theme.colors.line },
                    ]}
                >
                    {next ? (
                        <>
                            <Text
                                style={[
                                    theme.type.headline,
                                    { color: theme.colors.ink },
                                ]}
                                numberOfLines={1}
                            >
                                {next.name}
                            </Text>
                            <Text style={[styles.nextTime, theme.tabularNums]}>
                                <Text style={{ color: theme.colors.ink }}>
                                    {stale ? "≈" : ""}
                                    {formatSecondsAsTime(next.expected)}
                                </Text>
                                {next.expected !== next.scheduled ? (
                                    <Text
                                        style={[
                                            styles.scheduled,
                                            { color: theme.colors.ink2 },
                                        ]}
                                        accessibilityLabel={t("scheduled", {
                                            time: formatSecondsAsTime(
                                                next.scheduled,
                                            ),
                                        })}
                                    >
                                        {"  "}
                                        {formatSecondsAsTime(next.scheduled)}
                                    </Text>
                                ) : null}
                            </Text>
                        </>
                    ) : (
                        <>
                            <Skeleton width={90} height={16} />
                            <Skeleton
                                width={130}
                                height={16}
                                style={styles.gap6}
                            />
                        </>
                    )}
                </View>
                {next?.platform ? (
                    <PlatformBadge platform={next.platform} size={38} />
                ) : nextPrediction ? (
                    <PlatformBadge
                        platform={nextPrediction}
                        predicted
                        size={38}
                    />
                ) : !details ? (
                    <Skeleton width={38} height={38} radius={7} />
                ) : null}
            </View>

            {stale && lastUpdated !== undefined ? (
                <View style={styles.inline}>
                    <Icon name="stale" size={16} color={theme.colors.ink2} />
                    <Text style={[styles.note, { color: theme.colors.ink2 }]}>
                        {t("stale", {
                            minutes: minutesSinceUpdate(lastUpdated),
                        })}
                    </Text>
                </View>
            ) : null}
            {notYetDeparted && isUsuallyLate(history) ? (
                <View style={styles.inline}>
                    <Icon name="stale" size={16} color={theme.colors.ink2} />
                    <Text style={[styles.note, { color: theme.colors.ink }]}>
                        {t("usually_late")}
                    </Text>
                </View>
            ) : null}

            {details ? (
                <TrainActions
                    following={following}
                    onFollow={onFollow}
                    onShare={onShare}
                    onTicket={onTicket}
                />
            ) : (
                <View style={styles.inline}>
                    <Skeleton height={48} radius={24} style={styles.flex} />
                    <Skeleton width={48} height={48} radius={24} />
                </View>
            )}

            {alert || reasonInfo ? (
                <View
                    style={[
                        styles.reason,
                        {
                            backgroundColor: withAlpha(
                                theme.delay.moderate.fill,
                                theme.dark ? 0.18 : 0.1,
                            ),
                        },
                    ]}
                    accessible
                >
                    <Icon
                        name={
                            reasonInfo && isIconName(reasonInfo.icon)
                                ? reasonInfo.icon
                                : "warning"
                        }
                        size={20}
                        color={theme.delay.moderate.text}
                    />
                    <View style={styles.flex}>
                        {reasonInfo ? (
                            <Text
                                style={[
                                    styles.reasonLabel,
                                    { color: theme.colors.ink },
                                ]}
                            >
                                {reasonInfo[locale]}
                            </Text>
                        ) : null}
                        {alert?.text && (!reasonInfo || locale === "hu") ? (
                            <Text
                                style={[
                                    reasonInfo
                                        ? styles.reasonText
                                        : styles.reasonLabel,
                                    {
                                        color: reasonInfo
                                            ? theme.colors.ink2
                                            : theme.colors.ink,
                                    },
                                ]}
                            >
                                {alert.text}
                            </Text>
                        ) : null}
                    </View>
                </View>
            ) : null}

            {details ? (
                <StopList
                    rows={rows}
                    nowLabel={nowLabel}
                    nextPlatformPrediction={nextPrediction}
                    stale={stale}
                />
            ) : (
                <View style={styles.skeletonList}>
                    {[1, 0.7, 0.55].map((w) => (
                        <View key={w} style={styles.inline}>
                            <Skeleton width={10} height={10} radius={5} />
                            <Skeleton width={`${w * 60}%`} />
                            <View style={styles.flex} />
                            <Skeleton width={44} />
                        </View>
                    ))}
                </View>
            )}
        </ScrollView>
    );
}

function Header({
    routeShortName,
    onClose,
    children,
}: {
    routeShortName?: string | null;
    onClose: () => void;
    children: ReactNode;
}) {
    const theme = useAppTheme();
    return (
        <View style={styles.header}>
            <RouteIcon
                routeShortName={routeShortName}
                color={theme.colors.ink}
            />
            <Text
                style={[
                    theme.type.headline,
                    styles.flex,
                    { color: theme.colors.ink },
                ]}
                numberOfLines={1}
                accessibilityRole="header"
            >
                {children}
            </Text>
            <CloseButton onPress={onClose} />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: 18,
        paddingTop: 14,
        paddingBottom: 32,
        gap: 12,
    },
    header: { flexDirection: "row", alignItems: "center", gap: 8 },
    summary: { flexDirection: "row", alignItems: "center", gap: 14 },
    bigDelay: { minWidth: 56, maxWidth: 140, letterSpacing: -0.5 },
    bigOnTime: { fontSize: 28, lineHeight: 34 },
    nextStop: {
        flex: 1,
        borderLeftWidth: StyleSheet.hairlineWidth * 2,
        paddingLeft: 14,
    },
    nextTime: { fontSize: 16, fontWeight: "600" },
    scheduled: {
        fontSize: 13,
        fontWeight: "400",
        textDecorationLine: "line-through",
    },
    inline: { flexDirection: "row", alignItems: "center", gap: 8 },
    note: { fontSize: 15, fontWeight: "600" },
    flex: { flex: 1 },
    gap6: { marginTop: 6 },
    reason: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    reasonLabel: { fontSize: 15, fontWeight: "600" },
    reasonText: { fontSize: 13, marginTop: 2 },
    skeletonList: { gap: 18, paddingTop: 6 },
});

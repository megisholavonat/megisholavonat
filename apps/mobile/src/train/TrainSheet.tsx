import type { TrainFeatureProperties } from "@megisholavonat/api-client";
import {
    getStationPlatformsOptions,
    getTrainDetailsOptions,
    getTrainStationHistoryOptions,
    getTrainsOptions,
} from "@megisholavonat/api-client/react-query";
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
import { useTranslations } from "use-intl";
import { WEB_URL } from "../config";
import { findFollowFor } from "../follow/model";
import { useFollows } from "../follow/store";
import { useAppTheme } from "../theme/ThemeProvider";
import { CloseButton } from "../ui/CloseButton";
import { PlatformBadge, Skeleton, StateBlock } from "../ui/ds";
import { Icon } from "../ui/Icon";
import { RollingText } from "../ui/motion";
import { SheetHandle } from "../ui/SheetHandle";
import { useNow } from "../ui/useNow";
import { type DelayTileModel, delayTile, reasonTone } from "./delayDisplay";
import { RouteIcon } from "./RouteIcon";
import { StopList } from "./StopList";
import { TrainActions } from "./TrainActions";
import { AlertList, ReasonLine, ServiceList } from "./TrainInfo";
import {
    beforeDeparture,
    isUsuallyLate,
    predictedPlatform,
    type StopRow,
    serviceGroups,
    sortedAlerts,
    stopRows,
    trainTitle,
} from "./trainData";
import { sheetInput, trainDisplay } from "./trainState";

const DETAILS_REFRESH_MS = 15_000;
const HISTORY_STALE_MS = 6 * 3600_000;
/** Ages and staleness are judged again this often */
const CLOCK_MS = 15_000;

/**
 * The train sheet body: header, delay at the next stop, actions, delay
 * reason, alerts, services and the stop list. Presented in a native sheet
 * with peek, half and full detents (see the root layout); the peek shows
 * the first two rows.
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
    const router = useRouter();
    const follows = useFollows();
    const now = useNow(CLOCK_MS);

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

    // One state for the tile, the times and the rail, by the same rules as
    // the map marker
    const input = sheetInput(details, feature, now);
    const display = input ? trainDisplay(input, now) : null;
    const running = display?.state === "running";
    const stale = display?.state === "stale";

    const rows = useMemo(
        () => (details ? stopRows(details, display?.state !== "idle") : []),
        [details, display?.state],
    );
    const services = useMemo(
        () =>
            details
                ? serviceGroups(
                      details.trip.infoServices,
                      details.trip.stoptimes.length,
                  )
                : { whole: [], byStop: [] },
        [details],
    );
    const next = rows.find((r) => r.state === "next") ?? null;
    const last = rows.at(-1) ?? null;
    const first = rows[0] ?? null;

    const tripShortName = details?.trip.tripShortName ?? feature?.tripShortName;
    const title = tripShortName
        ? trainTitle(tripShortName, last?.name ?? null)
        : null;
    const trainNumber = title?.number ?? "";

    const notYetDeparted = details ? beforeDeparture(details, now) : false;
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

    const alerts = details ? sortedAlerts(details.trip.alerts) : [];
    const reason =
        alerts.find((a) => a.reason)?.reason ?? feature?.reason ?? null;
    // The cause only for a train that is actually late, in its colour
    const tone = display ? reasonTone(display.delay, stale) : null;

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
                {display ? (
                    <DelayTile tile={delayTile(display)} first={first} />
                ) : (
                    <Skeleton width={64} height={44} radius={10} />
                )}
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

            {display?.outdated ? (
                <View style={styles.inline}>
                    <Icon name="stale" size={16} color={theme.colors.ink2} />
                    <Text style={[styles.note, { color: theme.colors.ink2 }]}>
                        {t("stale", { minutes: display.minutesSinceUpdate })}
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
            {reason && tone ? <ReasonLine reason={reason} tone={tone} /> : null}

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

            <ServiceList services={services.whole} />
            <AlertList alerts={alerts} />

            {details && display ? (
                <StopList
                    details={details}
                    rows={rows}
                    services={services.byStop}
                    nextPlatformPrediction={nextPrediction}
                    stale={stale}
                    running={running}
                    level={display.level}
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

/**
 * The big delay: always a number ("+2" with "pontos" under it when on
 * time, "−1" when early, "+23?" for old data), rolling to each new value;
 * "–" with what the train is doing when it isn't under way.
 */
function DelayTile({
    tile,
    first,
}: {
    tile: DelayTileModel;
    first: StopRow | null;
}) {
    const theme = useAppTheme();
    const t = useTranslations("Train");
    const tc = useTranslations("Common");
    const color =
        tile.level === "stale"
            ? theme.stale.text
            : theme.delay[tile.level].text;
    const caption = (() => {
        switch (tile.caption?.kind) {
            case "on_time":
                return tc("on_time");
            case "departs":
                return first
                    ? t("departs", {
                          time: formatSecondsAsTime(first.expected),
                      })
                    : null;
            case "arrived":
                return t("arrived");
            case "not_running":
                return t("not_running");
            case "cancelled":
                return t("cancelled");
            default:
                return null;
        }
    })();
    const label = [
        tile.delay !== null && tile.delay > 0
            ? tc("delay_a11y", { delay: tile.delay })
            : tile.delay !== null
              ? tile.text
              : null,
        caption,
    ]
        .filter(Boolean)
        .join(", ");
    return (
        <View style={styles.tile} accessible accessibilityLabel={label}>
            <RollingText
                text={tile.text}
                lineHeight={theme.type.delayXl.lineHeight}
                style={[
                    theme.type.delayXl,
                    theme.tabularNums,
                    styles.bigDelay,
                    { color },
                ]}
            />
            {caption ? (
                <Text
                    style={[styles.caption, { color }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                >
                    {caption}
                </Text>
            ) : null}
        </View>
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
    tile: { minWidth: 56, maxWidth: 140, alignItems: "flex-start" },
    bigDelay: { letterSpacing: -0.5 },
    caption: { fontSize: 13, fontWeight: "600", marginTop: -2 },
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
    skeletonList: { gap: 18, paddingTop: 6 },
});

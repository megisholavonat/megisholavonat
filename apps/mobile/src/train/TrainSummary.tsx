import {
    getTrainDetailsOptions,
    getTrainsOptions,
} from "@megisholavonat/api-client/react-query";
import {
    DELAY_COLORS,
    getDelayLevel,
    NO_DATA_COLOR,
} from "@megisholavonat/core/delay";
import { useQuery } from "@tanstack/react-query";
import {
    ActivityIndicator,
    Platform,
    PlatformColor,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { useTranslations } from "use-intl";
import { splitTripName } from "./labels";
import { RouteIcon } from "./RouteIcon";

const DETAILS_REFRESH_MS = 15_000;

const labelColor = Platform.select({
    ios: PlatformColor("label"),
    android: PlatformColor("?android:attr/textColorPrimary"),
});
const secondaryLabelColor = Platform.select({
    ios: PlatformColor("secondaryLabel"),
    android: PlatformColor("?android:attr/textColorSecondary"),
});

/** Route icon, number and name, delay and next stop of one train. */
export function TrainSummary({ vehicleId }: { vehicleId: string }) {
    const t = useTranslations();

    // The map's feed is already cached, so the header renders immediately.
    const { data: feature } = useQuery({
        ...getTrainsOptions(),
        refetchOnMount: false,
        select: (fc) =>
            fc.features.find((f) => f.properties.vehicleId === vehicleId)
                ?.properties,
    });
    const { data: details } = useQuery({
        ...getTrainDetailsOptions({ path: { vehicle_id: vehicleId } }),
        refetchInterval: DETAILS_REFRESH_MS,
    });

    const routeShortName =
        details?.trip.route.shortName ?? feature?.routeShortName;
    const routeColor = details?.trip.route.textColor ?? feature?.routeTextColor;
    const tripShortName = details?.trip.tripShortName ?? feature?.tripShortName;
    const delay = details?.delay ?? feature?.delay;
    const isStale = feature?.isStale === true;
    const nextStop = details?.vehicleProgress.nextStop;

    if (!tripShortName) {
        return (
            <View style={styles.loading}>
                <ActivityIndicator />
            </View>
        );
    }

    const { number, name } = splitTripName(tripShortName);
    const level = delay === undefined ? null : getDelayLevel(delay);
    const delayColor =
        isStale || level === null ? NO_DATA_COLOR : DELAY_COLORS[level];
    const delayText =
        isStale || delay === undefined
            ? t("DelayLegend.labels.no_data")
            : level === "onTime"
              ? t("DelayLegend.labels.on_time")
              : t("TrainPanel.delay_minutes", { delay });

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <RouteIcon
                    routeShortName={routeShortName}
                    textColor={routeColor}
                />
                <Text
                    style={[styles.title, { color: labelColor }]}
                    numberOfLines={2}
                >
                    {number ? (
                        <Text style={styles.number}>{number} </Text>
                    ) : null}
                    {name}
                </Text>
            </View>
            <View style={styles.row}>
                <View style={[styles.dot, { backgroundColor: delayColor }]} />
                <Text
                    style={[styles.body, { color: labelColor }]}
                    accessibilityLabel={`${t("TrainPanel.delay")}: ${delayText}`}
                >
                    {delayText}
                </Text>
            </View>
            {nextStop ? (
                <View style={styles.row}>
                    <Text
                        style={[styles.caption, { color: secondaryLabelColor }]}
                    >
                        {t("TrainPanel.next_stop")}
                    </Text>
                    <Text
                        style={[styles.body, { color: labelColor }]}
                        numberOfLines={1}
                    >
                        {nextStop}
                    </Text>
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    loading: { padding: 24, alignItems: "center" },
    container: { paddingHorizontal: 20, paddingVertical: 16, gap: 12 },
    header: { flexDirection: "row", alignItems: "center", gap: 12 },
    title: { flex: 1, fontSize: 20, fontWeight: "600" },
    number: { fontWeight: "800" },
    row: { flexDirection: "row", alignItems: "center", gap: 8 },
    dot: { width: 12, height: 12, borderRadius: 6 },
    body: { fontSize: 17, flexShrink: 1 },
    caption: { fontSize: 15 },
});

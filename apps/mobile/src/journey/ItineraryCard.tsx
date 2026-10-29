import type {
    CityLeg,
    Itinerary,
    Transfer,
    TransitLeg,
    WalkLeg,
} from "@megisholavonat/api-client";
import {
    alightingElsewhere,
    boardingElsewhere,
    legChain,
} from "@megisholavonat/core/planner";
import { formatClock } from "@megisholavonat/core/time";
import * as WebBrowser from "expo-web-browser";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { withAlpha } from "../theme/palette";
import { useAppTheme } from "../theme/ThemeProvider";
import { RouteIcon } from "../train/RouteIcon";
import { trainTitle } from "../train/trainData";
import { DelayChip, PlatformBadge } from "../ui/ds";
import { Icon } from "../ui/Icon";
import { CityChip } from "./CityChip";
import {
    durationParts,
    type RiskKind,
    rideDelay,
    rides,
    riskColorLevel,
    steps,
    transferRisk,
    worstRisk,
} from "./plan";

/** Coloured dot + plain words: safe, tight, likely missed, cancelled. */
export function RiskLabel({
    kind,
    detail,
}: {
    kind: RiskKind;
    detail?: string;
}) {
    const theme = useAppTheme();
    const t = useTranslations("Journey");
    const colors = theme.delay[riskColorLevel(kind)];
    return (
        <View style={styles.risk}>
            <View style={[styles.dot, { backgroundColor: colors.fill }]} />
            <Text style={[styles.riskText, { color: theme.colors.ink2 }]}>
                <Text style={[styles.riskWord, { color: colors.text }]}>
                    {t(`risk_${kind}`)}
                </Text>
                {detail ? ` · ${detail}` : ""}
            </Text>
        </View>
    );
}

/** One journey: times, duration and trains; tap for its legs. */
export function ItineraryCard({
    itinerary,
    fromId,
    toId,
    expanded,
    onToggle,
}: {
    itinerary: Itinerary;
    /** The stations asked for, to tell when a train uses another one */
    fromId?: string;
    toId?: string;
    expanded: boolean;
    onToggle: () => void;
}) {
    const theme = useAppTheme();
    const t = useTranslations("Journey");
    const trains = rides(itinerary);
    const first = trains[0];
    const delay = first ? rideDelay(first) : null;
    const risk = worstRisk(itinerary.transfers);
    const duration = durationParts(itinerary.durationMinutes);
    const canceled = trains.some((leg) => leg.canceled);
    const chain = legChain(itinerary);
    const byCity = chain.some((leg) => leg.type === "city");
    const elsewhere = [
        boardingElsewhere(itinerary, fromId),
        alightingElsewhere(itinerary, toId),
    ];
    const elsewhereText = [
        elsewhere[0] && t("from_station", { station: elsewhere[0] }),
        elsewhere[1] && t("to_station", { station: elsewhere[1] }),
    ]
        .filter(Boolean)
        .join(" · ");

    return (
        <View
            style={[
                styles.card,
                {
                    backgroundColor: theme.colors.surface,
                    borderRadius: Platform.OS === "ios" ? theme.radii.lg : 20,
                },
            ]}
        >
            <Pressable
                onPress={onToggle}
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                android_ripple={{ color: theme.colors.line }}
                style={styles.summary}
            >
                <View style={styles.summaryTop}>
                    <Text
                        style={[
                            styles.times,
                            theme.tabularNums,
                            {
                                color: theme.colors.ink,
                                textDecorationLine: canceled
                                    ? "line-through"
                                    : "none",
                            },
                        ]}
                    >
                        {`${formatClock(itinerary.scheduledDeparture)} – ${formatClock(itinerary.scheduledArrival)}`}
                    </Text>
                    {delay !== null ? <DelayChip delay={delay} small /> : null}
                    <View style={styles.flex} />
                    <Text
                        style={[
                            styles.duration,
                            theme.tabularNums,
                            { color: theme.colors.ink2 },
                        ]}
                    >
                        {t("duration", duration)}
                    </Text>
                </View>
                <View style={styles.chain}>
                    {chain.map((leg, index) => (
                        <View
                            key={`${leg.type}@${leg.scheduledDeparture}@${leg.type === "city" ? leg.line : leg.tripId}`}
                            style={styles.link}
                        >
                            {index > 0 ? (
                                <Icon
                                    name="chevron"
                                    size={12}
                                    color={theme.colors.ink2}
                                />
                            ) : null}
                            {leg.type === "city" ? (
                                <CityChip leg={leg} />
                            ) : (
                                <>
                                    <RouteIcon
                                        routeShortName={leg.routeShortName}
                                        color={theme.colors.ink}
                                        size={18}
                                    />
                                    <Text
                                        style={[
                                            styles.number,
                                            { color: theme.colors.ink },
                                        ]}
                                    >
                                        {leg.trainNumber}
                                    </Text>
                                </>
                            )}
                        </View>
                    ))}
                    <Text style={[styles.meta, { color: theme.colors.ink2 }]}>
                        {itinerary.transferCount === 0
                            ? t("direct")
                            : t("transfers", {
                                  count: itinerary.transferCount,
                              })}
                    </Text>
                </View>
                {elsewhereText ? (
                    // The train leaves from (arrives at) another station
                    // than the one picked: say which
                    <View style={styles.elsewhere}>
                        <Icon
                            name="location"
                            size={14}
                            color={theme.colors.ink}
                        />
                        <Text
                            style={[
                                styles.elsewhereText,
                                { color: theme.colors.ink },
                            ]}
                            numberOfLines={1}
                        >
                            {elsewhereText}
                        </Text>
                    </View>
                ) : null}
                {risk && risk !== "safe" ? <RiskLabel kind={risk} /> : null}
            </Pressable>
            {expanded ? (
                <View
                    style={[
                        styles.details,
                        { borderTopColor: theme.colors.line },
                    ]}
                >
                    {steps(itinerary).map((step) =>
                        step.kind === "ride" ? (
                            <RideStep key={step.key} leg={step.leg} />
                        ) : step.kind === "walk" ? (
                            <WalkStep key={step.key} leg={step.leg} />
                        ) : step.kind === "city" ? (
                            <CityStep key={step.key} leg={step.leg} />
                        ) : (
                            <TransferStep
                                key={step.key}
                                transfer={step.transfer}
                            />
                        ),
                    )}
                    <Pressable
                        onPress={() =>
                            WebBrowser.openBrowserAsync(itinerary.ticketUrl)
                        }
                        accessibilityRole="link"
                        android_ripple={{ color: theme.colors.line }}
                        style={[
                            styles.ticket,
                            { backgroundColor: theme.colors.surface2 },
                        ]}
                    >
                        <Text
                            style={[
                                styles.ticketText,
                                { color: theme.colors.ink },
                            ]}
                        >
                            {t("ticket")}
                        </Text>
                        <Icon
                            name="external"
                            size={16}
                            color={theme.colors.ink}
                        />
                    </Pressable>
                    {/* The MÁV ticket covers the trains only */}
                    {byCity ? (
                        <Text
                            style={[
                                styles.riskText,
                                { color: theme.colors.ink2 },
                            ]}
                        >
                            {t("city_ticket")}
                        </Text>
                    ) : null}
                </View>
            ) : null}
        </View>
    );
}

function RideStep({ leg }: { leg: TransitLeg }) {
    const theme = useAppTheme();
    const t = useTranslations("Journey");
    const delay = rideDelay(leg);
    const { name } = trainTitle(leg.tripShortName, null);
    const strike = leg.canceled ? ("line-through" as const) : ("none" as const);

    const stopRow = (
        time: number,
        station: string,
        platform: string | null | undefined,
        chip: boolean,
    ) => (
        <View style={styles.stopRow}>
            <View style={styles.timeCell}>
                <Text
                    style={[
                        styles.stopTime,
                        theme.tabularNums,
                        { color: theme.colors.ink, textDecorationLine: strike },
                    ]}
                >
                    {formatClock(time)}
                </Text>
                {chip && delay !== null ? (
                    <DelayChip delay={delay} small />
                ) : null}
            </View>
            <Text
                style={[
                    styles.station,
                    styles.flex,
                    { color: theme.colors.ink },
                ]}
                numberOfLines={2}
            >
                {station}
            </Text>
            {platform ? <PlatformBadge platform={platform} size={28} /> : null}
        </View>
    );

    return (
        <View style={styles.ride}>
            {stopRow(
                leg.scheduledDeparture,
                leg.fromStop.name,
                leg.fromStop.platform,
                true,
            )}
            <View
                style={[styles.train, { borderLeftColor: theme.colors.line }]}
            >
                <RouteIcon
                    routeShortName={leg.routeShortName}
                    color={theme.colors.ink2}
                    size={18}
                />
                <Text
                    style={[styles.trainText, { color: theme.colors.ink2 }]}
                    numberOfLines={1}
                >
                    <Text style={styles.bold}>{leg.trainNumber}</Text>
                    {name ? ` ${name}` : ""}
                    {leg.headsign ? ` → ${leg.headsign}` : ""}
                    {leg.canceled ? (
                        <Text style={{ color: theme.delay.severe.text }}>
                            {` · ${t("canceled")}`}
                        </Text>
                    ) : null}
                </Text>
            </View>
            {stopRow(
                leg.scheduledArrival,
                leg.toStop.name,
                leg.toStop.platform,
                false,
            )}
        </View>
    );
}

/** A metro, tram or bus ride: where it leaves and stops, and its line. */
function CityStep({ leg }: { leg: CityLeg }) {
    const theme = useAppTheme();
    const stopRow = (time: number, station: string) => (
        <View style={styles.stopRow}>
            <View style={styles.timeCell}>
                <Text
                    style={[
                        styles.cityTime,
                        theme.tabularNums,
                        { color: theme.colors.ink2 },
                    ]}
                >
                    {formatClock(time)}
                </Text>
            </View>
            <Text
                style={[
                    styles.cityStop,
                    styles.flex,
                    { color: theme.colors.ink2 },
                ]}
                numberOfLines={1}
            >
                {station}
            </Text>
        </View>
    );
    return (
        <View style={styles.ride}>
            {stopRow(leg.scheduledDeparture, leg.fromStop.name)}
            <View
                style={[
                    styles.train,
                    {
                        borderLeftColor: theme.colors.line,
                        borderStyle: "dotted",
                    },
                ]}
            >
                <CityChip leg={leg} />
                {leg.headsign ? (
                    <Text
                        style={[styles.trainText, { color: theme.colors.ink2 }]}
                        numberOfLines={1}
                    >
                        {`→ ${leg.headsign}`}
                    </Text>
                ) : null}
            </View>
            {stopRow(leg.scheduledArrival, leg.toStop.name)}
        </View>
    );
}

function TransferStep({ transfer }: { transfer: Transfer }) {
    const theme = useAppTheme();
    const t = useTranslations("Journey");
    const kind = transferRisk(transfer);
    // Fewer minutes left than planned once delays are known
    const minutes = Math.min(
        transfer.transferMinutes,
        transfer.expectedTransferMinutes,
    );
    const detail = t("transfer_time", { minutes: Math.max(0, minutes) });
    return (
        <View
            style={[
                styles.between,
                { backgroundColor: withAlpha(theme.colors.ink2, 0.06) },
            ]}
        >
            {kind ? (
                <RiskLabel kind={kind} detail={detail} />
            ) : (
                <Text style={[styles.riskText, { color: theme.colors.ink2 }]}>
                    {detail}
                </Text>
            )}
        </View>
    );
}

function WalkStep({ leg }: { leg: WalkLeg }) {
    const theme = useAppTheme();
    const t = useTranslations("Journey");
    const minutes = Math.max(
        1,
        Math.round((leg.arrivalTime - leg.departureTime) / 60),
    );
    return (
        <View style={styles.walk}>
            <Icon name="walk" size={16} color={theme.colors.ink2} />
            <Text style={[styles.riskText, { color: theme.colors.ink2 }]}>
                {t("walk", { minutes })}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    card: { overflow: "hidden" },
    summary: { padding: 16, gap: 8 },
    summaryTop: { flexDirection: "row", alignItems: "center", gap: 8 },
    times: { fontSize: 20, fontWeight: "700" },
    duration: { fontSize: 15, fontWeight: "600" },
    flex: { flex: 1 },
    chain: {
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        columnGap: 4,
        rowGap: 4,
    },
    link: { flexDirection: "row", alignItems: "center", gap: 4 },
    number: { fontSize: 14, fontWeight: "700" },
    meta: { fontSize: 14, marginLeft: 6 },
    risk: { flexDirection: "row", alignItems: "center", gap: 8 },
    elsewhere: { flexDirection: "row", alignItems: "center", gap: 4 },
    elsewhereText: { fontSize: 13, fontWeight: "600", flexShrink: 1 },
    cityTime: { fontSize: 14, fontWeight: "600" },
    cityStop: { fontSize: 14 },
    dot: { width: 10, height: 10, borderRadius: 5 },
    riskText: { fontSize: 14, flexShrink: 1 },
    riskWord: { fontWeight: "700" },
    details: {
        borderTopWidth: StyleSheet.hairlineWidth,
        padding: 16,
        gap: 10,
    },
    ride: { gap: 6 },
    stopRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    timeCell: { width: 58, gap: 2 },
    stopTime: { fontSize: 16, fontWeight: "700" },
    station: { fontSize: 15, fontWeight: "600" },
    train: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        marginLeft: 22,
        paddingLeft: 46,
        borderLeftWidth: 2,
        minHeight: 28,
    },
    trainText: { fontSize: 13, flexShrink: 1 },
    bold: { fontWeight: "700" },
    between: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
    walk: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 12,
    },
    ticket: {
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        minHeight: 40,
        paddingHorizontal: 16,
        borderRadius: 20,
        overflow: "hidden",
        marginTop: 4,
    },
    ticketText: { fontSize: 15, fontWeight: "600" },
});

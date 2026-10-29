import type { Disruption } from "@megisholavonat/api-client";
import {
    affectsStation,
    affectsTrain,
    disruptionLines,
} from "@megisholavonat/core/disruptions";
import * as WebBrowser from "expo-web-browser";
import { useMemo, useState } from "react";
import {
    LayoutAnimation,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { useLocale, useTranslations } from "use-intl";
import { withAlpha } from "../theme/palette";
import { type AppTheme, useAppTheme } from "../theme/ThemeProvider";
import { RouteIcon } from "../train/RouteIcon";
import { Icon } from "../ui/Icon";
import { useReduceMotion } from "../ui/motion";
import { fullTexts, validityFormat } from "./disruptions";
import { useDisruptions } from "./useDisruptions";

const BUDAPEST = "Europe/Budapest";

/** Red only where trains do not run. */
function severityColor(theme: AppTheme, d: Disruption): string {
    if (d.severity === "high") return theme.delay.severe.text;
    if (d.severity === "medium") return theme.delay.moderate.text;
    return theme.colors.ink2;
}

/** The tint of the delay reasons, for the chip and the sheet cards. */
export function disruptionTint(theme: AppTheme): string {
    return withAlpha(theme.delay.moderate.fill, theme.dark ? 0.2 : 0.12);
}

/** "Pótlóbusz Mándok és Tornyospálca között", in the UI language. */
export function useDisruptionTitle() {
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

function useValidity() {
    const t = useTranslations("Disruptions");
    const locale = useLocale();
    return (d: Disruption) => {
        const format = new Intl.DateTimeFormat(
            locale === "hu" ? "hu-HU" : "en-GB",
            { ...validityFormat(d), timeZone: BUDAPEST },
        );
        const at = (s: number) => format.format(new Date(s * 1000));
        if (d.start != null && d.end != null) {
            try {
                return format.formatRange(
                    new Date(d.start * 1000),
                    new Date(d.end * 1000),
                );
            } catch {
                return `${at(d.start)} – ${at(d.end)}`;
            }
        }
        if (d.start != null) return t("since", { date: at(d.start) });
        return d.end != null ? t("until", { date: at(d.end) }) : null;
    };
}

/**
 * One disruption: line glyphs, title, cause and validity; tap for MÁV's
 * full text and the source link.
 */
export function DisruptionCard({
    disruption,
    mine = false,
    framed = false,
}: {
    disruption: Disruption;
    /** Touches a followed train or its station */
    mine?: boolean;
    /** Tinted card of its own (train and station sheets) */
    framed?: boolean;
}) {
    const theme = useAppTheme();
    const t = useTranslations("Disruptions");
    const title = useDisruptionTitle()(disruption);
    const validity = useValidity()(disruption);
    const reduce = useReduceMotion();
    const [open, setOpen] = useState(false);
    const { lines, more } = disruptionLines(disruption);
    const meta = [
        disruption.cause !== "other" ? t(`cause_${disruption.cause}`) : null,
        validity,
    ]
        .filter(Boolean)
        .join(" · ");
    const toggle = () => {
        if (!reduce) {
            LayoutAnimation.configureNext(
                LayoutAnimation.create(
                    220,
                    LayoutAnimation.Types.easeInEaseOut,
                    LayoutAnimation.Properties.opacity,
                ),
            );
        }
        setOpen((v) => !v);
    };
    const url = disruption.url;
    return (
        <View
            style={[
                framed
                    ? [
                          styles.framed,
                          { backgroundColor: disruptionTint(theme) },
                      ]
                    : [styles.row, { borderColor: theme.colors.line }],
            ]}
        >
            <Pressable
                onPress={toggle}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityHint={open ? undefined : t("expand")}
                android_ripple={{ color: theme.colors.line }}
                style={({ pressed }) => [
                    styles.head,
                    pressed && Platform.OS === "ios" && styles.pressed,
                ]}
            >
                <Icon
                    name="warning"
                    size={18}
                    color={severityColor(theme, disruption)}
                    style={styles.icon}
                />
                <View style={styles.flex}>
                    {lines.length > 0 || mine ? (
                        <View style={styles.lines}>
                            {lines.map((line) => (
                                <RouteIcon
                                    key={line.shortName}
                                    routeShortName={line.shortName}
                                    color={theme.colors.ink}
                                    size={18}
                                />
                            ))}
                            {more > 0 ? (
                                <Text
                                    style={[
                                        theme.type.caption,
                                        { color: theme.colors.ink2 },
                                    ]}
                                >
                                    +{more}
                                </Text>
                            ) : null}
                            {mine ? (
                                <View
                                    style={[
                                        styles.mine,
                                        {
                                            backgroundColor:
                                                theme.colors.action,
                                        },
                                    ]}
                                >
                                    <Text
                                        style={[
                                            styles.mineText,
                                            { color: theme.colors.onAction },
                                        ]}
                                    >
                                        {t("mine")}
                                    </Text>
                                </View>
                            ) : null}
                        </View>
                    ) : null}
                    <Text style={[styles.title, { color: theme.colors.ink }]}>
                        {title}
                    </Text>
                    {meta ? (
                        <Text
                            style={[
                                theme.type.caption,
                                theme.tabularNums,
                                { color: theme.colors.ink2 },
                            ]}
                        >
                            {meta}
                        </Text>
                    ) : null}
                </View>
                <Icon
                    name="collapse"
                    size={16}
                    color={theme.colors.ink2}
                    style={[styles.icon, open && styles.flipped]}
                />
            </Pressable>
            {open ? (
                <View style={styles.body}>
                    {fullTexts(disruption).map((text) => (
                        <Text
                            key={text}
                            style={[styles.text, { color: theme.colors.ink2 }]}
                            selectable
                        >
                            {text}
                        </Text>
                    ))}
                    <Pressable
                        onPress={() => WebBrowser.openBrowserAsync(url)}
                        accessibilityRole="link"
                        hitSlop={8}
                        style={({ pressed }) => [
                            styles.link,
                            pressed && Platform.OS === "ios" && styles.pressed,
                        ]}
                    >
                        <Text
                            style={[
                                styles.linkText,
                                { color: theme.colors.ink },
                            ]}
                        >
                            {url.includes("mavinform")
                                ? t("source_mavinform")
                                : t("source")}
                        </Text>
                        <Icon
                            name="external"
                            size={13}
                            color={theme.colors.ink}
                        />
                    </Pressable>
                </View>
            ) : null}
        </View>
    );
}

/**
 * "2 forgalmi zavar" above the search bar on home, only while there are
 * any; "· 1 a vonataidon" when one touches a followed train.
 */
export function DisruptionChip({
    count,
    mine,
    onPress,
}: {
    count: number;
    mine: number;
    onPress: () => void;
}) {
    const theme = useAppTheme();
    const t = useTranslations("Disruptions");
    if (count === 0) return null;
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            android_ripple={{ color: theme.colors.line }}
            style={({ pressed }) => [
                styles.chip,
                { backgroundColor: theme.colors.surface },
                pressed && Platform.OS === "ios" && styles.pressed,
            ]}
        >
            <View
                style={[
                    StyleSheet.absoluteFill,
                    styles.chipTint,
                    { backgroundColor: disruptionTint(theme) },
                ]}
            />
            <Icon name="warning" size={16} color={theme.delay.moderate.text} />
            <Text
                style={[
                    styles.chipText,
                    theme.tabularNums,
                    { color: theme.colors.ink },
                ]}
            >
                {t("chip", { count })}
            </Text>
            {mine > 0 ? (
                <Text
                    style={[
                        styles.chipMine,
                        theme.tabularNums,
                        { color: theme.colors.ink2 },
                    ]}
                >
                    · {t("chip_mine", { count: mine })}
                </Text>
            ) : null}
        </Pressable>
    );
}

function Affecting({ disruptions }: { disruptions: Disruption[] }) {
    if (disruptions.length === 0) return null;
    return (
        <View style={styles.affecting}>
            {disruptions.map((d) => (
                <DisruptionCard key={d.id} disruption={d} framed />
            ))}
        </View>
    );
}

/** In the train sheet: disruptions on the train's way. */
export function TrainDisruptions({
    tripId,
    tripShortName,
    stationIds,
}: {
    tripId: string | null | undefined;
    tripShortName: string | null | undefined;
    stationIds: (string | null | undefined)[];
}) {
    const disruptions = useDisruptions();
    const key = stationIds.join(",");
    // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by the ids
    const affecting = useMemo(
        () =>
            disruptions.filter((d) =>
                affectsTrain(d, { tripId, tripShortName, stationIds }),
            ),
        [disruptions, tripId, tripShortName, key],
    );
    return <Affecting disruptions={affecting} />;
}

/** In the station board: disruptions naming the station. */
export function StationDisruptions({ stationId }: { stationId: string }) {
    const disruptions = useDisruptions();
    const affecting = useMemo(
        () => disruptions.filter((d) => affectsStation(d, stationId)),
        [disruptions, stationId],
    );
    return <Affecting disruptions={affecting} />;
}

const styles = StyleSheet.create({
    row: { borderBottomWidth: StyleSheet.hairlineWidth },
    framed: { borderRadius: 12, overflow: "hidden" },
    head: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
        paddingVertical: 12,
        paddingHorizontal: 12,
    },
    icon: { marginTop: 2 },
    flipped: { transform: [{ rotate: "180deg" }] },
    flex: { flex: 1, gap: 3 },
    lines: {
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 6,
    },
    title: { fontSize: 15, lineHeight: 20, fontWeight: "600" },
    mine: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
    mineText: { fontSize: 11, lineHeight: 14, fontWeight: "600" },
    body: { gap: 8, paddingLeft: 40, paddingRight: 12, paddingBottom: 12 },
    text: { fontSize: 14, lineHeight: 20 },
    link: { flexDirection: "row", alignItems: "center", gap: 3, minHeight: 32 },
    linkText: { fontSize: 14, fontWeight: "600" },
    pressed: { opacity: 0.6 },
    chip: {
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 36,
        paddingLeft: 12,
        paddingRight: 14,
        borderRadius: 18,
        shadowColor: "#000",
        shadowOpacity: 0.12,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2,
    },
    chipTint: { borderRadius: 18 },
    chipText: { fontSize: 14, fontWeight: "600" },
    chipMine: { fontSize: 14 },
    affecting: { gap: 8 },
});

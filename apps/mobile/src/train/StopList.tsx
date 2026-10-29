import { formatSecondsAsTime } from "@megisholavonat/core/time";
import { StyleSheet, Text, View, type ViewStyle } from "react-native";
import { useTranslations } from "use-intl";
import { type AppTheme, useAppTheme } from "../theme/ThemeProvider";
import { delayTextColor, PlatformBadge } from "../ui/ds";
import { Icon } from "../ui/Icon";
import type { StopRow } from "./trainData";

function Dot({ row, theme }: { row: StopRow; theme: AppTheme }) {
    let style: ViewStyle;
    if (row.state === "passed") {
        style = { width: 9, height: 9, backgroundColor: theme.stale.fill };
    } else if (row.isLast) {
        style = { width: 11, height: 11, backgroundColor: theme.colors.ink };
    } else {
        style = {
            width: 11,
            height: 11,
            borderWidth: 2,
            borderColor:
                row.state === "next" ? theme.colors.ink : theme.stale.fill,
        };
    }
    return <View style={[styles.dot, style]} />;
}

/** "▶ Abony · 112 km/h": where the train is between two stops. */
function NowLine({ label }: { label: string }) {
    const theme = useAppTheme();
    return (
        <View style={styles.now}>
            <Icon name="position" size={12} color={theme.colors.ink} />
            <Text
                style={[
                    styles.nowText,
                    theme.tabularNums,
                    { color: theme.colors.ink },
                ]}
                numberOfLines={1}
            >
                {label}
            </Text>
        </View>
    );
}

/** The stop list of the train sheet, with the current position between stops. */
export function StopList({
    rows,
    nowLabel,
    nextPlatformPrediction,
    stale,
}: {
    rows: StopRow[];
    nowLabel: string | null;
    /** Predicted platform of the next stop ("4?"), when not announced */
    nextPlatformPrediction: string | null;
    stale: boolean;
}) {
    const theme = useAppTheme();
    const t = useTranslations("Train");
    return (
        <View>
            {rows.map((row) => {
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
                return (
                    <View key={row.key}>
                        {next && nowLabel ? <NowLine label={nowLabel} /> : null}
                        <View
                            style={styles.row}
                            accessible
                            accessibilityLabel={[
                                row.name,
                                passed ? t("passed") : null,
                                row.approximate
                                    ? t("expected", { time })
                                    : time,
                                row.platform ?? predicted,
                            ]
                                .filter(Boolean)
                                .join(", ")}
                        >
                            <View style={styles.dotCell}>
                                <Dot row={row} theme={theme} />
                            </View>
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
                        </View>
                    </View>
                );
            })}
        </View>
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
    name: { flex: 1 },
    time: { width: 60, textAlign: "right", fontSize: 16 },
    platformCell: { width: 34, alignItems: "flex-end" },
    now: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        height: 28,
        paddingLeft: 3,
    },
    nowText: { fontSize: 13, fontWeight: "700", flexShrink: 1 },
});

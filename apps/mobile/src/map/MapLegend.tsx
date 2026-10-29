import { type DelayLevel, LEVEL_FROM_MIN } from "@megisholavonat/core/delay";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { withAlpha } from "../theme/palette";
import { useAppTheme } from "../theme/ThemeProvider";

// The map's delay key, as on the web: a slim pill with each colour and the
// minute it starts from; a tap opens the full list, the grey markers
// included ("+12? régi adat" explains the "?" of old data).

const LEVELS: DelayLevel[] = ["onTime", "slight", "moderate", "severe"];

/** A stale marker's label: its last known delay with a "?" */
const STALE_SAMPLE = "+12?";

type Item = DelayLevel | "stale" | "inactive";

function Swatch({ item }: { item: Item }) {
    const theme = useAppTheme();
    if (item === "stale") {
        return (
            <View
                style={[
                    styles.stalePill,
                    {
                        borderColor: theme.stale.outline.color,
                        backgroundColor: theme.stale.background,
                    },
                ]}
            >
                <Text
                    style={[
                        styles.staleText,
                        theme.tabularNums,
                        { color: theme.stale.text },
                    ]}
                    allowFontScaling={false}
                >
                    {STALE_SAMPLE}
                </Text>
            </View>
        );
    }
    const fill =
        item === "inactive" ? theme.stale.fill : theme.delay[item].fill;
    return <View style={[styles.dot, { backgroundColor: fill }]} />;
}

export function MapLegend() {
    const theme = useAppTheme();
    const t = useTranslations("Legend");
    const [open, setOpen] = useState(false);
    const name = (item: Item) =>
        item === "onTime"
            ? t("on_time")
            : item === "stale"
              ? t("stale")
              : item === "inactive"
                ? t("inactive")
                : t("from", { minutes: LEVEL_FROM_MIN[item] });
    const items: Item[] = [...LEVELS, "stale", "inactive"];
    const card = {
        backgroundColor: withAlpha(theme.colors.surface, 0.94),
        borderColor: theme.colors.line,
    };
    return (
        <View style={styles.root} pointerEvents="box-none">
            {open ? (
                <View
                    style={[styles.list, card]}
                    accessibilityRole="summary"
                    accessibilityLabel={`${t("title")}: ${items
                        .map((i) =>
                            i === "stale"
                                ? `${STALE_SAMPLE} ${t("stale")}`
                                : name(i),
                        )
                        .join(", ")}`}
                >
                    <Text style={[styles.title, { color: theme.colors.ink2 }]}>
                        {t("title")}
                    </Text>
                    {items.map((item) => (
                        <View key={item} style={styles.row}>
                            <View style={styles.swatchBox}>
                                <Swatch item={item} />
                            </View>
                            <Text
                                style={[
                                    styles.rowText,
                                    { color: theme.colors.ink },
                                ]}
                            >
                                {name(item)}
                            </Text>
                        </View>
                    ))}
                </View>
            ) : null}
            <Pressable
                onPress={() => setOpen(!open)}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={t("label")}
                hitSlop={8}
                style={[styles.pill, card]}
            >
                <Text style={[styles.pillTitle, { color: theme.colors.ink2 }]}>
                    {t("title")}
                </Text>
                {LEVELS.map((level) => (
                    <View key={level} style={styles.step}>
                        <Swatch item={level} />
                        <Text
                            style={[
                                styles.stepText,
                                theme.tabularNums,
                                { color: theme.colors.ink },
                            ]}
                        >
                            {`${LEVEL_FROM_MIN[level]}${level === "severe" ? "+" : ""}`}
                        </Text>
                    </View>
                ))}
                <Text style={[styles.pillTitle, { color: theme.colors.ink2 }]}>
                    {t("minutes")}
                </Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { alignSelf: "flex-start", gap: 8 },
    pill: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        height: 32,
        paddingHorizontal: 12,
        borderRadius: 16,
        borderWidth: StyleSheet.hairlineWidth,
    },
    pillTitle: { fontSize: 12, fontWeight: "600" },
    step: { flexDirection: "row", alignItems: "center", gap: 4 },
    stepText: { fontSize: 12, fontWeight: "600" },
    dot: { width: 10, height: 10, borderRadius: 5 },
    stalePill: {
        height: 16,
        paddingHorizontal: 4,
        borderRadius: 8,
        borderWidth: 1.5,
        borderStyle: "dashed",
        justifyContent: "center",
    },
    staleText: { fontSize: 10, fontWeight: "800" },
    list: {
        gap: 8,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderRadius: 14,
        borderWidth: StyleSheet.hairlineWidth,
    },
    title: { fontSize: 12 },
    row: { flexDirection: "row", alignItems: "center", gap: 10 },
    swatchBox: { width: 34, alignItems: "center" },
    rowText: { fontSize: 14, fontWeight: "600" },
});

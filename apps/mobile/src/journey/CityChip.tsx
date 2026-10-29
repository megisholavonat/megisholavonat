import type { CityLeg } from "@megisholavonat/api-client";
import {
    type CityMode,
    cityLineColors,
    cityMode,
} from "@megisholavonat/core/planner";
import { StyleSheet, Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useAppTheme } from "../theme/ThemeProvider";
import { Icon, type IconName } from "../ui/Icon";

const ICONS: Record<Exclude<CityMode, "metro">, IconName> = {
    tram: "train-front",
    trolleybus: "bus",
    bus: "bus",
    rail: "train-front",
};

/**
 * A metro, tram or bus line as a badge in its own colours ("M2", "8E",
 * "4-6"). Metro lines carry their M; other lines a small vehicle icon.
 */
export function CityChip({ leg }: { leg: CityLeg }) {
    const theme = useAppTheme();
    const t = useTranslations("Journey");
    const mode = cityMode(leg);
    const colors = cityLineColors(leg) ?? {
        background: theme.colors.surface2,
        text: theme.colors.ink,
    };
    return (
        <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={`${t(`city_${mode}`)} ${leg.line}`}
            style={[
                styles.chip,
                {
                    backgroundColor: colors.background,
                    borderRadius: mode === "metro" ? 5 : 3,
                },
            ]}
        >
            {mode === "metro" ? null : (
                <Icon name={ICONS[mode]} size={12} color={colors.text} />
            )}
            <Text style={[styles.line, { color: colors.text }]}>
                {leg.line}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    chip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        height: 20,
        paddingHorizontal: 6,
    },
    line: { fontSize: 13, fontWeight: "700" },
});

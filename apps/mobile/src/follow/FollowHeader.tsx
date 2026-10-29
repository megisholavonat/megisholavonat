import { StyleSheet, Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useAppTheme } from "../theme/ThemeProvider";
import { RouteIcon } from "../train/RouteIcon";
import type { FollowForm } from "./useFollowForm";

/** "2423 → Vác" with the route glyph, and "usually late" before departure. */
export function FollowHeader({ form }: { form: FollowForm }) {
    const theme = useAppTheme();
    const t = useTranslations("Train");
    const { title } = form;
    return (
        <View style={styles.row}>
            <RouteIcon
                routeShortName={form.train?.routeShortName}
                color={theme.colors.ink}
                size={26}
            />
            <View style={styles.flex}>
                <Text
                    style={[theme.type.headline, { color: theme.colors.ink }]}
                    numberOfLines={1}
                    accessibilityRole="header"
                >
                    {title
                        ? `${title.number}${title.destination ? ` → ${title.destination}` : ""}`
                        : ""}
                </Text>
                {form.usuallyLate ? (
                    <Text style={[styles.note, { color: theme.colors.ink2 }]}>
                        {t("usually_late")}
                    </Text>
                ) : null}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 4,
    },
    flex: { flex: 1 },
    note: { fontSize: 14 },
});

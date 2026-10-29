import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useAppTheme } from "../theme/ThemeProvider";
import { Icon } from "../ui/Icon";
import type { TrainActionsProps } from "./TrainActions.types";

/**
 * Android (and the default): a Material 3 connected button group of tonal
 * buttons, 52 dp tall, round outer and tight inner corners. iOS uses
 * TrainActions.ios.tsx (SwiftUI). The follow action joins with the commute
 * feature.
 */
export function TrainActions({ onShare, onTicket }: TrainActionsProps) {
    const theme = useAppTheme();
    const t = useTranslations("Train");
    const tonal = {
        backgroundColor: theme.colors.surface2,
    };
    const ripple = { color: theme.colors.line };
    return (
        <View style={styles.group}>
            <Pressable
                onPress={onShare}
                accessibilityRole="button"
                accessibilityLabel={t("share")}
                android_ripple={ripple}
                style={[styles.button, styles.first, styles.icon, tonal]}
            >
                <Icon name="share" size={20} color={theme.colors.ink} />
            </Pressable>
            <Pressable
                onPress={onTicket}
                accessibilityRole="link"
                android_ripple={ripple}
                style={[styles.button, styles.last, tonal]}
            >
                <Text style={[styles.label, { color: theme.colors.ink }]}>
                    {t("ticket")}
                </Text>
                <Icon name="external" size={18} color={theme.colors.ink} />
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    group: { flexDirection: "row", gap: 2, alignSelf: "flex-start" },
    button: {
        height: 52,
        paddingHorizontal: 20,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        borderRadius: 8,
        overflow: "hidden",
    },
    icon: { width: 64, paddingHorizontal: 0 },
    first: { borderTopLeftRadius: 26, borderBottomLeftRadius: 26 },
    last: { borderTopRightRadius: 26, borderBottomRightRadius: 26 },
    label: { fontSize: 15, fontWeight: "600" },
});

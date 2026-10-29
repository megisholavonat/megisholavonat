import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useAppTheme } from "../theme/ThemeProvider";
import { Icon } from "../ui/Icon";
import type { TrainActionsProps } from "./TrainActions.types";

/**
 * Android (and the default): a Material 3 connected button group, 52 dp
 * tall, round outer and tight inner corners. Follow comes first and fills
 * the row: filled until the train is followed, tonal after. iOS uses
 * TrainActions.ios.tsx (SwiftUI).
 */
export function TrainActions({
    following,
    onFollow,
    onShare,
    onTicket,
}: TrainActionsProps) {
    const theme = useAppTheme();
    const t = useTranslations("Train");
    const tf = useTranslations("Follow");
    const tonal = {
        backgroundColor: theme.colors.surface2,
    };
    const filled = { backgroundColor: theme.colors.action };
    const followColor = following ? theme.colors.ink : theme.colors.onAction;
    const ripple = { color: theme.colors.line };
    return (
        <View style={styles.group}>
            <Pressable
                onPress={onFollow}
                accessibilityRole="button"
                accessibilityState={{ selected: following }}
                android_ripple={ripple}
                style={[
                    styles.button,
                    styles.first,
                    styles.grow,
                    following ? tonal : filled,
                ]}
            >
                <Icon
                    name={following ? "followed" : "follow"}
                    size={20}
                    color={followColor}
                />
                <Text style={[styles.label, { color: followColor }]}>
                    {tf(following ? "following" : "follow")}
                </Text>
            </Pressable>
            <Pressable
                onPress={onShare}
                accessibilityRole="button"
                accessibilityLabel={t("share")}
                android_ripple={ripple}
                style={[styles.button, styles.icon, tonal]}
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
    group: { flexDirection: "row", gap: 2 },
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
    grow: { flex: 1 },
    icon: { width: 56, paddingHorizontal: 0 },
    first: { borderTopLeftRadius: 26, borderBottomLeftRadius: 26 },
    last: { borderTopRightRadius: 26, borderBottomRightRadius: 26 },
    label: { fontSize: 15, fontWeight: "600" },
});

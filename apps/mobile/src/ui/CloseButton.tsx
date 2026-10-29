import { Pressable, StyleSheet } from "react-native";
import { useTranslations } from "use-intl";
import { withAlpha } from "../theme/palette";
import { useAppTheme } from "../theme/ThemeProvider";
import { Icon, type IconName } from "./Icon";

/** The round grey close (×) button of sheets, 36 pt with a 44 pt hit area. */
export function CloseButton({
    onPress,
    icon = "close",
    label,
}: {
    onPress: () => void;
    icon?: IconName;
    label?: string;
}) {
    const theme = useAppTheme();
    const t = useTranslations("Common");
    return (
        <Pressable
            onPress={onPress}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={label ?? t("close")}
            android_ripple={{ color: theme.colors.line, borderless: true }}
            style={({ pressed }) => [
                styles.button,
                {
                    backgroundColor: withAlpha(theme.colors.ink2, 0.16),
                    opacity: pressed ? 0.7 : 1,
                },
            ]}
        >
            <Icon name={icon} size={16} color={theme.colors.ink2} />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    button: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: "center",
        justifyContent: "center",
    },
});

import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import { withAlpha } from "../theme/palette";
import { useAppTheme } from "../theme/ThemeProvider";
import { Icon } from "../ui/Icon";
import type { MapChromeProps } from "./MapChrome.types";

// Android (and the default): Material 3 map controls. A filled tonal icon
// button for settings, a FAB for the location, a compact ⓘ attribution
// button and a 56 dp search bar. iOS uses MapChrome.ios.tsx.

export function MapChrome({
    onSearch,
    onSettings,
    onLocate,
    following,
    onAttribution,
    children,
}: MapChromeProps) {
    const theme = useAppTheme();
    const t = useTranslations("Home");
    const insets = useSafeAreaInsets();
    const ripple = { color: withAlpha(theme.colors.ink, 0.12) };

    return (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            <Pressable
                onPress={onSettings}
                accessibilityRole="button"
                accessibilityLabel={t("settings")}
                android_ripple={ripple}
                style={[
                    styles.tonal,
                    {
                        top: insets.top + 8,
                        backgroundColor: theme.colors.surface2,
                    },
                ]}
            >
                <Icon name="settings" size={24} color={theme.colors.ink} />
            </Pressable>

            <View
                style={[styles.bottom, { paddingBottom: insets.bottom + 12 }]}
                pointerEvents="box-none"
            >
                <View style={styles.row} pointerEvents="box-none">
                    <Pressable
                        onPress={onAttribution}
                        accessibilityRole="button"
                        accessibilityLabel={t("map_data")}
                        android_ripple={{ ...ripple, borderless: true }}
                        hitSlop={6}
                        style={[
                            styles.info,
                            {
                                backgroundColor: withAlpha(
                                    theme.colors.canvas,
                                    0.85,
                                ),
                            },
                        ]}
                    >
                        <Icon name="info" size={18} color={theme.colors.ink2} />
                    </Pressable>
                    <Pressable
                        onPress={onLocate}
                        accessibilityRole="button"
                        accessibilityLabel={t("my_location")}
                        accessibilityState={{ selected: following }}
                        android_ripple={ripple}
                        style={[
                            styles.fab,
                            { backgroundColor: theme.colors.surface2 },
                        ]}
                    >
                        <Icon
                            name={following ? "locationOn" : "location"}
                            size={24}
                            color={theme.colors.ink}
                        />
                    </Pressable>
                </View>
                {children}
                <Pressable
                    onPress={onSearch}
                    accessibilityRole="search"
                    accessibilityLabel={t("search_placeholder")}
                    android_ripple={ripple}
                    style={[
                        styles.search,
                        { backgroundColor: theme.colors.surface },
                    ]}
                >
                    <Icon name="search" size={24} color={theme.colors.ink2} />
                    <Text
                        style={[theme.type.body, { color: theme.colors.ink2 }]}
                        numberOfLines={1}
                    >
                        {t("search_placeholder")}
                    </Text>
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    tonal: {
        position: "absolute",
        right: 16,
        width: 48,
        height: 48,
        borderRadius: 16,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        elevation: 2,
    },
    bottom: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: 16,
        gap: 12,
    },
    row: {
        flexDirection: "row",
        alignItems: "flex-end",
        justifyContent: "space-between",
    },
    info: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: "center",
        justifyContent: "center",
    },
    fab: {
        width: 56,
        height: 56,
        borderRadius: 16,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        elevation: 3,
    },
    search: {
        minHeight: 56,
        borderRadius: 28,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        overflow: "hidden",
        elevation: 3,
    },
});

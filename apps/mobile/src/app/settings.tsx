import { Stack, useRouter } from "expo-router";
import { Platform, Pressable, Text } from "react-native";
import { useTranslations } from "use-intl";
import { SettingsScreen } from "../settings/SettingsScreen";
import { useAppTheme } from "../theme/ThemeProvider";

/** Screen 5: settings. A modal sheet with "Kész" on iOS, a pushed page on Android. */
export default function SettingsRoute() {
    const router = useRouter();
    const theme = useAppTheme();
    const t = useTranslations("Common");
    return (
        <>
            {Platform.OS === "ios" ? (
                <Stack.Screen
                    options={{
                        headerRight: () => (
                            <Pressable
                                onPress={() => router.back()}
                                accessibilityRole="button"
                                hitSlop={8}
                            >
                                <Text
                                    style={[
                                        theme.type.headline,
                                        { color: theme.colors.ink },
                                    ]}
                                >
                                    {t("done")}
                                </Text>
                            </Pressable>
                        ),
                    }}
                />
            ) : null}
            <SettingsScreen />
        </>
    );
}

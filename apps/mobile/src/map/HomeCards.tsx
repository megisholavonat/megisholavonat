import * as WebBrowser from "expo-web-browser";
import type { ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useFormatter, useLocale, useTranslations } from "use-intl";
import { WEB_URL } from "../config";
import { useAppTheme } from "../theme/ThemeProvider";
import { StateBlock } from "../ui/ds";
import { Icon } from "../ui/Icon";
import type { FeedState } from "./feedState";

/** Solid card floating over the map (content layer: no glass). */
function Card({ children, label }: { children: ReactNode; label?: string }) {
    const theme = useAppTheme();
    return (
        <View
            style={[
                styles.card,
                {
                    backgroundColor: theme.colors.surface,
                    borderRadius: Platform.OS === "ios" ? 22 : 24,
                },
            ]}
            accessibilityRole={label ? "summary" : undefined}
            accessibilityLabel={label}
        >
            {children}
        </View>
    );
}

/** No data, source down or offline, above the search bar. */
export function FeedStateCard({
    state,
    onRetry,
}: {
    state: FeedState;
    onRetry: () => void;
}) {
    const t = useTranslations("Home");
    const tc = useTranslations("Common");
    const format = useFormatter();
    switch (state.kind) {
        case "offline":
            return (
                <Card>
                    <StateBlock
                        icon="offline"
                        tone="warning"
                        title={t("offline")}
                        action={{ label: tc("retry"), onPress: onRetry }}
                    />
                </Card>
            );
        case "sourceDown":
            return (
                <Card>
                    <StateBlock
                        icon="warning"
                        tone="warning"
                        title={t("source_down")}
                        subtitle={
                            state.sinceMs === null
                                ? undefined
                                : t("source_down_since", {
                                      time: format.dateTime(
                                          new Date(state.sinceMs),
                                          {
                                              hour: "2-digit",
                                              minute: "2-digit",
                                          },
                                      ),
                                  })
                        }
                        action={{ label: tc("retry"), onPress: onRetry }}
                    />
                </Card>
            );
        case "empty":
            return (
                <Card>
                    <StateBlock icon="noTrains" title={t("no_trains")} />
                </Card>
            );
        default:
            return null;
    }
}

/** "7 perce nincs friss adat" pill at the top of the map. */
export function StaleBanner({ minutes }: { minutes: number }) {
    const theme = useAppTheme();
    const t = useTranslations("Home");
    return (
        <View
            style={[styles.banner, { backgroundColor: theme.colors.surface }]}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
        >
            <Icon name="stale" size={18} color={theme.colors.ink2} />
            <Text style={[styles.bannerText, { color: theme.colors.ink }]}>
                {t("stale_banner", { minutes })}
            </Text>
        </View>
    );
}

/**
 * Analytics consent, non-blocking: two equal buttons, no pre-selected
 * answer (design board 5).
 */
export function ConsentCard({
    onAnswer,
}: {
    onAnswer: (granted: boolean) => void;
}) {
    const theme = useAppTheme();
    const t = useTranslations("Consent");
    const locale = useLocale();
    const button = (label: string, granted: boolean) => (
        <Pressable
            onPress={() => onAnswer(granted)}
            accessibilityRole="button"
            android_ripple={{ color: theme.colors.line }}
            style={({ pressed }) => [
                styles.consentButton,
                {
                    borderColor: theme.colors.ink,
                    opacity: pressed && Platform.OS === "ios" ? 0.6 : 1,
                },
            ]}
        >
            <Text style={[styles.consentLabel, { color: theme.colors.ink }]}>
                {label}
            </Text>
        </Pressable>
    );
    return (
        <Card label={t("question")}>
            <View style={styles.consentHeader}>
                <Text
                    style={[
                        theme.type.headline,
                        styles.flex,
                        { color: theme.colors.ink },
                    ]}
                >
                    {t("question")}
                </Text>
                <Pressable
                    onPress={() =>
                        WebBrowser.openBrowserAsync(
                            `${WEB_URL}/${locale}/privacy`,
                        )
                    }
                    accessibilityRole="link"
                    hitSlop={8}
                >
                    <Text
                        style={[styles.details, { color: theme.colors.ink2 }]}
                    >
                        {t("details")}
                    </Text>
                </Pressable>
            </View>
            <View style={styles.consentButtons}>
                {button(t("decline"), false)}
                {button(t("accept"), true)}
            </View>
        </Card>
    );
}

const styles = StyleSheet.create({
    card: {
        padding: 16,
        gap: 12,
        shadowColor: "#000",
        shadowOpacity: 0.12,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 4 },
        elevation: 3,
    },
    banner: {
        alignSelf: "center",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 999,
        shadowColor: "#000",
        shadowOpacity: 0.12,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2,
    },
    bannerText: { fontSize: 14, fontWeight: "700" },
    flex: { flex: 1 },
    consentHeader: {
        flexDirection: "row",
        alignItems: "baseline",
        gap: 8,
    },
    details: { fontSize: 13, fontWeight: "600" },
    consentButtons: { flexDirection: "row", gap: 8 },
    consentButton: {
        flex: 1,
        height: 44,
        borderRadius: 10,
        borderWidth: 1.5,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
    },
    consentLabel: { fontSize: 15, fontWeight: "600" },
});

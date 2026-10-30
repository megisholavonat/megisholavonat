import {
    type DelayLevel,
    getDelayLevel,
    signedDelay,
} from "@megisholavonat/core/delay";
import { delayLabel } from "@megisholavonat/core/display";
import type { ReactNode } from "react";
import {
    type DimensionValue,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    View,
    type ViewStyle,
} from "react-native";
import { useTranslations } from "use-intl";
import { withAlpha } from "../theme/palette";
import { type AppTheme, useAppTheme } from "../theme/ThemeProvider";
import { Icon, type IconName } from "./Icon";

// Design-system components ("DS · Komponensek"): delay label, platform
// badge, skeleton and the state block. Colours come from the tokens only.

/** Text colour of a delay level on a surface; grey for old data or none. */
export function levelTextColor(
    theme: AppTheme,
    level: DelayLevel | "stale",
): string {
    return level === "stale" ? theme.stale.text : theme.delay[level].text;
}

/** Text colour of a delay on a surface; grey when the data is stale. */
export function delayTextColor(
    theme: AppTheme,
    delay: number,
    stale = false,
): string {
    return levelTextColor(theme, stale ? "stale" : getDelayLevel(delay));
}

/** Chip background: the level's tint token; surface-2 for old data or none. */
export function levelTint(
    theme: AppTheme,
    level: DelayLevel | "stale",
): string {
    return level === "stale" ? theme.colors.surface2 : theme.delay[level].tint;
}

/**
 * The delay chip of lists and boards, the same as the web's (core
 * `delayLabel`): always the minutes ("+2", "0", "+7"), blue up to +5; old
 * data keeps its last
 * delay with a "?" ("+23?") on a dashed grey chip; no delay is a grey "–".
 */
export function DelayChip({
    delay,
    stale = false,
    small = false,
}: {
    /** Null for an idle or cancelled train */
    delay: number | null;
    /** No fresh position: the last known delay */
    stale?: boolean;
    small?: boolean;
}) {
    const theme = useAppTheme();
    const t = useTranslations("Common");
    const shown = delayLabel(delay, stale);
    const label = shown.text ?? signedDelay(shown.minutes ?? 0);
    const style: ViewStyle = {
        backgroundColor: levelTint(theme, shown.level),
        ...(shown.stale
            ? {
                  borderWidth: 1,
                  borderStyle: "dashed",
                  borderColor: theme.stale.outline.color,
              }
            : null),
    };
    return (
        <View
            style={[styles.chip, small && styles.chipSmall, style]}
            accessible
            accessibilityLabel={
                shown.minutes != null && shown.minutes > 0
                    ? t(shown.stale ? "delay_stale_a11y" : "delay_a11y", {
                          delay: shown.minutes,
                      })
                    : label
            }
        >
            <Text
                style={[
                    styles.chipText,
                    small && styles.chipTextSmall,
                    theme.tabularNums,
                    { color: levelTextColor(theme, shown.level) },
                ]}
            >
                {label}
            </Text>
        </View>
    );
}

/**
 * Platform: announced (solid ink), predicted "6?" (dashed, confidence
 * ≥ 80 %), or a passed stop's (muted).
 */
export function PlatformBadge({
    platform,
    predicted = false,
    muted = false,
    size = 32,
}: {
    platform: string;
    predicted?: boolean;
    muted?: boolean;
    size?: number;
}) {
    const theme = useAppTheme();
    const t = useTranslations("Common");
    const box: ViewStyle = predicted
        ? {
              borderWidth: 1.5,
              borderStyle: "dashed",
              borderColor: muted ? theme.stale.fill : theme.colors.ink2,
          }
        : {
              backgroundColor: muted
                  ? theme.colors.surface2
                  : theme.colors.action,
          };
    const color = predicted
        ? muted
            ? theme.colors.ink2
            : theme.colors.ink
        : muted
          ? theme.colors.ink2
          : theme.colors.onAction;
    return (
        <View
            style={[
                styles.platform,
                {
                    minWidth: size,
                    height: size,
                    borderRadius: size > 34 ? theme.radii.md : 7,
                },
                box,
            ]}
            accessible
            accessibilityLabel={
                predicted
                    ? t("platform_predicted", { platform })
                    : t("platform", { platform })
            }
        >
            <Text
                style={[
                    styles.platformText,
                    { color, fontSize: size > 34 ? 17 : 15 },
                ]}
                allowFontScaling={false}
            >
                {predicted ? `${platform}?` : platform}
            </Text>
        </View>
    );
}

export function Skeleton({
    width,
    height = 14,
    radius = 6,
    style,
}: {
    width?: DimensionValue;
    height?: number;
    radius?: number;
    style?: ViewStyle;
}) {
    const theme = useAppTheme();
    return (
        <View
            style={[
                {
                    width,
                    height,
                    borderRadius: radius,
                    backgroundColor: withAlpha(theme.colors.ink2, 0.18),
                },
                style,
            ]}
        />
    );
}

/** Icon tile + title (+ subtitle, + action): no data, error, empty. */
export function StateBlock({
    icon,
    title,
    subtitle,
    tone = "neutral",
    action,
}: {
    icon: IconName;
    title: string;
    subtitle?: string;
    tone?: "neutral" | "warning";
    action?: { label: string; onPress: () => void };
}) {
    const theme = useAppTheme();
    const warning = tone === "warning";
    return (
        <View style={styles.state}>
            <View style={styles.stateRow}>
                <View
                    style={[
                        styles.stateTile,
                        {
                            backgroundColor: warning
                                ? theme.delay.moderate.tint
                                : theme.colors.surface2,
                        },
                    ]}
                >
                    <Icon
                        name={icon}
                        size={22}
                        color={
                            warning
                                ? theme.delay.moderate.text
                                : theme.colors.ink2
                        }
                    />
                </View>
                <View style={styles.stateText}>
                    <Text
                        style={[
                            theme.type.headline,
                            { color: theme.colors.ink },
                        ]}
                        accessibilityRole="header"
                    >
                        {title}
                    </Text>
                    {subtitle ? (
                        <Text
                            style={[
                                styles.subtitle,
                                theme.tabularNums,
                                { color: theme.colors.ink2 },
                            ]}
                        >
                            {subtitle}
                        </Text>
                    ) : null}
                </View>
            </View>
            {action ? (
                <PrimaryButton label={action.label} onPress={action.onPress} />
            ) : null}
        </View>
    );
}

/** Filled ink button (the design's only emphasis colour is ink). */
export function PrimaryButton({
    label,
    onPress,
    icon,
}: {
    label: string;
    onPress: () => void;
    icon?: IconName;
}) {
    const theme = useAppTheme();
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            android_ripple={{ color: withAlpha(theme.colors.onAction, 0.2) }}
            style={({ pressed }) => [
                styles.primary,
                {
                    backgroundColor: theme.colors.action,
                    opacity: pressed && Platform.OS === "ios" ? 0.85 : 1,
                },
            ]}
        >
            {icon ? (
                <Icon name={icon} size={18} color={theme.colors.onAction} />
            ) : null}
            <Text
                style={[styles.primaryText, { color: theme.colors.onAction }]}
            >
                {label}
            </Text>
        </Pressable>
    );
}

/** Section label above grouped rows (search results). */
export function SectionLabel({ children }: { children: ReactNode }) {
    const theme = useAppTheme();
    return (
        <Text
            style={[
                theme.type.caption,
                styles.sectionLabel,
                { color: theme.colors.ink2 },
            ]}
            accessibilityRole="header"
        >
            {children}
        </Text>
    );
}

const styles = StyleSheet.create({
    chip: {
        alignSelf: "flex-start",
        minHeight: 22,
        paddingHorizontal: 8,
        borderRadius: 999,
        justifyContent: "center",
    },
    chipSmall: { minHeight: 20, paddingHorizontal: 7 },
    chipText: { fontSize: 13, fontWeight: "700" },
    chipTextSmall: { fontSize: 12 },
    platform: {
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 6,
    },
    platformText: { fontWeight: "800", fontVariant: ["tabular-nums"] },
    state: { gap: 16 },
    stateRow: { flexDirection: "row", alignItems: "center", gap: 14 },
    stateTile: {
        width: 48,
        height: 48,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
    },
    stateText: { flex: 1, gap: 2 },
    subtitle: { fontSize: 14 },
    primary: {
        minHeight: 48,
        borderRadius: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        overflow: "hidden",
    },
    primaryText: { fontSize: 15, fontWeight: "600" },
    sectionLabel: {
        textTransform: "uppercase",
        letterSpacing: 0.6,
        paddingHorizontal: 4,
        paddingTop: 8,
        paddingBottom: 4,
    },
});

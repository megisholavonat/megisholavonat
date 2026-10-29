import type { TrainFeatureProperties } from "@megisholavonat/api-client";
import { trainDisplay } from "@megisholavonat/core/display";
import type { ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import { RouteIcon } from "../train/RouteIcon";
import { trainTitle } from "../train/trainData";
import { DelayChip } from "../ui/ds";

// Grouped rows of the search and train list screens.

export function Group({ children }: { children: ReactNode }) {
    const theme = useAppTheme();
    return (
        <View
            style={[
                styles.group,
                {
                    backgroundColor: theme.colors.surface,
                    borderRadius: Platform.OS === "ios" ? theme.radii.lg : 20,
                },
            ]}
        >
            {children}
        </View>
    );
}

export function Row({
    leading,
    children,
    trailing,
    onPress,
    first,
}: {
    leading: ReactNode;
    children: ReactNode;
    trailing?: ReactNode;
    onPress: () => void;
    first: boolean;
}) {
    const theme = useAppTheme();
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            android_ripple={{ color: theme.colors.line }}
            style={({ pressed }) => [
                styles.row,
                !first && {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: theme.colors.line,
                },
                pressed &&
                    Platform.OS === "ios" && {
                        backgroundColor: theme.colors.surface2,
                    },
            ]}
        >
            <View style={styles.leading}>{leading}</View>
            <View style={styles.flex}>{children}</View>
            {trailing}
        </Pressable>
    );
}

/**
 * A live train: route glyph, number and name, and the delay its marker
 * shows ("+23?" for old data; none while it waits or has arrived).
 */
export function TrainRow({
    train,
    first,
    now,
    onPress,
}: {
    train: TrainFeatureProperties;
    first: boolean;
    now: Date;
    onPress: () => void;
}) {
    const theme = useAppTheme();
    const title = trainTitle(train.tripShortName, null);
    const display = trainDisplay(train, now);
    return (
        <Row
            first={first}
            onPress={onPress}
            leading={
                <RouteIcon
                    routeShortName={train.routeShortName}
                    color={theme.colors.ink}
                />
            }
            trailing={
                display.delay !== null ? (
                    <DelayChip
                        delay={display.delay}
                        stale={display.state === "stale"}
                    />
                ) : null
            }
        >
            <Text
                style={[theme.type.body, { color: theme.colors.ink }]}
                numberOfLines={1}
            >
                <Text style={styles.bold}>{title.number}</Text>
                {title.name ? ` ${title.name}` : ""}
            </Text>
        </Row>
    );
}

export const rowStyles = StyleSheet.create({
    bold: { fontWeight: "700" },
});

const styles = StyleSheet.create({
    group: { overflow: "hidden" },
    row: {
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingHorizontal: 16,
        minHeight: 56,
        paddingVertical: 10,
    },
    leading: { width: 32, alignItems: "center" },
    flex: { flex: 1 },
    bold: { fontWeight: "700" },
});

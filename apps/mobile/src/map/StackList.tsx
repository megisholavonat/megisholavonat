import type { TrainFeatureProperties } from "@megisholavonat/api-client";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import { TrainRow } from "../search/rows";
import { useAppTheme } from "../theme/ThemeProvider";
import { CloseButton } from "../ui/CloseButton";

/**
 * Trains that still sit on top of each other at full zoom (a terminus, a
 * station's platforms), listed to pick one, as the web's bubble list. A card
 * over the map's bottom controls; the map's next tap or move closes it.
 */
export function StackList({
    trains,
    now,
    onSelect,
    onClose,
}: {
    trains: TrainFeatureProperties[];
    now: Date;
    onSelect: (vehicleId: string) => void;
    onClose: () => void;
}) {
    const theme = useAppTheme();
    const t = useTranslations("Home");
    const insets = useSafeAreaInsets();
    const title = t("cluster", { count: trains.length });
    return (
        <View
            style={[styles.wrap, { paddingBottom: insets.bottom + 12 }]}
            pointerEvents="box-none"
        >
            <View
                accessibilityViewIsModal
                accessibilityLabel={title}
                style={[
                    styles.card,
                    {
                        backgroundColor: theme.colors.surface,
                        borderRadius: theme.radii.lg,
                    },
                ]}
            >
                <View style={styles.header}>
                    <Text
                        style={[
                            theme.type.headline,
                            styles.flex,
                            { color: theme.colors.ink },
                        ]}
                        accessibilityRole="header"
                    >
                        {title}
                    </Text>
                    <CloseButton onPress={onClose} />
                </View>
                <ScrollView style={styles.list} bounces={false}>
                    {trains.map((train, i) => (
                        <TrainRow
                            key={train.vehicleId}
                            train={train}
                            first={i === 0}
                            now={now}
                            onPress={() => onSelect(train.vehicleId)}
                        />
                    ))}
                </ScrollView>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: 16,
    },
    card: {
        overflow: "hidden",
        maxHeight: 360,
        elevation: 4,
        shadowColor: "#000",
        shadowOpacity: 0.18,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingLeft: 16,
        paddingRight: 12,
        paddingTop: 12,
        paddingBottom: 4,
    },
    flex: { flex: 1 },
    list: { flexGrow: 0 },
});

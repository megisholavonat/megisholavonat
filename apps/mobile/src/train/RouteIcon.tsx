import { StyleSheet, Text, View } from "react-native";
import { routeLabel } from "./labels";

/** Font family registered with expo-font in the root layout. */
export const MNR2007_FONT = "MNR2007";

export function RouteIcon({
    routeShortName,
    textColor,
}: {
    routeShortName?: string | null;
    /** Route colour from the API, hex without '#'. */
    textColor?: string | null;
}) {
    const label = routeLabel(routeShortName);
    if (!label) return null;

    const color = textColor ? `#${textColor}` : "#000000";

    return (
        <View
            style={styles.badge}
            accessibilityRole="image"
            accessibilityLabel={
                label.kind === "glyph" ? (label.name ?? undefined) : label.text
            }
        >
            {label.kind === "glyph" ? (
                <Text style={[styles.glyph, { color }]}>{label.glyph}</Text>
            ) : (
                <Text style={[styles.text, { color }]}>{label.text}</Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    badge: {
        backgroundColor: "#FFFFFF",
        borderRadius: 8,
        minWidth: 48,
        height: 32,
        paddingHorizontal: 6,
        alignItems: "center",
        justifyContent: "center",
    },
    glyph: {
        fontFamily: MNR2007_FONT,
        fontSize: 22,
        includeFontPadding: false,
    },
    text: {
        fontSize: 15,
        fontWeight: "700",
    },
});

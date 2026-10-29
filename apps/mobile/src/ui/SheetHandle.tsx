import { Platform, StyleSheet, View } from "react-native";
import { withAlpha } from "../theme/palette";
import { useAppTheme } from "../theme/ThemeProvider";

/**
 * Material 3 drag handle (32 × 4 dp). iOS draws the system grabber of the
 * sheet itself; the Android sheet from react-native-screens has none.
 */
export function SheetHandle() {
    const theme = useAppTheme();
    if (Platform.OS === "ios") return null;
    return (
        <View
            style={[
                styles.handle,
                { backgroundColor: withAlpha(theme.colors.ink2, 0.6) },
            ]}
            accessible={false}
            importantForAccessibility="no"
        />
    );
}

const styles = StyleSheet.create({
    handle: {
        alignSelf: "center",
        width: 32,
        height: 4,
        borderRadius: 2,
        marginTop: -4,
        marginBottom: 2,
    },
});

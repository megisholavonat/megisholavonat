import { type ColorValue, StyleSheet, Text } from "react-native";
import { routeLabel } from "./labels";

// The only place that knows about the MNR2007 font. It is embedded for now
// but not licensed for a store release: swapping in our own route badges
// means replacing this component (and the font registration that uses
// MNR2007_FONT in the root layout), nothing else.

/** Font family registered with expo-font in the root layout. */
export const MNR2007_FONT = "MNR2007";

/** MÁV route glyph in the text colour (design: "a glifa a szöveg színét veszi fel"). */
export function RouteIcon({
    routeShortName,
    color,
    size = 22,
}: {
    routeShortName?: string | null;
    color: ColorValue;
    size?: number;
}) {
    const label = routeLabel(routeShortName);
    if (!label) return null;

    if (label.kind === "glyph") {
        return (
            <Text
                style={[
                    styles.glyph,
                    { color, fontSize: size, lineHeight: size * 1.15 },
                ]}
                accessibilityRole="image"
                accessibilityLabel={label.name ?? undefined}
                allowFontScaling={false}
            >
                {label.glyph}
            </Text>
        );
    }
    return (
        <Text
            style={[styles.text, { color, fontSize: size * 0.68 }]}
            numberOfLines={1}
        >
            {label.text}
        </Text>
    );
}

const styles = StyleSheet.create({
    glyph: {
        fontFamily: MNR2007_FONT,
        includeFontPadding: false,
    },
    text: {
        fontWeight: "800",
    },
});

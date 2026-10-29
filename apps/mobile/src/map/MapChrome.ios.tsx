import {
    Button,
    Host,
    HStack,
    Image,
    Spacer,
    Text,
    VStack,
} from "@expo/ui/swift-ui";
import {
    accessibilityLabel,
    background,
    buttonStyle,
    font,
    foregroundStyle,
    frame,
    glassEffect,
    padding,
    shapes,
} from "@expo/ui/swift-ui/modifiers";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import { liquidGlass } from "../ui/platform";
import type { MapChromeProps } from "./MapChrome.types";

// iOS: Liquid Glass on the floating controls only, solid content (HIG
// Materials: "Don't use Liquid Glass in the content layer"). Before iOS 26
// the same shapes get the regular blur material.

function glass(shape: "capsule" | "circle") {
    return liquidGlass
        ? glassEffect({
              glass: { variant: "regular", interactive: true },
              shape,
          })
        : background(
              { type: "material", material: "regular" },
              shape === "capsule" ? shapes.capsule() : shapes.circle(),
          );
}

export function MapChrome({
    onSearch,
    onSettings,
    onLocate,
    following,
    onAttribution,
    children,
}: MapChromeProps) {
    const t = useTranslations("Home");
    const insets = useSafeAreaInsets();

    return (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            <Host
                matchContents
                style={[styles.controls, { top: insets.top + 6 }]}
            >
                <VStack spacing={0} modifiers={[glass("capsule")]}>
                    <Button
                        onPress={onSettings}
                        modifiers={[
                            buttonStyle("plain"),
                            accessibilityLabel(t("settings")),
                        ]}
                    >
                        <Image
                            systemName="gearshape"
                            size={19}
                            modifiers={[frame({ width: 48, height: 48 })]}
                        />
                    </Button>
                    <Button
                        onPress={onLocate}
                        modifiers={[
                            buttonStyle("plain"),
                            accessibilityLabel(t("my_location")),
                        ]}
                    >
                        <Image
                            systemName={
                                following ? "location.fill" : "location"
                            }
                            size={19}
                            modifiers={[frame({ width: 48, height: 48 })]}
                        />
                    </Button>
                </VStack>
            </Host>

            <View
                style={[styles.bottom, { paddingBottom: insets.bottom + 8 }]}
                pointerEvents="box-none"
            >
                <Host matchContents style={styles.attribution}>
                    <Button
                        onPress={onAttribution}
                        modifiers={[
                            buttonStyle("plain"),
                            accessibilityLabel(t("map_data")),
                        ]}
                    >
                        <HStack
                            spacing={4}
                            modifiers={[
                                padding({ horizontal: 10, vertical: 6 }),
                                glass("capsule"),
                            ]}
                        >
                            <Image systemName="info.circle" size={12} />
                            <Text
                                modifiers={[
                                    font({ size: 11, weight: "semibold" }),
                                ]}
                            >
                                {t("map_data_short")}
                            </Text>
                        </HStack>
                    </Button>
                </Host>
                {children}
                <Host style={styles.search}>
                    <Button
                        onPress={onSearch}
                        modifiers={[
                            buttonStyle("plain"),
                            accessibilityLabel(t("search_placeholder")),
                        ]}
                    >
                        <HStack
                            spacing={8}
                            modifiers={[
                                padding({ horizontal: 16 }),
                                frame({ height: 52 }),
                                frame({ maxWidth: Number.POSITIVE_INFINITY }),
                                glass("capsule"),
                            ]}
                        >
                            <Image
                                systemName="magnifyingglass"
                                size={17}
                                modifiers={[
                                    foregroundStyle({
                                        type: "hierarchical",
                                        style: "secondary",
                                    }),
                                ]}
                            />
                            <Text
                                modifiers={[
                                    font({ size: 17 }),
                                    foregroundStyle({
                                        type: "hierarchical",
                                        style: "secondary",
                                    }),
                                ]}
                            >
                                {t("search_placeholder")}
                            </Text>
                            <Spacer />
                        </HStack>
                    </Button>
                </Host>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    controls: { position: "absolute", right: 14 },
    bottom: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: 12,
        gap: 10,
    },
    attribution: { alignSelf: "flex-start", marginLeft: 2 },
    search: { height: 52, alignSelf: "stretch" },
});

import { Marker } from "@maplibre/maplibre-react-native";
import type { TrainFeatureProperties } from "@megisholavonat/api-client";
import { MAP_STATION_MARK, markSizeAt } from "@megisholavonat/core/tokens/map";
import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import { RouteIcon } from "../train/RouteIcon";
import { trainTitle } from "../train/trainData";
import type { FocusStation } from "./focus";
import { ARROW, MARK_SHAPES, ringReach, SPRITE_SIZE } from "./sprites";

/** The selection label's pop-in, as on the web */
const POP_MS = 180;

/** Fades and scales in from below on mount (none with reduce motion). */
function PopIn({
    children,
    reduceMotion,
}: {
    children: React.ReactNode;
    reduceMotion: boolean;
}) {
    const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
    useEffect(() => {
        if (reduceMotion) return;
        Animated.timing(progress, {
            toValue: 1,
            duration: POP_MS,
            useNativeDriver: true,
        }).start();
    }, [progress, reduceMotion]);
    return (
        <Animated.View
            style={{
                opacity: progress,
                transform: [
                    {
                        translateY: progress.interpolate({
                            inputRange: [0, 1],
                            outputRange: [4, 0],
                        }),
                    },
                    {
                        scale: progress.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.9, 1],
                        }),
                    },
                ],
            }}
        >
            {children}
        </Animated.View>
    );
}

/**
 * How far above its centre the selected train's label sits (px): clear of
 * the selection ring and the direction arrow when it points up
 */
export function labelLift(zoom: number): number {
    const scale = markSizeAt(zoom) / SPRITE_SIZE;
    const ring = Math.max(...MARK_SHAPES.map(ringReach)) * scale;
    return Math.round(ring + 1 + ARROW.height + 2);
}

/** Route glyph and number on an ink pill above the selected train. */
export function SelectedTrainLabel({
    train,
    lngLat,
    zoom,
    reduceMotion,
}: {
    train: TrainFeatureProperties;
    lngLat: [number, number];
    zoom: number;
    reduceMotion: boolean;
}) {
    const theme = useAppTheme();
    const { number } = trainTitle(train.tripShortName, null);
    return (
        <Marker
            id="selected-train-label"
            lngLat={lngLat}
            anchor="bottom"
            offset={[0, -labelLift(zoom)]}
            pointerEvents="none"
        >
            {/* Keyed so it pops in again for every new selection */}
            <View key={train.vehicleId} pointerEvents="none">
                <PopIn reduceMotion={reduceMotion}>
                    <View
                        style={[
                            styles.pill,
                            {
                                backgroundColor: theme.colors.action,
                                borderRadius: theme.radii.md,
                            },
                        ]}
                    >
                        <RouteIcon
                            routeShortName={train.routeShortName}
                            color={theme.colors.onAction}
                            size={16}
                        />
                        <Text
                            style={[
                                theme.type.caption,
                                theme.tabularNums,
                                styles.bold,
                                { color: theme.colors.onAction },
                            ]}
                            numberOfLines={1}
                            allowFontScaling={false}
                        >
                            {number}
                        </Text>
                    </View>
                </PopIn>
            </View>
        </Marker>
    );
}

/** The chosen station's name in a surface card under its ring, as on the web. */
export function StationLabel({ station }: { station: FocusStation }) {
    const theme = useAppTheme();
    const { label, ring, halo } = MAP_STATION_MARK;
    return (
        <Marker
            id="station-label"
            lngLat={[station.lon, station.lat]}
            anchor="top"
            // Below the ring's halo
            offset={[0, Math.max(ring.radius + ring.width, halo.radius) + 2]}
            pointerEvents="none"
        >
            <View
                pointerEvents="none"
                style={[
                    styles.card,
                    {
                        backgroundColor: theme.colors.surface,
                        borderColor: theme.colors.line,
                        borderRadius: label.radius,
                        paddingHorizontal: label.padX,
                        paddingVertical: label.padY,
                    },
                ]}
            >
                <Text
                    style={[
                        styles.bold,
                        {
                            color: theme.colors.ink,
                            fontSize: label.size,
                            lineHeight: Math.round(label.size * 1.2),
                        },
                    ]}
                    numberOfLines={2}
                    allowFontScaling={false}
                >
                    {station.name}
                </Text>
            </View>
        </Marker>
    );
}

const styles = StyleSheet.create({
    pill: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 6,
        paddingVertical: 2,
        shadowColor: "#000",
        shadowOpacity: 0.15,
        shadowRadius: 2,
        shadowOffset: { width: 0, height: 1 },
        elevation: 2,
    },
    card: {
        borderWidth: StyleSheet.hairlineWidth,
        maxWidth: 200,
    },
    bold: { fontWeight: "700" },
});

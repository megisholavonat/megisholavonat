import { MOTION } from "@megisholavonat/core/tokens";
import { useEffect, useRef, useState } from "react";
import {
    AccessibilityInfo,
    Animated,
    Easing,
    type StyleProp,
    StyleSheet,
    type TextStyle,
    View,
} from "react-native";

/** The system "Reduce motion" (iOS) / "Remove animations" (Android) setting. */
export function useReduceMotion(): boolean {
    const [reduce, setReduce] = useState(false);
    useEffect(() => {
        let mounted = true;
        AccessibilityInfo.isReduceMotionEnabled().then((value) => {
            if (mounted) setReduce(value);
        });
        const sub = AccessibilityInfo.addEventListener(
            "reduceMotionChanged",
            setReduce,
        );
        return () => {
            mounted = false;
            sub.remove();
        };
    }, []);
    return reduce;
}

const [x1, y1, x2, y2] = MOTION.delayChange.easing.bezier;
const delayEasing = Easing.bezier(x1, y1, x2, y2);
/** How far the old value slides out, relative to the line height */
const ROLL = 0.6;

/**
 * Text that rolls to its new value: the old one slides up and fades out
 * while the new one comes up from below (MOTION.delayChange, 200 ms). With
 * reduced motion it just changes.
 */
export function RollingText({
    text,
    style,
    lineHeight,
    accessibilityLabel,
}: {
    text: string;
    style: StyleProp<TextStyle>;
    lineHeight: number;
    accessibilityLabel?: string;
}) {
    const reduce = useReduceMotion();
    const [previous, setPrevious] = useState<string | null>(null);
    const shown = useRef(text);
    const progress = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        if (shown.current === text) return;
        const old = shown.current;
        shown.current = text;
        if (reduce) {
            setPrevious(null);
            progress.setValue(1);
            return;
        }
        setPrevious(old);
        progress.setValue(0);
        const animation = Animated.timing(progress, {
            toValue: 1,
            duration: MOTION.delayChange.duration,
            easing: delayEasing,
            useNativeDriver: true,
        });
        animation.start(({ finished }) => {
            if (finished) setPrevious(null);
        });
        return () => animation.stop();
    }, [text, reduce, progress]);

    const distance = lineHeight * ROLL;
    return (
        <View
            style={styles.clip}
            accessible
            accessibilityLabel={accessibilityLabel ?? text}
        >
            <Animated.Text
                style={[
                    style,
                    {
                        opacity: progress,
                        transform: [
                            {
                                translateY: progress.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [distance, 0],
                                }),
                            },
                        ],
                    },
                ]}
                numberOfLines={1}
            >
                {text}
            </Animated.Text>
            {previous !== null ? (
                <Animated.Text
                    style={[
                        style,
                        styles.previous,
                        {
                            opacity: progress.interpolate({
                                inputRange: [0, 1],
                                outputRange: [1, 0],
                            }),
                            transform: [
                                {
                                    translateY: progress.interpolate({
                                        inputRange: [0, 1],
                                        outputRange: [0, -distance],
                                    }),
                                },
                            ],
                        },
                    ]}
                    numberOfLines={1}
                >
                    {previous}
                </Animated.Text>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    clip: { overflow: "hidden" },
    previous: { position: "absolute", left: 0, right: 0, top: 0 },
});

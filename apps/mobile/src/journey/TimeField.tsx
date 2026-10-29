import { DatePickerDialog, TimePickerDialog } from "@expo/ui/jetpack-compose";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useAppTheme } from "../theme/ThemeProvider";
import { ComposeHost } from "../ui/ComposeHost";
import { Icon } from "../ui/Icon";
import type { TimeFieldProps } from "./TimeField.types";

type Dialog = "date" | "time" | null;

/**
 * Android: tonal date and time buttons opening the Material 3 date and
 * time picker dialogs, plus "Now" once changed. iOS: TimeField.ios.tsx.
 */
export function TimeField({ value, onChange }: TimeFieldProps) {
    const theme = useAppTheme();
    const t = useTranslations("Journey");
    const format = useFormatter();
    const [dialog, setDialog] = useState<Dialog>(null);
    const current = new Date(value ?? Date.now());
    const tonal = { backgroundColor: theme.colors.surface2 };
    const ripple = { color: theme.colors.line };
    const label = [
        styles.label,
        theme.tabularNums,
        { color: theme.colors.ink },
    ];

    // Keep the time of day when the date changes, and the date when the
    // time changes (the dialogs report UTC midnight / today respectively)
    const setDate = (picked: Date) => {
        const next = new Date(current);
        next.setFullYear(
            picked.getUTCFullYear(),
            picked.getUTCMonth(),
            picked.getUTCDate(),
        );
        onChange(next.getTime());
    };
    const setTime = (picked: Date) => {
        const next = new Date(current);
        next.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
        onChange(next.getTime());
    };

    return (
        <View style={styles.group}>
            <Pressable
                onPress={() => setDialog("date")}
                accessibilityRole="button"
                android_ripple={ripple}
                style={[styles.button, styles.first, tonal]}
            >
                <Text style={label}>
                    {format.dateTime(current, {
                        month: "short",
                        day: "numeric",
                        weekday: "short",
                    })}
                </Text>
            </Pressable>
            <Pressable
                onPress={() => setDialog("time")}
                accessibilityRole="button"
                android_ripple={ripple}
                style={[
                    styles.button,
                    value === null ? styles.last : undefined,
                    tonal,
                ]}
            >
                <Text style={label}>
                    {value === null
                        ? t("now")
                        : format.dateTime(current, {
                              hour: "2-digit",
                              minute: "2-digit",
                          })}
                </Text>
            </Pressable>
            {value !== null ? (
                <Pressable
                    onPress={() => onChange(null)}
                    accessibilityRole="button"
                    accessibilityLabel={t("now")}
                    android_ripple={ripple}
                    style={[styles.button, styles.last, styles.icon, tonal]}
                >
                    <Icon name="close" size={20} color={theme.colors.ink} />
                </Pressable>
            ) : null}
            {dialog ? (
                <ComposeHost style={styles.dialogHost}>
                    {dialog === "date" ? (
                        <DatePickerDialog
                            initialDate={current.toISOString()}
                            selectableDates={{ start: startOfToday() }}
                            onDateSelected={(date) => {
                                setDialog(null);
                                setDate(date);
                            }}
                            onDismissRequest={() => setDialog(null)}
                        />
                    ) : (
                        <TimePickerDialog
                            initialDate={current.toISOString()}
                            is24Hour
                            onDateSelected={(date) => {
                                setDialog(null);
                                setTime(date);
                            }}
                            onDismissRequest={() => setDialog(null)}
                        />
                    )}
                </ComposeHost>
            ) : null}
        </View>
    );
}

function startOfToday(): Date {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
}

const styles = StyleSheet.create({
    group: { flexDirection: "row", gap: 2, alignSelf: "flex-start" },
    button: {
        height: 48,
        paddingHorizontal: 18,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 8,
        overflow: "hidden",
    },
    icon: { width: 56, paddingHorizontal: 0 },
    first: { borderTopLeftRadius: 24, borderBottomLeftRadius: 24 },
    last: { borderTopRightRadius: 24, borderBottomRightRadius: 24 },
    label: { fontSize: 15, fontWeight: "600" },
    dialogHost: { position: "absolute", width: 1, height: 1 },
});

import type { Station } from "@megisholavonat/api-client";
import { searchStationsOptions } from "@megisholavonat/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { useTranslations } from "use-intl";
import { type Field, planner } from "../../journey/store";
import { highlight } from "../../search/search";
import { StationTypeLabel, stationIcon } from "../../station/StationType";
import { useAppTheme } from "../../theme/ThemeProvider";
import { StateBlock } from "../../ui/ds";
import { Icon } from "../../ui/Icon";

const DEBOUNCE_MS = 250;

/** Station search for one end of the journey (the search screen's look). */
export default function PickStationScreen() {
    const { field } = useLocalSearchParams<{ field: Field }>();
    const router = useRouter();
    const theme = useAppTheme();
    const t = useTranslations("Journey");
    const ts = useTranslations("Search");
    const [query, setQuery] = useState("");
    const [debounced, setDebounced] = useState("");
    useEffect(() => {
        const timer = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [query]);

    const stations = useQuery({
        ...searchStationsOptions({ query: { q: debounced, limit: 10 } }),
        enabled: debounced.length >= 2,
        placeholderData: (previous) => previous,
    });
    const list: Station[] = debounced.length >= 2 ? (stations.data ?? []) : [];

    const pick = (station: Station) => {
        planner.pick(field === "to" ? "to" : "from", station);
        router.back();
    };

    return (
        <>
            <Stack.Screen
                options={{
                    title: field === "to" ? t("to") : t("from"),
                    headerSearchBarOptions: {
                        placeholder:
                            field === "to" ? t("pick_to") : t("pick_from"),
                        autoFocus: true,
                        hideWhenScrolling: false,
                        autoCapitalize: "none",
                        onChangeText: (event) =>
                            setQuery(event.nativeEvent.text),
                        onCancelButtonPress: () => router.back(),
                    },
                }}
            />
            <ScrollView
                contentInsetAdjustmentBehavior="automatic"
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                contentContainerStyle={styles.content}
            >
                {list.length > 0 ? (
                    <View
                        style={[
                            styles.group,
                            {
                                backgroundColor: theme.colors.surface,
                                borderRadius:
                                    Platform.OS === "ios" ? theme.radii.lg : 20,
                            },
                        ]}
                    >
                        {list.map((station, index) => (
                            <Pressable
                                key={station.id}
                                onPress={() => pick(station)}
                                accessibilityRole="button"
                                android_ripple={{ color: theme.colors.line }}
                                style={({ pressed }) => [
                                    styles.row,
                                    index > 0 && {
                                        borderTopWidth:
                                            StyleSheet.hairlineWidth,
                                        borderTopColor: theme.colors.line,
                                    },
                                    pressed &&
                                        Platform.OS === "ios" && {
                                            backgroundColor:
                                                theme.colors.surface2,
                                        },
                                ]}
                            >
                                <Icon
                                    name={stationIcon(station)}
                                    size={22}
                                    color={theme.colors.ink2}
                                />
                                <Text
                                    style={[
                                        theme.type.body,
                                        styles.flex,
                                        { color: theme.colors.ink },
                                    ]}
                                    numberOfLines={1}
                                >
                                    {highlight(station.name, query).map(
                                        (part, i) => (
                                            <Text
                                                // biome-ignore lint/suspicious/noArrayIndexKey: static split
                                                key={i}
                                                style={
                                                    part.match
                                                        ? styles.bold
                                                        : undefined
                                                }
                                            >
                                                {part.text}
                                            </Text>
                                        ),
                                    )}
                                </Text>
                                <StationTypeLabel station={station} />
                            </Pressable>
                        ))}
                    </View>
                ) : debounced.length >= 2 && !stations.isFetching ? (
                    <View style={styles.empty}>
                        <StateBlock icon="search" title={ts("no_results")} />
                    </View>
                ) : null}
            </ScrollView>
        </>
    );
}

const styles = StyleSheet.create({
    content: { padding: 16, gap: 16 },
    group: { overflow: "hidden" },
    row: {
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingHorizontal: 16,
        minHeight: 56,
        paddingVertical: 10,
    },
    flex: { flex: 1 },
    bold: { fontWeight: "700" },
    empty: { paddingTop: 24 },
});

import type { Station } from "@megisholavonat/api-client";
import {
    getTrainsOptions,
    searchStationsOptions,
} from "@megisholavonat/api-client/react-query";
import { useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { useTranslations } from "use-intl";
import { noteEntry, track } from "../analytics";
import { Group, Row, rowStyles, TrainRow } from "../search/rows";
import { highlight, lateTrains, searchTrains } from "../search/search";
import { useAppTheme } from "../theme/ThemeProvider";
import { SectionLabel, StateBlock } from "../ui/ds";
import { Icon } from "../ui/Icon";
import { useNow } from "../ui/useNow";

const DEBOUNCE_MS = 250;
/** Late trains in the empty search, before "All trains" */
const LATE_PREVIEW = 5;
const ios = Platform.OS === "ios";

function useDebounced<T>(value: T, ms: number): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), ms);
        return () => clearTimeout(timer);
    }, [value, ms]);
    return debounced;
}

/**
 * iOS: the search field at the top of the search sheet (Apple Maps style),
 * so the map stays in view behind it. Android searches in the app bar.
 */
function SheetSearchField({
    value,
    onChange,
    onCancel,
}: {
    value: string;
    onChange: (text: string) => void;
    onCancel: () => void;
}) {
    const theme = useAppTheme();
    const t = useTranslations("Search");
    const th = useTranslations("Home");
    return (
        <View style={styles.fieldRow}>
            <View
                style={[
                    styles.field,
                    { backgroundColor: theme.colors.surface2 },
                ]}
            >
                <Icon name="search" size={17} color={theme.colors.ink2} />
                <TextInput
                    value={value}
                    onChangeText={onChange}
                    placeholder={th("search_placeholder")}
                    placeholderTextColor={theme.colors.ink2}
                    autoFocus
                    autoCapitalize="none"
                    autoCorrect={false}
                    clearButtonMode="while-editing"
                    returnKeyType="search"
                    enablesReturnKeyAutomatically
                    style={[styles.input, { color: theme.colors.ink }]}
                    accessibilityLabel={t("title")}
                />
            </View>
            <Pressable
                onPress={onCancel}
                accessibilityRole="button"
                hitSlop={8}
                style={({ pressed }) => pressed && styles.pressed}
            >
                <Text style={[styles.cancel, { color: theme.colors.ink }]}>
                    {t("cancel")}
                </Text>
            </Pressable>
        </View>
    );
}

/**
 * Screen 3: search for stations (API) and live trains (map feed). Empty, it
 * offers the journey planner and the trains running late.
 */
export default function SearchScreen() {
    const router = useRouter();
    const theme = useAppTheme();
    const t = useTranslations("Search");
    const th = useTranslations("Home");
    const [query, setQuery] = useState("");
    const debounced = useDebounced(query.trim(), DEBOUNCE_MS);
    const now = useNow();

    const stations = useQuery({
        ...searchStationsOptions({ query: { q: debounced, limit: 8 } }),
        enabled: debounced.length >= 2,
        placeholderData: (previous) => previous,
    });
    const { data: feed } = useQuery({
        ...getTrainsOptions(),
        refetchOnMount: false,
    });
    const trains = searchTrains(feed, query, now);
    const late = lateTrains(feed, now, LATE_PREVIEW);
    const stationList: Station[] =
        debounced.length >= 2 ? (stations.data ?? []) : [];

    // Close search first so the sheet opens over the map
    const selected = (type: "train" | "station") => {
        noteEntry("search");
        track("search_result_selected", {
            type,
            query_length: query.trim().length,
            trains: trains.length,
            stations: stationList.length,
        });
    };
    const openStation = (station: Station) => {
        selected("station");
        router.back();
        router.push({
            pathname: "/station/[stationId]",
            params: { stationId: station.id, name: station.name },
        });
    };
    const openTrain = (vehicleId: string) => {
        selected("train");
        router.back();
        router.push({ pathname: "/train/[vehicleId]", params: { vehicleId } });
    };
    const openPlanner = () => {
        router.back();
        router.push("/journey");
    };
    const openTrains = () => {
        router.back();
        router.push("/trains");
    };

    const empty = query.trim() === "";
    const nothing =
        debounced.length >= 2 &&
        !stations.isFetching &&
        stationList.length === 0 &&
        trains.length === 0;

    const chevron = <Icon name="chevron" size={16} color={theme.colors.ink2} />;

    return (
        <>
            {ios ? null : (
                <Stack.Screen
                    options={{
                        headerSearchBarOptions: {
                            placeholder: th("search_placeholder"),
                            autoFocus: true,
                            hideWhenScrolling: false,
                            autoCapitalize: "none",
                            onChangeText: (event) =>
                                setQuery(event.nativeEvent.text),
                        },
                    }}
                />
            )}
            {ios ? (
                <SheetSearchField
                    value={query}
                    onChange={setQuery}
                    onCancel={() => router.back()}
                />
            ) : null}
            <ScrollView
                contentInsetAdjustmentBehavior="automatic"
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                contentContainerStyle={styles.content}
            >
                {empty ? (
                    <Group>
                        <Row
                            first
                            onPress={openPlanner}
                            leading={
                                <Icon
                                    name="route"
                                    size={22}
                                    color={theme.colors.ink2}
                                />
                            }
                            trailing={chevron}
                        >
                            <Text
                                style={[
                                    theme.type.body,
                                    { color: theme.colors.ink },
                                ]}
                            >
                                {t("plan")}
                            </Text>
                        </Row>
                    </Group>
                ) : null}
                {empty ? (
                    <View>
                        {late.length > 0 ? (
                            <SectionLabel>{t("late_now")}</SectionLabel>
                        ) : null}
                        <Group>
                            {late.map((train, index) => (
                                <TrainRow
                                    key={train.vehicleId}
                                    train={train}
                                    first={index === 0}
                                    now={now}
                                    onPress={() => openTrain(train.vehicleId)}
                                />
                            ))}
                            <Row
                                first={late.length === 0}
                                onPress={openTrains}
                                leading={
                                    <Icon
                                        name="list"
                                        size={22}
                                        color={theme.colors.ink2}
                                    />
                                }
                                trailing={chevron}
                            >
                                <Text
                                    style={[
                                        theme.type.body,
                                        { color: theme.colors.ink },
                                    ]}
                                >
                                    {t("all_trains")}
                                </Text>
                            </Row>
                        </Group>
                    </View>
                ) : null}
                {stationList.length > 0 ? (
                    <View>
                        <SectionLabel>{t("stations")}</SectionLabel>
                        <Group>
                            {stationList.map((station, index) => (
                                <Row
                                    key={station.id}
                                    first={index === 0}
                                    onPress={() => openStation(station)}
                                    leading={
                                        <Icon
                                            name="station"
                                            size={22}
                                            color={theme.colors.ink2}
                                        />
                                    }
                                >
                                    <Text
                                        style={[
                                            theme.type.body,
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
                                                            ? rowStyles.bold
                                                            : undefined
                                                    }
                                                >
                                                    {part.text}
                                                </Text>
                                            ),
                                        )}
                                    </Text>
                                </Row>
                            ))}
                        </Group>
                    </View>
                ) : null}
                {trains.length > 0 ? (
                    <View>
                        <SectionLabel>{t("trains")}</SectionLabel>
                        <Group>
                            {trains.map((train, index) => (
                                <TrainRow
                                    key={train.vehicleId}
                                    train={train}
                                    first={index === 0}
                                    now={now}
                                    onPress={() => openTrain(train.vehicleId)}
                                />
                            ))}
                        </Group>
                    </View>
                ) : null}
                {nothing ? (
                    <View style={styles.empty}>
                        <StateBlock icon="search" title={t("no_results")} />
                    </View>
                ) : null}
            </ScrollView>
        </>
    );
}

const styles = StyleSheet.create({
    content: { padding: 16, gap: 16 },
    empty: { paddingTop: 24 },
    fieldRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingTop: 18,
        paddingBottom: 4,
    },
    field: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        minHeight: 40,
        borderRadius: 12,
        paddingLeft: 10,
    },
    input: { flex: 1, minHeight: 40, fontSize: 17 },
    cancel: { fontSize: 17 },
    pressed: { opacity: 0.5 },
});

import type { Station } from "@megisholavonat/api-client";
import {
    getTrainsOptions,
    searchStationsOptions,
} from "@megisholavonat/api-client/react-query";
import { minutesSinceUpdate, staleness } from "@megisholavonat/core/stale";
import { useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { type ReactNode, useEffect, useState } from "react";
import {
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { useTranslations } from "use-intl";
import { highlight, searchTrains } from "../search/search";
import { useAppTheme } from "../theme/ThemeProvider";
import { RouteIcon } from "../train/RouteIcon";
import { trainTitle } from "../train/trainData";
import { DelayChip, SectionLabel, StateBlock } from "../ui/ds";
import { Icon } from "../ui/Icon";

const DEBOUNCE_MS = 250;

function useDebounced<T>(value: T, ms: number): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), ms);
        return () => clearTimeout(timer);
    }, [value, ms]);
    return debounced;
}

function Group({ children }: { children: ReactNode }) {
    const theme = useAppTheme();
    return (
        <View
            style={[
                styles.group,
                {
                    backgroundColor: theme.colors.surface,
                    borderRadius: Platform.OS === "ios" ? theme.radii.lg : 20,
                },
            ]}
        >
            {children}
        </View>
    );
}

function Row({
    leading,
    children,
    trailing,
    onPress,
    first,
}: {
    leading: ReactNode;
    children: ReactNode;
    trailing?: ReactNode;
    onPress: () => void;
    first: boolean;
}) {
    const theme = useAppTheme();
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            android_ripple={{ color: theme.colors.line }}
            style={({ pressed }) => [
                styles.row,
                !first && {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: theme.colors.line,
                },
                pressed &&
                    Platform.OS === "ios" && {
                        backgroundColor: theme.colors.surface2,
                    },
            ]}
        >
            <View style={styles.leading}>{leading}</View>
            <View style={styles.flex}>{children}</View>
            {trailing}
        </Pressable>
    );
}

/** Screen 3: search for stations (API) and live trains (map feed). */
export default function SearchScreen() {
    const router = useRouter();
    const theme = useAppTheme();
    const t = useTranslations("Search");
    const th = useTranslations("Home");
    const [query, setQuery] = useState("");
    const debounced = useDebounced(query.trim(), DEBOUNCE_MS);

    const stations = useQuery({
        ...searchStationsOptions({ query: { q: debounced, limit: 8 } }),
        enabled: debounced.length >= 2,
        placeholderData: (previous) => previous,
    });
    const { data: feed } = useQuery({
        ...getTrainsOptions(),
        refetchOnMount: false,
    });
    const trains = searchTrains(feed, query);
    const stationList: Station[] =
        debounced.length >= 2 ? (stations.data ?? []) : [];

    // Close search first so the sheet opens over the map
    const openStation = (station: Station) => {
        router.back();
        router.push({
            pathname: "/station/[stationId]",
            params: { stationId: station.id, name: station.name },
        });
    };
    const openTrain = (vehicleId: string) => {
        router.back();
        router.push({ pathname: "/train/[vehicleId]", params: { vehicleId } });
    };

    const openPlanner = () => {
        router.back();
        router.push("/journey");
    };

    const nothing =
        debounced.length >= 2 &&
        !stations.isFetching &&
        stationList.length === 0 &&
        trains.length === 0;

    return (
        <>
            <Stack.Screen
                options={{
                    headerSearchBarOptions: {
                        placeholder: th("search_placeholder"),
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
                {query.trim() === "" ? (
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
                            trailing={
                                <Icon
                                    name="chevron"
                                    size={16}
                                    color={theme.colors.ink2}
                                />
                            }
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
                                                            ? styles.bold
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
                            {trains.map((train, index) => {
                                const title = trainTitle(
                                    train.tripShortName,
                                    null,
                                );
                                const stale =
                                    train.isStale ||
                                    staleness(train.lastUpdated) !== "fresh";
                                return (
                                    <Row
                                        key={train.vehicleId}
                                        first={index === 0}
                                        onPress={() =>
                                            openTrain(train.vehicleId)
                                        }
                                        leading={
                                            <RouteIcon
                                                routeShortName={
                                                    train.routeShortName
                                                }
                                                color={theme.colors.ink}
                                            />
                                        }
                                        trailing={
                                            <DelayChip
                                                delay={train.delay}
                                                staleMinutes={
                                                    stale
                                                        ? minutesSinceUpdate(
                                                              train.lastUpdated,
                                                          )
                                                        : null
                                                }
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
                                            <Text style={styles.bold}>
                                                {title.number}
                                            </Text>
                                            {title.name ? ` ${title.name}` : ""}
                                        </Text>
                                    </Row>
                                );
                            })}
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
    group: { overflow: "hidden" },
    row: {
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingHorizontal: 16,
        minHeight: 56,
        paddingVertical: 10,
    },
    leading: { width: 32, alignItems: "center" },
    flex: { flex: 1 },
    bold: { fontWeight: "700" },
    empty: { paddingTop: 24 },
});

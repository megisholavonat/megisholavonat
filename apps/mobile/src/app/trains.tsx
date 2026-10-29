import type { TrainFeatureProperties } from "@megisholavonat/api-client";
import { getTrainsOptions } from "@megisholavonat/api-client/react-query";
import { POLL_INTERVAL_MS } from "@megisholavonat/core/constants";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Platform, StyleSheet, View } from "react-native";
import { useTranslations } from "use-intl";
import { TrainRow } from "../search/rows";
import { type BrowseSort, browseTrains } from "../search/search";
import { useAppTheme } from "../theme/ThemeProvider";
import { StateBlock } from "../ui/ds";
import { Segmented } from "../ui/Segmented";
import { useNow } from "../ui/useNow";

/**
 * Every train on the map, latest first (or by number): the native take on
 * the old web app's sortable train list.
 */
export default function TrainsScreen() {
    const router = useRouter();
    const theme = useAppTheme();
    const t = useTranslations("Trains");
    const [sort, setSort] = useState<BrowseSort>("delay");
    const now = useNow();
    const { data: feed, dataUpdatedAt } = useQuery({
        ...getTrainsOptions(),
        refetchInterval: POLL_INTERVAL_MS,
    });
    // Re-sorted with the feed and the sort only, so rows don't jump on ticks
    // biome-ignore lint/correctness/useExhaustiveDependencies: see above
    const trains = useMemo(
        () => browseTrains(feed, sort, new Date()),
        [feed, sort, dataUpdatedAt],
    );

    const openTrain = (vehicleId: string) => {
        // Back to the map, where the sheet opens
        router.back();
        router.push({ pathname: "/train/[vehicleId]", params: { vehicleId } });
    };

    const radius = Platform.OS === "ios" ? theme.radii.lg : 20;
    return (
        <FlatList<TrainFeatureProperties>
            data={trains}
            keyExtractor={(train) => train.vehicleId}
            contentInsetAdjustmentBehavior="automatic"
            contentContainerStyle={styles.content}
            ListHeaderComponent={
                <View style={styles.header}>
                    <Segmented
                        options={[
                            { value: "delay", label: t("sort_delay") },
                            { value: "number", label: t("sort_number") },
                        ]}
                        value={sort}
                        onChange={setSort}
                    />
                </View>
            }
            ListEmptyComponent={
                feed ? (
                    <StateBlock icon="noTrains" title={t("empty")} />
                ) : undefined
            }
            renderItem={({ item, index }) => (
                <View
                    style={[
                        { backgroundColor: theme.colors.surface },
                        index === 0 && {
                            borderTopLeftRadius: radius,
                            borderTopRightRadius: radius,
                        },
                        index === trains.length - 1 && {
                            borderBottomLeftRadius: radius,
                            borderBottomRightRadius: radius,
                        },
                        styles.item,
                    ]}
                >
                    <TrainRow
                        train={item}
                        first={index === 0}
                        now={now}
                        onPress={() => openTrain(item.vehicleId)}
                    />
                </View>
            )}
        />
    );
}

const styles = StyleSheet.create({
    content: { padding: 16 },
    header: { paddingBottom: 16 },
    item: { overflow: "hidden" },
});

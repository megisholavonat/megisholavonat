import { LocationManager, type MapRef } from "@maplibre/maplibre-react-native";
import { getTrainsOptions } from "@megisholavonat/api-client/react-query";
import { POLL_INTERVAL_MS } from "@megisholavonat/core/constants";
import { sortDisruptions } from "@megisholavonat/core/disruptions";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DisruptionChip } from "../disruptions/DisruptionViews";
import { interestsOf } from "../disruptions/disruptions";
import { useDisruptions } from "../disruptions/useDisruptions";
import {
    CommuteCard,
    type CommuteItem,
    FollowPrompt,
} from "../follow/CommuteCard";
import { useFollowedVehicleIds, useLiveFollows } from "../follow/live";
import { upcoming } from "../follow/model";
import { useFollows } from "../follow/store";
import { feedState } from "../map/feedState";
import { ConsentCard, FeedStateCard, StaleBanner } from "../map/HomeCards";
import { MapChrome } from "../map/MapChrome";
import { markerCollection } from "../map/markers";
import { TrainMap } from "../map/TrainMap";
import { useSettings } from "../settings/SettingsProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { useNow } from "../ui/useNow";

/** Screen 1: the live map with search, settings and location controls. */
export default function MapScreen() {
    const router = useRouter();
    const theme = useAppTheme();
    const insets = useSafeAreaInsets();
    const { settings, update, askConsent } = useSettings();
    const mapRef = useRef<MapRef>(null);
    const [following, setFollowing] = useState(false);

    const {
        data: trains,
        isError,
        refetch,
    } = useQuery({
        ...getTrainsOptions(),
        refetchInterval: POLL_INTERVAL_MS,
    });
    // The shared clock: markers judge staleness at the same instant as the
    // train sheet and the rows
    const now = useNow();
    const visible = useMemo(
        () => markerCollection(trains, theme, now).features.length,
        [trains, theme, now],
    );
    const state = feedState(trains, isError, visible);

    // My commute: the next run of every follow, live once on the map
    const follows = useFollows();
    const runs = useMemo(() => upcoming(follows, now), [follows, now]);
    const live = useLiveFollows(runs, trains);
    const followed = useFollowedVehicleIds(live);
    const commute: CommuteItem[] = runs.map((r) => ({
        ...r,
        live: live.get(r.follow.id),
    }));

    // Line disruptions: a chip above the search bar while there are any
    const disruptions = useDisruptions();
    const mineDisruptions = useMemo(
        () =>
            sortDisruptions(disruptions, interestsOf(follows)).filter(
                (d) => d.mine,
            ).length,
        [disruptions, follows],
    );

    const openTrain = (vehicleId: string) =>
        router.push({ pathname: "/train/[vehicleId]", params: { vehicleId } });
    const openCommute = (item: CommuteItem) => {
        if (item.live) openTrain(item.live.vehicleId);
        else
            router.push({
                pathname: "/follow",
                params: { id: item.follow.id },
            });
    };

    const locate = async () => {
        if (following) {
            setFollowing(false);
            return;
        }
        if (await LocationManager.requestPermissions()) setFollowing(true);
    };

    return (
        <View style={[styles.screen, { backgroundColor: theme.colors.map }]}>
            <TrainMap
                trains={trains}
                now={now}
                onTrainPress={openTrain}
                followed={followed}
                showRailways={settings.railwayLayer}
                followUser={following}
                onFollowUserChange={setFollowing}
                mapRef={mapRef}
            />
            <MapChrome
                onSearch={() => router.push("/search")}
                onSettings={() => router.push("/settings")}
                onLocate={locate}
                following={following}
                onAttribution={() => mapRef.current?.showAttribution()}
            >
                <FeedStateCard state={state} onRetry={() => refetch()} />
                {askConsent ? (
                    <ConsentCard
                        onAnswer={(granted) =>
                            update({
                                analytics: granted ? "granted" : "denied",
                            })
                        }
                    />
                ) : follows.length === 0 ? (
                    <FollowPrompt onPress={() => router.push("/search")} />
                ) : null}
                <DisruptionChip
                    count={disruptions.length}
                    mine={mineDisruptions}
                    onPress={() => router.push("/disruptions")}
                />
                <CommuteCard items={commute} onOpen={openCommute} />
            </MapChrome>
            {state.kind === "ok" && state.staleMinutes !== null ? (
                <View
                    style={[styles.banner, { top: insets.top + 12 }]}
                    pointerEvents="none"
                >
                    <StaleBanner minutes={state.staleMinutes} />
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1 },
    banner: { position: "absolute", left: 72, right: 72 },
});

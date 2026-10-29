import { LocationManager, type MapRef } from "@maplibre/maplibre-react-native";
import { getTrainsOptions } from "@megisholavonat/api-client/react-query";
import { POLL_INTERVAL_MS } from "@megisholavonat/core/constants";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { feedState } from "../map/feedState";
import { ConsentCard, FeedStateCard, StaleBanner } from "../map/HomeCards";
import { MapChrome } from "../map/MapChrome";
import { markerCollection } from "../map/markers";
import { TrainMap } from "../map/TrainMap";
import { useSettings } from "../settings/SettingsProvider";
import { useAppTheme } from "../theme/ThemeProvider";

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
        dataUpdatedAt,
        refetch,
    } = useQuery({
        ...getTrainsOptions(),
        refetchInterval: POLL_INTERVAL_MS,
    });
    // Staleness is judged at fetch time, so markers change with the feed
    const now = useMemo(
        () => new Date(dataUpdatedAt || Date.now()),
        [dataUpdatedAt],
    );
    const visible = useMemo(
        () => markerCollection(trains, theme, now).features.length,
        [trains, theme, now],
    );
    const state = feedState(trains, isError, visible);

    const openTrain = (vehicleId: string) =>
        router.push({ pathname: "/train/[vehicleId]", params: { vehicleId } });

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
                ) : null}
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

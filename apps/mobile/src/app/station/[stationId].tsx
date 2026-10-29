import type { Station } from "@megisholavonat/api-client";
import { MAP_STATION_MARK } from "@megisholavonat/core/tokens/map";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { noteEntry, takeEntry, track } from "../../analytics";
import { flyToPlace, setFocusStation } from "../../map/focus";
import { useSheetFocus } from "../../map/useSheetFocus";
import { StationBoard } from "../../station/StationBoard";
import { STATION_DETENTS } from "../../ui/sheets";
import { useTrackOnOpen } from "../../useAnalytics";

/** A station from search params, when they carry its place */
function fromParams(params: {
    stationId: string;
    name?: string;
    lat?: string;
    lon?: string;
}): Station | null {
    const lat = Number(params.lat);
    const lon = Number(params.lon);
    if (!params.lat || !params.lon || !Number.isFinite(lat + lon)) return null;
    return { id: params.stationId, name: params.name ?? "", lat, lon };
}

/**
 * Station board route, a native sheet (see the root layout). The map marks
 * the station and flies to it, as soon as search or the board says where
 * it is.
 */
export default function StationScreen() {
    const params = useLocalSearchParams<{
        stationId: string;
        name?: string;
        lat?: string;
        lon?: string;
    }>();
    const { stationId, name } = params;
    const router = useRouter();
    useTrackOnOpen("station_opened", {
        entry: takeEntry() ?? "map",
        surface: "sheet",
        station_id: stationId,
    });
    useSheetFocus("station", STATION_DETENTS);

    const [loaded, setLoaded] = useState<Station | null>(null);
    const station = loaded?.id === stationId ? loaded : fromParams(params);

    // Flown to once per station; marked while its board is open
    const flewRef = useRef<string | null>(null);
    useEffect(() => {
        if (!station) return;
        setFocusStation(station);
        if (flewRef.current !== station.id) {
            flewRef.current = station.id;
            flyToPlace(station.lon, station.lat, MAP_STATION_MARK.flyZoom);
        }
    }, [station]);
    useEffect(() => () => setFocusStation(null), []);

    return (
        <StationBoard
            stationId={stationId}
            initialName={name}
            onStation={setLoaded}
            onClose={() => router.back()}
            onTrain={(vehicleId) => {
                noteEntry("board");
                track("board_row_opened", {});
                router.push({
                    pathname: "/train/[vehicleId]",
                    params: { vehicleId },
                });
            }}
        />
    );
}

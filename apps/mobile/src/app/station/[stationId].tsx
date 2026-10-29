import { useLocalSearchParams, useRouter } from "expo-router";
import { noteEntry, takeEntry, track } from "../../analytics";
import { StationBoard } from "../../station/StationBoard";
import { useTrackOnOpen } from "../../useAnalytics";

/** Station board route, a native sheet (see the root layout). */
export default function StationScreen() {
    const { stationId, name } = useLocalSearchParams<{
        stationId: string;
        name?: string;
    }>();
    const router = useRouter();
    useTrackOnOpen("station_opened", {
        entry: takeEntry() ?? "map",
        surface: "sheet",
        station_id: stationId,
    });
    return (
        <StationBoard
            stationId={stationId}
            initialName={name}
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

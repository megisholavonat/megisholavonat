import { useLocalSearchParams, useRouter } from "expo-router";
import { StationBoard } from "../../station/StationBoard";

/** Station board route, a native sheet (see the root layout). */
export default function StationScreen() {
    const { stationId, name } = useLocalSearchParams<{
        stationId: string;
        name?: string;
    }>();
    const router = useRouter();
    return (
        <StationBoard
            stationId={stationId}
            initialName={name}
            onClose={() => router.back()}
            onTrain={(vehicleId) =>
                router.push({
                    pathname: "/train/[vehicleId]",
                    params: { vehicleId },
                })
            }
        />
    );
}

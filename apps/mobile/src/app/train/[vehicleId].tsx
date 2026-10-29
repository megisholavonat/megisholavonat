import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { setSelectedTrain } from "../../map/selection";
import { useSettings } from "../../settings/SettingsProvider";
import { TrainSheet } from "../../train/TrainSheet";

/**
 * Train sheet route, presented as a native sheet with peek, half and full
 * detents (see the root layout). Also reachable via the
 * megisholavonat://train/<id> link.
 */
export default function TrainSheetScreen() {
    const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();
    const router = useRouter();
    const { settings, update } = useSettings();

    useEffect(() => {
        setSelectedTrain(vehicleId);
        return () => setSelectedTrain(null);
    }, [vehicleId]);

    // For the consent card: ask only once a train has been looked at
    useEffect(() => {
        if (!settings.openedTrain) update({ openedTrain: true });
    }, [settings.openedTrain, update]);

    return <TrainSheet vehicleId={vehicleId} onClose={() => router.back()} />;
}

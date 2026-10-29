import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { flyToTrain, takeMapTap } from "../../map/focus";
import { setSelectedTrain } from "../../map/selection";
import { useSheetFocus } from "../../map/useSheetFocus";
import { useSettings } from "../../settings/SettingsProvider";
import { TrainSheet } from "../../train/TrainSheet";
import { useTrainAnalytics } from "../../train/trainAnalytics";
import { TRAIN_DETENTS } from "../../ui/sheets";

/**
 * Train sheet route, presented as a native sheet with peek, half and full
 * detents (see the root layout). Also reachable via the
 * megisholavonat://train/<id> link.
 */
export default function TrainSheetScreen() {
    const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();
    const router = useRouter();
    const { settings, update } = useSettings();
    useTrainAnalytics(vehicleId);
    useSheetFocus("train", TRAIN_DETENTS);

    useEffect(() => {
        setSelectedTrain(vehicleId);
        // Opened from search, a list, a follow, an alert or a link: the map
        // flies to the train. A tap on the map already has it in view
        if (!takeMapTap(vehicleId)) flyToTrain(vehicleId);
        return () => setSelectedTrain(null);
    }, [vehicleId]);

    // For the consent card: ask only once a train has been looked at
    useEffect(() => {
        if (!settings.openedTrain) update({ openedTrain: true });
    }, [settings.openedTrain, update]);

    return <TrainSheet vehicleId={vehicleId} onClose={() => router.back()} />;
}

import { useLocalSearchParams } from "expo-router";
import { TrainSummary } from "../../train/TrainSummary";

/**
 * Train sheet route. Presented as a native iOS form sheet with detents (see
 * the root layout); also reachable via the megisholavonat://train/<id> link.
 */
export default function TrainSheetScreen() {
    const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();
    return <TrainSummary vehicleId={vehicleId} />;
}

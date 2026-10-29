import { useLocalSearchParams } from "expo-router";
import { FollowForm } from "../follow/FollowForm";
import { useFollowForm } from "../follow/useFollowForm";
import { useTrackOnOpen } from "../useAnalytics";

/**
 * Follow a train, or edit a follow: days, boarding and alighting, alerts
 * (design board 4). Opened from the train sheet with the vehicle, or from
 * home with the follow id.
 */
export default function FollowScreen() {
    const { vehicleId, id } = useLocalSearchParams<{
        vehicleId?: string;
        id?: string;
    }>();
    useTrackOnOpen("follow_started", { target: id ? "edit" : "train" });
    const form = useFollowForm({ vehicleId, followId: id });
    return <FollowForm form={form} />;
}

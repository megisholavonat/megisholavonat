import { Redirect, useLocalSearchParams } from "expo-router";
import { getFollows } from "../../follow/store";

/**
 * megisholavonat://followed/<follow id>, from the Live Activity and the
 * commute widget: the followed train's sheet when its vehicle is known
 * (vehicle ids change between days, so the link names the follow), else
 * the map with the commute card.
 */
export default function FollowedLink() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const vehicleId = getFollows().find((f) => f.id === id)?.vehicleId;
    return vehicleId ? (
        <Redirect
            href={{ pathname: "/train/[vehicleId]", params: { vehicleId } }}
        />
    ) : (
        <Redirect href="/" />
    );
}

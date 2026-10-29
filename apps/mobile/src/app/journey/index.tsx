import { useRouter } from "expo-router";
import { JourneyPlanner } from "../../journey/JourneyPlanner";
import { useTrackOnOpen } from "../../useAnalytics";

/** Journey planner route (see the root layout). */
export default function JourneyScreen() {
    const router = useRouter();
    useTrackOnOpen("planner_opened", { surface: "screen" });
    return (
        <JourneyPlanner
            onPick={(field) =>
                router.push({ pathname: "/journey/pick", params: { field } })
            }
        />
    );
}

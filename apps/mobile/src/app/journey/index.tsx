import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { JourneyPlanner } from "../../journey/JourneyPlanner";
import { plannerFromLink } from "../../journey/link";
import { planner } from "../../journey/store";
import { useTrackOnOpen } from "../../useAnalytics";

/** Journey planner route (see the root layout). */
export default function JourneyScreen() {
    const router = useRouter();
    useTrackOnOpen("planner_opened", { surface: "screen" });
    // A shared journey from the website (see webLinkPath)
    const params = useLocalSearchParams<{
        from?: string;
        to?: string;
        time?: string;
        arriveBy?: string;
    }>();
    const { from, to, time, arriveBy } = params;
    useEffect(() => {
        const shared = plannerFromLink({ from, to, time, arriveBy });
        if (shared) planner.set(shared);
    }, [from, to, time, arriveBy]);
    return (
        <JourneyPlanner
            onPick={(field) =>
                router.push({ pathname: "/journey/pick", params: { field } })
            }
        />
    );
}

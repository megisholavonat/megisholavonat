import { useRouter } from "expo-router";
import { JourneyPlanner } from "../../journey/JourneyPlanner";

/** Journey planner route (see the root layout). */
export default function JourneyScreen() {
    const router = useRouter();
    return (
        <JourneyPlanner
            onPick={(field) =>
                router.push({ pathname: "/journey/pick", params: { field } })
            }
        />
    );
}

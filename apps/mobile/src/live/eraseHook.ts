import { LiveActivity } from "../../modules/live-activity";
import { onErase } from "../privacy/erase";

// "Delete my data" ends every Live Activity and empties the commute widget
onErase(async () => {
    const native = LiveActivity;
    if (!native) return;
    for (const activity of native.list()) {
        await native.end(activity.id, null, true).catch(() => {});
    }
    try {
        native.setWidgetData(
            JSON.stringify({
                updatedAt: Math.round(Date.now() / 1000),
                runs: [],
            }),
        );
    } catch {}
});

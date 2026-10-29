import { registerPushToken } from "@megisholavonat/api-client";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useLocale } from "use-intl";
import {
    type ActivityState,
    LiveActivity,
    type RunningActivity,
} from "../../modules/live-activity";
import { isStatus, withDevice } from "../follow/device";
import type { LiveFollow } from "../follow/live";
import type { LocalFollow, Run } from "../follow/model";
import {
    activityAttributes,
    activityState,
    liveState,
    STALE_MS,
    updateDue,
    wantsActivity,
    widgetRuns,
} from "./model";

// Keeps the iOS Live Activities and the commute widget in step with the
// follows, while the app is open: starts an activity for a run turned on
// and near departure (ActivityKit starts them only from the foreground),
// updates it from the live data, ends it on arrival or unfollow, and hands
// its push token to the API, which updates it from then on.

type Item = { follow: LocalFollow; run: Run; live?: LiveFollow };

/** The widget's data is rewritten at least this often (its delays age) */
const WIDGET_REFRESH_MS = 5 * 60_000;

const sent = new Map<string, { state: ActivityState; at: number }>();
/** `<followId>|<token>` registered with the API */
const registered = new Set<string>();
/** Follows whose activity is being started */
const starting = new Set<string>();
let widget: { key: string; at: number } | null = null;

async function registerToken(
    locale: string,
    followId: string,
    token: string,
): Promise<void> {
    const key = `${followId}|${token}`;
    if (registered.has(key)) return;
    registered.add(key);
    try {
        await withDevice(locale, (auth) =>
            registerPushToken({
                auth,
                body: { type: "liveactivity", token, followId },
                throwOnError: true,
            }),
        );
    } catch (error) {
        // Retried on the next pass, except for a follow the API doesn't know
        if (!isStatus(error, 404)) registered.delete(key);
    }
}

function withoutFinished({
    finished: _,
    ...state
}: ActivityState & { finished: boolean }): ActivityState {
    return state;
}

function stale(now: number): number {
    return (now + STALE_MS) / 1000;
}

let busy = false;

/** One pass over the follows, never two at once; errors wait for the next. */
export async function reconcileActivities(
    items: readonly Item[],
    follows: readonly LocalFollow[],
    locale: string,
    now: Date,
): Promise<void> {
    if (busy) return;
    busy = true;
    try {
        await reconcile(items, follows, locale, now);
    } finally {
        busy = false;
    }
}

async function reconcile(
    items: readonly Item[],
    follows: readonly LocalFollow[],
    locale: string,
    now: Date,
): Promise<void> {
    const native = LiveActivity;
    if (!native) return;

    const running = new Map<string, RunningActivity>();
    for (const activity of native.list())
        running.set(activity.followId, activity);
    const byFollow = new Map(items.map((i) => [i.follow.id, i]));

    for (const [followId, activity] of running) {
        const item = byFollow.get(followId);
        // Only live data updates a running activity: the timetable would
        // overwrite what the API pushed
        const state =
            item?.live && liveState(item.follow, item.live.details, now);
        const keep =
            !!item &&
            wantsActivity(
                item.follow,
                item.run,
                now,
                !!state && state.finished,
            ) &&
            follows.some((f) => f.id === followId);
        if (!keep) {
            sent.delete(activity.id);
            // Arrived: the final state stays a while; otherwise gone at once
            await native
                .end(
                    activity.id,
                    state ? withoutFinished(state) : null,
                    !state?.finished,
                )
                .catch(() => {});
            continue;
        }
        if (activity.token) {
            void registerToken(locale, followId, activity.token);
        }
        if (!state) continue;
        const next = withoutFinished(state);
        const last = sent.get(activity.id);
        if (updateDue(next, last?.state, last?.at, now.getTime())) {
            sent.set(activity.id, { state: next, at: now.getTime() });
            await native
                .update(activity.id, next, stale(now.getTime()))
                .catch(() => {});
        }
    }

    if (AppState.currentState !== "active" || !native.isEnabled()) return;
    for (const item of items) {
        const { follow, run, live } = item;
        if (running.has(follow.id) || starting.has(follow.id)) continue;
        const full = activityState(follow, run, live, now);
        if (!wantsActivity(follow, run, now, full.finished)) continue;
        const state = withoutFinished(full);
        starting.add(follow.id);
        try {
            const id = await native.start(
                activityAttributes(follow),
                state,
                stale(now.getTime()),
            );
            sent.set(id, { state, at: now.getTime() });
        } catch {
            // Turned off in Settings, or too many activities
        } finally {
            starting.delete(follow.id);
        }
    }
}

/** Writes the widget's runs when they change, and every few minutes. */
export function writeWidget(items: readonly Item[], now: Date): void {
    const native = LiveActivity;
    if (!native) return;
    const runs = widgetRuns(items);
    const key = JSON.stringify(runs);
    const at = now.getTime();
    if (widget && widget.key === key && at - widget.at < WIDGET_REFRESH_MS) {
        return;
    }
    widget = { key, at };
    try {
        native.setWidgetData(
            JSON.stringify({ updatedAt: Math.round(at / 1000), runs }),
        );
    } catch {
        widget = null;
    }
}

/** The Live Activities and the widget, driven by home's commute items. */
export function useLiveActivities(
    items: readonly Item[],
    follows: readonly LocalFollow[],
    now: Date,
): void {
    const locale = useLocale();

    // Tokens can arrive (or rotate) after the start
    useEffect(() => {
        const sub = LiveActivity?.addListener("onPushToken", (event) => {
            void registerToken(locale, event.followId, event.token);
        });
        return () => sub?.remove();
    }, [locale]);

    // Items are rebuilt every render: the clock's tick (15 s) and a follow
    // change drive the passes, with the latest items
    const latest = useRef(items);
    useEffect(() => {
        latest.current = items;
    });
    useEffect(() => {
        writeWidget(latest.current, now);
        void reconcileActivities(latest.current, follows, locale, now);
    }, [follows, locale, now]);
}

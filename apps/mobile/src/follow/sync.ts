import {
    createFollow,
    deleteFollow,
    type FollowUpdate,
    listFollows,
    registerPushToken,
    updateFollow,
} from "@megisholavonat/api-client";
import { expoPushToken } from "../notifications";
import { hasDevice, isStatus, withDevice } from "./device";
import {
    createBody,
    type FollowDraft,
    isExpired,
    type LocalFollow,
} from "./model";
import {
    getFollows,
    putFollow,
    removeLocalFollow,
    replaceFollows,
} from "./store";

// Follows on the API (the alert subscriptions) kept in step with the local
// list. The local list is what the app shows; the API is told about every
// change and reconciled on launch.

/** The train being followed, as the follow screen knows it. */
export type FollowTrain = Pick<
    LocalFollow,
    "tripShortName" | "routeShortName" | "stops" | "tripId" | "vehicleId"
> & { serviceDate: string | null };

/** `<device credentials>|<push token>` last registered */
let registeredPush: string | null = null;

/**
 * Registers this device's Expo push token, once per token and API device:
 * a device replaced after a 401 gets it again. Best effort.
 */
export async function registerPush(locale: string): Promise<void> {
    try {
        const token = await expoPushToken();
        if (!token) return;
        await withDevice(locale, async (auth) => {
            const key = `${auth}|${token}`;
            if (key === registeredPush) return;
            await registerPushToken({
                auth,
                body: { type: "expo", token },
                throwOnError: true,
            });
            registeredPush = key;
        });
    } catch {
        // Retried on the next follow or launch
    }
}

/** Registers the push token again next time (after data deletion). */
export function resetPushRegistration(): void {
    registeredPush = null;
}

async function create(
    locale: string,
    body: NonNullable<ReturnType<typeof createBody>>,
): Promise<string> {
    const { result } = await withDevice(locale, async (auth) => {
        try {
            const { data } = await createFollow({
                auth,
                body,
                throwOnError: true,
            });
            return data.id;
        } catch (error) {
            // Already following this trip: adopt that follow
            if (body.kind !== "trip" || !isStatus(error, 409)) throw error;
            const { data } = await listFollows({ auth, throwOnError: true });
            const match = data.find(
                (f) =>
                    f.kind === "trip" &&
                    f.tripId === body.tripId &&
                    f.serviceDate === body.serviceDate,
            );
            if (!match) throw error;
            await updateFollow({
                auth,
                path: { follow_id: match.id },
                body: {
                    delayThresholdMin: body.delayThresholdMin,
                    notifyPlatformChange: body.notifyPlatformChange,
                    alertsEnabled: true,
                },
                throwOnError: true,
            });
            return match.id;
        }
    });
    // A replaced device lost the other follows: the next launch's sync
    // brings them back
    return result;
}

async function remove(locale: string, id: string): Promise<void> {
    await withDevice(locale, async (auth) => {
        try {
            await deleteFollow({
                auth,
                path: { follow_id: id },
                throwOnError: true,
            });
        } catch (error) {
            if (!isStatus(error, 404)) throw error;
        }
    });
}

/** Can `existing` be changed in place, or must it be replaced? */
function patchable(
    existing: LocalFollow,
    body: NonNullable<ReturnType<typeof createBody>>,
    draft: FollowDraft,
): boolean {
    if (existing.kind !== body.kind) return false;
    // A trip's stops cannot be changed after the fact
    return (
        body.kind === "commute" ||
        (existing.from === draft.from && existing.to === draft.to)
    );
}

/** Creates or updates a follow on the API, then locally. */
export async function saveFollow({
    train,
    draft,
    existing,
    locale,
}: {
    train: FollowTrain;
    draft: FollowDraft;
    existing: LocalFollow | null;
    locale: string;
}): Promise<LocalFollow> {
    const body = createBody(train, train.serviceDate, draft);
    if (!body) throw new Error("Incomplete follow");

    let id: string | null = null;
    if (existing && patchable(existing, body, draft)) {
        const patch: FollowUpdate = {
            alertsEnabled: true,
            delayThresholdMin: body.delayThresholdMin,
            notifyPlatformChange: body.notifyPlatformChange,
        };
        if (body.kind === "commute") {
            patch.weekdays = body.weekdays;
            patch.fromStationId = body.fromStationId;
            patch.toStationId = body.toStationId ?? null;
        }
        try {
            const { replaced } = await withDevice(locale, (auth) =>
                updateFollow({
                    auth,
                    path: { follow_id: existing.id },
                    body: patch,
                    throwOnError: true,
                }),
            );
            if (!replaced) id = existing.id;
        } catch (error) {
            if (!isStatus(error, 404)) throw error;
        }
    } else if (existing) {
        await remove(locale, existing.id);
    }
    id ??= await create(locale, body);

    const follow: LocalFollow = {
        id,
        kind: body.kind,
        tripShortName: train.tripShortName,
        routeShortName: train.routeShortName,
        stops: train.stops,
        from: draft.from,
        to: draft.to,
        weekdays: body.kind === "commute" ? draft.weekdays : [],
        tripId: train.tripId,
        serviceDate: body.kind === "trip" ? train.serviceDate : null,
        vehicleId: train.vehicleId,
        delayThresholdMin: draft.delayThresholdMin,
        notifyPlatformChange: draft.notifyPlatformChange,
    };
    putFollow(follow, existing?.id);
    void registerPush(locale);
    return follow;
}

export async function unfollow(follow: LocalFollow, locale: string) {
    await remove(locale, follow.id);
    removeLocalFollow(follow.id);
}

let syncing: Promise<void> | null = null;

/**
 * On launch: drops finished trips, re-creates follows the API lost (a new
 * device after the old one expired), deletes the API's follows this app
 * no longer has (the Keychain keeps the device across an iOS reinstall,
 * but not the follows file), and refreshes the push token.
 */
export function syncFollows(locale: string): Promise<void> {
    syncing ??= (async () => {
        const local = getFollows().filter((f) => !isExpired(f));
        if (local.length !== getFollows().length) replaceFollows(local);
        // Nothing to reconcile on a device never registered
        if (local.length === 0 && !(await hasDevice())) return;
        const { result: remote } = await withDevice(locale, async (auth) => {
            const { data } = await listFollows({ auth, throwOnError: true });
            return data;
        });
        const known = new Set(remote.map((f) => f.id));
        for (const follow of local) {
            if (known.has(follow.id)) continue;
            const body = createBody(follow, follow.serviceDate, follow);
            try {
                if (!body) throw new Error("Incomplete follow");
                putFollow(
                    { ...follow, id: await create(locale, body) },
                    follow.id,
                );
            } catch (error) {
                // Too old to follow again: let it go
                if (isStatus(error, 422) || !body) removeLocalFollow(follow.id);
            }
        }
        // Alerts the app can't show or stop: the user no longer follows them
        for (const { id } of remote) {
            if (getFollows().some((f) => f.id === id)) continue;
            await remove(locale, id).catch(() => {});
        }
        await registerPush(locale);
    })()
        .catch(() => {
            // Offline: try again on the next launch
        })
        .finally(() => {
            syncing = null;
        });
    return syncing;
}

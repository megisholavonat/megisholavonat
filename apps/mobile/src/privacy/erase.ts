import { deleteDevice } from "@megisholavonat/api-client";
import * as SecureStore from "expo-secure-store";
import { queryClient } from "../api";
import { clearDevice, isStatus, storedCredentials } from "../follow/device";
import { clearFollows } from "../follow/store";
import { resetPushRegistration } from "../follow/sync";
import { planner } from "../journey/store";
import { forgetPushToken } from "../notifications";

// "Delete my data": the device on the API (follows, push tokens, alert
// state), then everything this app keeps about the user on the phone.
// Offline, the device's credentials are kept under PENDING_KEY alone (one
// per line) and the deletion is retried on the next launch.

const PENDING_KEY = "pending-erasure";
const OPTIONS: SecureStore.SecureStoreOptions = {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

type Hook = () => unknown;
const hooks = new Set<Hook>();

/**
 * Other on-device state that goes with the user's data. Live Activities
 * register here to end themselves.
 */
export function onErase(hook: Hook): () => void {
    hooks.add(hook);
    return () => {
        hooks.delete(hook);
    };
}

/**
 * Deletes the device on the API. True when it is gone, also when it was
 * already (401: unknown device, 404); false when it couldn't be reached.
 */
async function deleteRemote(auth: string): Promise<boolean> {
    try {
        await deleteDevice({ auth, throwOnError: true });
        return true;
    } catch (error) {
        return isStatus(error, 401) || isStatus(error, 404);
    }
}

/** "deleted", or "pending" when the API is told on a later launch. */
export type EraseResult = "deleted" | "pending";

/**
 * Deletes the user's data on the API and on the phone. Throws only when
 * the device credentials can't be read or kept for later: nothing is
 * deleted then, so the user can try again.
 */
export async function eraseMyData(): Promise<EraseResult> {
    const auth = await storedCredentials();
    const gone = auth ? await deleteRemote(auth) : true;
    if (!gone && auth) {
        const pending = await readPending();
        await writePending([...pending.filter((p) => p !== auth), auth]);
    }

    for (const hook of hooks) {
        try {
            await hook();
        } catch {
            // The rest still goes
        }
    }
    await clearDevice().catch(() => {});
    clearFollows();
    resetPushRegistration();
    await forgetPushToken();
    planner.reset();
    queryClient.clear();

    // An earlier deletion still waiting goes along with this one
    if (gone) await retryPendingErasure();
    return gone ? "deleted" : "pending";
}

async function readPending(): Promise<string[]> {
    const raw = await SecureStore.getItemAsync(PENDING_KEY, OPTIONS);
    return raw ? raw.split("\n").filter(Boolean) : [];
}

async function writePending(pending: string[]): Promise<void> {
    if (pending.length === 0) {
        await SecureStore.deleteItemAsync(PENDING_KEY, OPTIONS);
    } else {
        await SecureStore.setItemAsync(
            PENDING_KEY,
            pending.join("\n"),
            OPTIONS,
        );
    }
}

/** On launch: tells the API about deletions made offline. Best effort. */
export async function retryPendingErasure(): Promise<void> {
    try {
        const pending = await readPending();
        if (pending.length === 0) return;
        const left: string[] = [];
        for (const auth of pending) {
            if (!(await deleteRemote(auth))) left.push(auth);
        }
        if (left.length !== pending.length) await writePending(left);
    } catch {
        // Tried again on the next launch
    }
}

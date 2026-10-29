import { File, Paths } from "expo-file-system";
import { useSyncExternalStore } from "react";
import { type LocalFollow, parseFollows } from "./model";

// Followed trains on this device, in a JSON file next to the settings. Read
// synchronously at startup so home shows them on the first frame.

const file = new File(Paths.document, "follows.json");

function read(): LocalFollow[] {
    try {
        return parseFollows(file.exists ? file.textSync() : null);
    } catch {
        return [];
    }
}

let follows: LocalFollow[] = read();
const listeners = new Set<() => void>();

function set(next: LocalFollow[]): void {
    follows = next;
    file.write(JSON.stringify(next)).catch(() => {
        // Not critical: the next change writes again
    });
    for (const listener of listeners) listener();
}

export function getFollows(): LocalFollow[] {
    return follows;
}

export function putFollow(follow: LocalFollow, replacesId?: string): void {
    const drop = new Set([follow.id, replacesId]);
    set([...follows.filter((f) => !drop.has(f.id)), follow]);
}

export function removeLocalFollow(id: string): void {
    set(follows.filter((f) => f.id !== id));
}

export function replaceFollows(next: LocalFollow[]): void {
    set(next);
}

/** Forgets every follow and deletes the file (data deletion). */
export function clearFollows(): void {
    follows = [];
    try {
        if (file.exists) file.delete();
    } catch {
        // Overwritten with the empty list below instead
        file.write("[]").catch(() => {});
    }
    for (const listener of listeners) listener();
}

/** Remembers the vehicle running a followed train, for the next launch. */
export function rememberVehicle(id: string, vehicleId: string): void {
    const follow = follows.find((f) => f.id === id);
    if (!follow || follow.vehicleId === vehicleId) return;
    putFollow({ ...follow, vehicleId });
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function useFollows(): LocalFollow[] {
    return useSyncExternalStore(subscribe, getFollows);
}

import { useSyncExternalStore } from "react";

// The train shown in the sheet, so the map can ring it and fade the others.
// The sheet is a separate route, so this lives outside React state.

let selected: string | null = null;
const listeners = new Set<() => void>();

export function setSelectedTrain(vehicleId: string | null): void {
    if (selected === vehicleId) return;
    selected = vehicleId;
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function useSelectedTrain(): string | null {
    return useSyncExternalStore(subscribe, () => selected);
}

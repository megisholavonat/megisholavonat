import type { Station } from "@megisholavonat/api-client";
import { useSyncExternalStore } from "react";

// The planner's inputs, shared by the planner and its station picker
// screen. In memory only.

export interface PlannerState {
    from: Station | null;
    to: Station | null;
    /** Unix milliseconds; null is now */
    time: number | null;
    arriveBy: boolean;
}

export type Field = "from" | "to";

const INITIAL: PlannerState = {
    from: null,
    to: null,
    time: null,
    arriveBy: false,
};

let state: PlannerState = INITIAL;
const listeners = new Set<() => void>();

function emit() {
    for (const listener of listeners) listener();
}

export const planner = {
    get: (): PlannerState => state,
    set(patch: Partial<PlannerState>) {
        state = { ...state, ...patch };
        emit();
    },
    /** Set one end; picking the other end's station swaps them. */
    pick(field: Field, station: Station) {
        const other: Field = field === "from" ? "to" : "from";
        if (state[other]?.id === station.id) {
            planner.set({ [field]: station, [other]: state[field] });
        } else {
            planner.set({ [field]: station });
        }
    },
    swap() {
        planner.set({ from: state.to, to: state.from });
    },
    reset() {
        state = INITIAL;
        emit();
    },
    subscribe(listener: () => void) {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    },
};

export function usePlanner(): PlannerState {
    return useSyncExternalStore(planner.subscribe, planner.get, planner.get);
}

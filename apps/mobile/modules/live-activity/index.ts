import { type EventSubscription, requireOptionalNativeModule } from "expo";

// The native side of Live Activities and the commute widget (iOS only; see
// ios/LiveActivityModule.swift). Absent on Android and in Expo Go: every
// call is then a no-op.

/** TrainActivityAttributes in Swift */
export interface ActivityAttributes {
    followId: string;
    badge: string;
    title: string;
    from: string;
    to: string;
    url: string;
}

/** TrainActivityAttributes.ContentState in Swift, and the API's pushes */
export interface ActivityState {
    delayMin: number | null;
    nextStop: string | null;
    nextStopAt: number | null;
    platform: string | null;
    platformSure: boolean;
    eta: number | null;
    progress: number;
    departed: boolean;
}

export interface RunningActivity {
    id: string;
    followId: string;
    token?: string;
}

export interface PushTokenEvent {
    id: string;
    followId: string;
    token: string;
}

interface NativeLiveActivity {
    isEnabled(): boolean;
    list(): RunningActivity[];
    start(
        attributes: ActivityAttributes,
        state: ActivityState,
        stale: number | null,
    ): Promise<string>;
    update(
        id: string,
        state: ActivityState,
        stale: number | null,
    ): Promise<void>;
    end(
        id: string,
        state: ActivityState | null,
        immediately: boolean,
    ): Promise<void>;
    setWidgetData(json: string): void;
    addListener(
        event: "onPushToken",
        listener: (event: PushTokenEvent) => void,
    ): EventSubscription;
    addListener(
        event: "onEnd",
        listener: (event: { id: string; followId: string }) => void,
    ): EventSubscription;
}

export const LiveActivity =
    requireOptionalNativeModule<NativeLiveActivity>("LiveActivity");

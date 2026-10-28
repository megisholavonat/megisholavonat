import type { TrainSheetProps } from "./TrainSheet.types";

/**
 * iOS presents the train as a native form sheet route
 * (src/app/train/[vehicleId].tsx), so there is nothing to render in place.
 * Android uses TrainSheet.android.tsx.
 */
export function TrainSheet(_props: TrainSheetProps) {
    return null;
}

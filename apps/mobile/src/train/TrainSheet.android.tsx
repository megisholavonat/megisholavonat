import {
    Host,
    ModalBottomSheet,
    type ModalBottomSheetRef,
    RNHostView,
} from "@expo/ui/jetpack-compose";
import { useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import type { TrainSheetProps } from "./TrainSheet.types";
import { TrainSummary } from "./TrainSummary";

/**
 * Android: a Material 3 ModalBottomSheet (Jetpack Compose, via Expo UI) that
 * opens partially expanded and can be dragged up or dismissed.
 */
export function TrainSheet({ vehicleId, onClose }: TrainSheetProps) {
    const sheetRef = useRef<ModalBottomSheetRef>(null);
    // Keep the last train mounted while the hide animation runs.
    const [shownId, setShownId] = useState(vehicleId);

    useEffect(() => {
        if (vehicleId) {
            setShownId(vehicleId);
            return;
        }
        let cancelled = false;
        sheetRef.current?.hide().then(() => {
            if (!cancelled) setShownId(null);
        });
        return () => {
            cancelled = true;
        };
    }, [vehicleId]);

    if (!shownId) return null;

    return (
        // Fill the parent so the zero-size host isn't detached.
        <Host style={StyleSheet.absoluteFill} pointerEvents="none">
            <ModalBottomSheet ref={sheetRef} onDismissRequest={onClose}>
                <RNHostView matchContents>
                    <TrainSummary vehicleId={shownId} />
                </RNHostView>
            </ModalBottomSheet>
        </Host>
    );
}

import { useNavigation } from "expo-router";
import { useEffect } from "react";
import { setSheet } from "./focus";

type SheetDetentEvent = { data: { index: number; stable: boolean } };
type Navigation = {
    addListener: (
        event: "sheetDetentChange",
        listener: (event: SheetDetentEvent) => void,
    ) => () => void;
};

/**
 * Tells the map how much of the screen this sheet route covers, from its
 * first detent and then as the user drags it, so a fly keeps its target in
 * the part of the map still in view.
 */
export function useSheetFocus(id: string, detents: readonly number[]): void {
    const navigation = useNavigation() as unknown as Navigation;
    useEffect(() => {
        setSheet(id, detents[0] ?? null);
        const remove = navigation.addListener("sheetDetentChange", (e) => {
            // Android reports drags too; only where the sheet settles counts
            if (!e.data.stable) return;
            setSheet(id, detents[e.data.index] ?? null);
        });
        return () => {
            remove();
            setSheet(id, null);
        };
    }, [id, detents, navigation]);
}

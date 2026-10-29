"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import type { TrainView } from "@/components/train/useTrainView";
import { documentTitle, trainTitle } from "@/lib/og/metadata";
import { destinationOf, trainName, trainNumber } from "@/lib/train";

/**
 * Keeps the tab title on what the map shows ("650 TOKAJ → Budapest-Keleti ·
 * Mégis hol a vonat?"), as the server titles a shared link. The map moves
 * between selections with the history API, which never asks the server for
 * new metadata, so the title follows here. While a selection is still
 * loading its name, the title it had stays.
 */
export function useMapTitle({
    selectedId,
    train,
    stationId,
    stationName,
}: {
    selectedId: string | null;
    train: TrainView | null;
    stationId: string | null;
    stationName: string | null | undefined;
}) {
    const appTitle = useTranslations("Home")("app_title");
    let subject: string | null | undefined = null;
    if (selectedId) {
        const vehicle = train?.vehicle;
        subject =
            vehicle?.vehicleId === selectedId
                ? trainTitle({
                      number: trainNumber(vehicle.trip.tripShortName),
                      name: trainName(vehicle.trip.tripShortName),
                      destination: destinationOf(vehicle),
                  })
                : undefined;
    } else if (stationId) {
        subject = stationName ?? undefined;
    }
    useEffect(() => {
        if (subject === undefined) return;
        const wanted = documentTitle(appTitle, subject);
        const apply = () => {
            if (document.title !== wanted) document.title = wanted;
        };
        apply();
        // Next streams the server's <title> in after hydration (and puts it
        // back on its own navigations): keep ours on top of it
        const observer = new MutationObserver(apply);
        observer.observe(document.head, {
            childList: true,
            subtree: true,
            characterData: true,
        });
        return () => observer.disconnect();
    }, [appTitle, subject]);
}

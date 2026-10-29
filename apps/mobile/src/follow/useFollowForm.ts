import {
    getTrainDetailsOptions,
    getTrainStationHistoryOptions,
} from "@megisholavonat/api-client/react-query";
import { formatSecondsAsTime } from "@megisholavonat/core/time";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, AppState, Linking } from "react-native";
import { useFormatter, useLocale, useTranslations } from "use-intl";
import { track, trackFollowSaved } from "../analytics";
import {
    getNotificationPermission,
    requestNotificationPermission,
} from "../notifications";
import { beforeDeparture, isUsuallyLate, trainTitle } from "../train/trainData";
import {
    createBody,
    defaultDraft,
    draftOf,
    type FollowDraft,
    findFollowFor,
    stopOptions,
    THRESHOLDS_MIN,
    toggleWeekday,
    trainNumber,
    WEEKDAYS,
    withFrom,
} from "./model";
import { useFollows } from "./store";
import { type FollowTrain, saveFollow, unfollow } from "./sync";

const HISTORY_STALE_MS = 6 * 3600_000;
/** 2026-10-26 was a Monday: day names come from the formatter */
const MONDAY = Date.UTC(2026, 9, 26, 12);

function checkDenied(setDenied: (denied: boolean) => void) {
    getNotificationPermission()
        .then((p) => setDenied(!p.granted && !p.canAskAgain))
        .catch(() => {});
}

/** Notifications can no longer be asked for: only Settings can turn them on. */
function usePermissionDenied(): [boolean, () => void] {
    const [denied, setDenied] = useState(false);
    useEffect(() => {
        checkDenied(setDenied);
        // Back from the system settings
        const sub = AppState.addEventListener("change", (state) => {
            if (state === "active") checkDenied(setDenied);
        });
        return () => sub.remove();
    }, []);
    return [denied, () => checkDenied(setDenied)];
}

/**
 * The data behind both follow screens (SwiftUI and Compose): the train, the
 * draft being edited, and save / stop following.
 */
export function useFollowForm({
    vehicleId,
    followId,
}: {
    vehicleId?: string;
    followId?: string;
}) {
    const t = useTranslations("Follow");
    const format = useFormatter();
    const locale = useLocale();
    const router = useRouter();
    const follows = useFollows();

    const { data: details, isError } = useQuery({
        ...getTrainDetailsOptions({ path: { vehicle_id: vehicleId ?? "" } }),
        enabled: !!vehicleId,
    });

    const existing =
        (followId
            ? follows.find((f) => f.id === followId)
            : details
              ? findFollowFor(follows, details)
              : null) ?? null;

    // An existing follow keeps its stops (the draft indexes into them)
    let train: FollowTrain | null = null;
    if (existing) {
        const sameTrip =
            existing.kind === "trip" ||
            (details &&
                trainNumber(details.trip.tripShortName) ===
                    trainNumber(existing.tripShortName));
        train = {
            tripShortName: existing.tripShortName,
            routeShortName: existing.routeShortName,
            stops: existing.stops,
            tripId:
                existing.kind === "trip"
                    ? existing.tripId
                    : sameTrip && details
                      ? (details.trip.gtfsId ?? null)
                      : null,
            serviceDate:
                existing.kind === "trip"
                    ? existing.serviceDate
                    : sameTrip && details
                      ? details.trip.serviceDate
                      : null,
            vehicleId: details?.vehicleId ?? existing.vehicleId,
        };
    } else if (details) {
        train = {
            tripShortName: details.trip.tripShortName,
            routeShortName: details.trip.route.shortName ?? null,
            stops: stopOptions(details),
            tripId: details.trip.gtfsId ?? null,
            serviceDate: details.trip.serviceDate,
            vehicleId: details.vehicleId,
        };
    }

    const [edited, setEdited] = useState<FollowDraft | null>(null);
    const draft: FollowDraft | null =
        edited ??
        (existing ? draftOf(existing) : details ? defaultDraft(details) : null);
    const change = (patch: (d: FollowDraft) => FollowDraft) => {
        if (draft) setEdited(patch(draft));
    };

    const [busy, setBusy] = useState(false);
    const [denied, refreshPermission] = usePermissionDenied();

    const board = train && draft ? train.stops[draft.from] : undefined;
    const number = train ? trainNumber(train.tripShortName) : "";
    const notYetDeparted = details ? beforeDeparture(details) : true;
    const { data: history } = useQuery({
        ...getTrainStationHistoryOptions({
            path: { trainNumber: number, stationId: board?.stationId ?? "" },
        }),
        enabled: notYetDeparted && !!number && !!board?.stationId,
        staleTime: HISTORY_STALE_MS,
    });

    const title = train
        ? trainTitle(train.tripShortName, train.stops.at(-1)?.name ?? null)
        : null;
    const stopLabel = (i: number) => {
        const stop = train?.stops[i];
        return stop
            ? t("stop_time", {
                  name: stop.name,
                  time: formatSecondsAsTime(stop.time),
              })
            : "";
    };
    const stopCount = train?.stops.length ?? 0;
    const boardOptions = Array.from(
        { length: Math.max(0, stopCount - 1) },
        (_, i) => ({
            value: i,
            label: stopLabel(i),
        }),
    );
    const alightOptions = draft
        ? Array.from({ length: stopCount - draft.from - 1 }, (_, i) => ({
              value: draft.from + 1 + i,
              label: stopLabel(draft.from + 1 + i),
          }))
        : [];

    const canSave =
        !busy &&
        !!train &&
        !!draft &&
        createBody(train, train.serviceDate, draft) !== null;

    const close = () => router.back();

    const save = async () => {
        if (!train || !draft || !canSave) return;
        setBusy(true);
        try {
            // Asked here, when it is clear what the notifications are for
            const permission = await requestNotificationPermission(
                t("channel"),
            ).catch(() => null);
            refreshPermission();
            await saveFollow({ train, draft, existing, locale });
            trackFollowSaved(draft.weekdays.length, !existing, permission);
            close();
        } catch {
            Alert.alert(t("error"));
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        if (!existing) return;
        setBusy(true);
        try {
            await unfollow(existing, locale);
            track("follow_removed", {
                kind: existing.weekdays.length > 0 ? "commute" : "single",
            });
            close();
        } catch {
            Alert.alert(t("error"));
        } finally {
            setBusy(false);
        }
    };

    return {
        t,
        loading: !train && !isError && !!vehicleId,
        notFound: !train && (isError || !vehicleId),
        existing,
        train,
        title,
        usuallyLate: notYetDeparted && isUsuallyLate(history),
        draft,
        weekdays: WEEKDAYS.map((day) => ({
            day,
            label: t(`day_${day}`),
            name: format.dateTime(new Date(MONDAY + (day - 1) * 86_400_000), {
                weekday: "long",
                timeZone: "UTC",
            }),
            selected: draft?.weekdays.includes(day) ?? false,
        })),
        toggleDay: (day: number) =>
            change((d) => ({ ...d, weekdays: toggleWeekday(d.weekdays, day) })),
        boardOptions,
        alightOptions,
        setFrom: (from: number) => change((d) => withFrom(d, from)),
        setTo: (to: number) => change((d) => ({ ...d, to })),
        thresholds: THRESHOLDS_MIN.map((minutes) => ({
            value: minutes,
            label: t("threshold", { minutes }),
        })),
        setThreshold: (delayThresholdMin: number) =>
            change((d) => ({ ...d, delayThresholdMin })),
        setPlatform: (notifyPlatformChange: boolean) =>
            change((d) => ({ ...d, notifyPlatformChange })),
        notificationsDenied: denied,
        openSettings: () => Linking.openSettings(),
        busy,
        canSave,
        save,
        remove,
        close,
    };
}

export type FollowForm = ReturnType<typeof useFollowForm>;

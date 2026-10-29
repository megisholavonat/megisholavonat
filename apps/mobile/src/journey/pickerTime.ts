import { budapestTime, fromBudapestTime } from "@megisholavonat/core/time";

// The Android date and time dialogs work in the device's time zone, while
// trains (and the planner's label) run on Budapest time. A visitor's phone
// may still be on home time, so the dialogs get Budapest wall-clock times
// dressed as device-local ones, and their answers are read back the same
// way. Pure, unit tested.

/** For the time dialog: a device-local date showing `ms`'s Budapest time. */
export function timeDialogDate(ms: number): Date {
    const b = budapestTime(ms);
    return new Date(b.year, b.month - 1, b.day, b.hour, b.minute);
}

/** For the date dialog (UTC midnight): `ms`'s Budapest calendar day. */
export function dateDialogDate(ms: number): Date {
    const b = budapestTime(ms);
    return new Date(Date.UTC(b.year, b.month - 1, b.day));
}

/** The first selectable day: today in Budapest, as device-local midnight. */
export function budapestToday(now: number = Date.now()): Date {
    const b = budapestTime(now);
    return new Date(b.year, b.month - 1, b.day);
}

/** `current` moved to the day picked in the date dialog (UTC midnight). */
export function withPickedDate(current: number, picked: Date): number {
    return fromBudapestTime({
        ...budapestTime(current),
        year: picked.getUTCFullYear(),
        month: picked.getUTCMonth() + 1,
        day: picked.getUTCDate(),
    });
}

/** `current` at the time of day picked in the time dialog (device-local). */
export function withPickedTime(current: number, picked: Date): number {
    return fromBudapestTime({
        ...budapestTime(current),
        hour: picked.getHours(),
        minute: picked.getMinutes(),
    });
}

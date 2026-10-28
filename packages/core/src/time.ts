import { DateTime } from "luxon";

const BUDAPEST_TZ = "Europe/Budapest";

export function getSecondsSinceDay(sinceDate: string, date: Date = new Date()) {
    const budapestDate = DateTime.fromJSDate(date, { zone: BUDAPEST_TZ });

    const hours = budapestDate.hour;
    const minutes = budapestDate.minute;
    const seconds = budapestDate.second;

    const secondsSinceMidnight = hours * 3600 + minutes * 60 + seconds;

    const sinceDateLocal = DateTime.fromISO(sinceDate, { zone: BUDAPEST_TZ });

    const daysSince = Math.floor(
        budapestDate.diff(sinceDateLocal, "days").days,
    );

    return secondsSinceMidnight + daysSince * 86400;
}

export function formatSecondsAsTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600) % 24;
    const minutes = Math.floor((seconds % 3600) / 60);

    const h = hours < 10 ? `0${hours}` : String(hours);
    const m = minutes < 10 ? `0${minutes}` : String(minutes);

    return `${h}:${m}`;
}

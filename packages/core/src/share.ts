/**
 * Share links and the short texts that go with them, for the web share
 * button, the native share sheet and the link previews (og tags).
 */

import { getDelayLevel } from "./delay";
import type { Locale } from "./i18n";

export const SITE_URL = "https://megisholavonat.info";

/** Link that opens a train or a station on the map. */
export function shareUrl(
    origin: string,
    locale: Locale,
    target: { vehicleId: string } | { station: string },
): string {
    const [key, value] =
        "vehicleId" in target
            ? ["vehicleId", target.vehicleId]
            : ["station", target.station];
    return `${origin.replace(/\/$/, "")}/${locale}?${key}=${encodeURIComponent(value)}`;
}

/** Hungarian "-s" suffix by the last pronounced number word ("10-es"). */
const ONES = ["", "es", "es", "as", "es", "ös", "os", "es", "as", "es"];
const TENS = ["", "es", "as", "as", "es", "es", "as", "es", "as", "es"];

function huSuffix(n: number): string {
    if (n === 0) return "s";
    if (n % 10 !== 0) return ONES[n % 10] ?? "es";
    if (n % 100 !== 0) return TENS[(n / 10) % 10] ?? "es";
    if (n % 1000 !== 0) return "as"; // száz
    return "es"; // ezer
}

/** Whether the spoken number starts with a vowel (egy, öt, ezer...). */
function huVowelStart(n: number): boolean {
    let lead = n;
    while (lead >= 1000) lead = Math.floor(lead / 1000);
    if (n >= 1000 && lead === 1) return true; // ezer
    const first = Number(String(lead)[0]);
    if (lead < 10) return first === 1 || first === 5; // egy, öt
    return first === 5; // ötven, ötszáz
}

/** "A 10-es vonat", "Az 5-ös vonat", "A H8000 vonat". */
export function huTrainSubject(number: string): string {
    if (!/^\d+$/.test(number)) return `A ${number} vonat`;
    const n = Number(number);
    return `${huVowelStart(n) ? "Az" : "A"} ${number}-${huSuffix(n)} vonat`;
}

export interface TrainShareInfo {
    /** Train number, "10" */
    number: string;
    /** Minutes late now */
    delay: number;
    /** Still at its first stop, before departure */
    waiting: boolean;
    /** Next stop and its expected time ("02:06") */
    next: { name: string; time: string } | null;
}

/** "A 10-es vonat +9 perc késésben, Debrecen 02:06" */
export function trainShareText(locale: Locale, info: TrainShareInfo): string {
    const onTime = getDelayLevel(info.delay) === "onTime";
    const late = Math.round(info.delay);
    let status: string;
    if (locale === "hu") {
        status = info.waiting
            ? "indulásra vár"
            : onTime
              ? "pontos"
              : `+${late} perc késésben`;
        status = `${huTrainSubject(info.number)} ${status}`;
    } else {
        status = info.waiting
            ? "waiting to depart"
            : onTime
              ? "on time"
              : `running ${late} min late`;
        status = `Train ${info.number} is ${status}`;
    }
    return info.next
        ? `${status}, ${info.next.name} ${info.next.time}`
        : status;
}

export interface DepartureShareInfo {
    /** "04:10", the scheduled time */
    time: string;
    headsign: string;
    delay: number;
    canceled: boolean;
}

/** "04:00 Miskolc-Tiszai pontos" */
export function departureText(
    locale: Locale,
    departure: DepartureShareInfo,
): string {
    const status = departure.canceled
        ? locale === "hu"
            ? "törölve"
            : "cancelled"
        : getDelayLevel(departure.delay) === "onTime"
          ? locale === "hu"
              ? "pontos"
              : "on time"
          : `+${Math.round(departure.delay)}`;
    return `${departure.time} ${departure.headsign} ${status}`;
}

/** "Indulások: 04:00 Miskolc-Tiszai pontos · 04:10 Szolnok +3" */
export function stationShareText(
    locale: Locale,
    departures: DepartureShareInfo[],
): string {
    const label = locale === "hu" ? "Indulások" : "Departures";
    if (departures.length === 0) {
        return locale === "hu"
            ? "Indulások és késések élőben"
            : "Live departures and delays";
    }
    return `${label}: ${departures.map((d) => departureText(locale, d)).join(" · ")}`;
}

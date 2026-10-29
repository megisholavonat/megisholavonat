/**
 * Share links and the short texts of their link previews (og title and
 * description). Sharing sends the link alone, never a prefilled message:
 * the preview carries what the train or station is doing.
 */

import { getDelayLevel, roundMinutes } from "./delay";
import type { TrainDisplay } from "./display";
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

export function huSuffix(n: number): string {
    if (n === 0) return "s";
    if (n % 10 !== 0) return ONES[n % 10] ?? "es";
    if (n % 100 !== 0) return TENS[(n / 10) % 10] ?? "es";
    if (n % 1000 !== 0) return "as"; // száz
    return "es"; // ezer
}

/** Whether the spoken number starts with a vowel (egy, öt, ezer...). */
export function huVowelStart(n: number): boolean {
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

/**
 * What a shared train is doing. Only a running train has a delay to tell;
 * the others say why not, as the map and the sheet do. `offRoute`: its
 * position is fresh, but off its trip's route, so its delay is unknown;
 * `noData`: no fresh position.
 */
export type TrainShareStatus =
    | "running"
    | "waiting"
    | "cancelled"
    | "arrived"
    | "offRoute"
    | "noData";

/** The share status of a train by its `trainDisplay`. */
export function trainShareStatus(display: TrainDisplay): TrainShareStatus {
    switch (display.state) {
        case "running":
            return "running";
        case "cancelled":
            return "cancelled";
        case "idle":
            return display.activity === "beforeDeparture"
                ? "waiting"
                : display.activity === "arrived"
                  ? "arrived"
                  : display.activity === "offRoute" && !display.outdated
                    ? "offRoute"
                    : "noData";
        default:
            return "noData";
    }
}

export interface TrainShareInfo {
    /** Train number, "10" */
    number: string;
    /** Minutes late now; told only while running */
    delay: number;
    /** Still at its first stop, before departure */
    waiting: boolean;
    /** Wins over `waiting` when given */
    status?: TrainShareStatus;
    /**
     * Next stop and its expected time ("02:06"); `estimated` when the time
     * is a forecast (told with "≈", as in the sheet)
     */
    next: { name: string; time: string; estimated?: boolean } | null;
}

/** "A 10-es vonat 9 percet késik, Debrecen ≈02:06": a train link's description */
export function trainShareText(locale: Locale, info: TrainShareInfo): string {
    const state = info.status ?? (info.waiting ? "waiting" : "running");
    const onTime = getDelayLevel(info.delay) === "onTime";
    const late = roundMinutes(info.delay);
    const subject =
        locale === "hu" ? huTrainSubject(info.number) : `Train ${info.number}`;
    const status =
        locale === "hu"
            ? {
                  running: `${subject} ${onTime ? "pontos" : `${late} percet késik`}`,
                  waiting: `${subject} indulásra vár`,
                  cancelled: `${subject} törölve`,
                  arrived: `${subject} megérkezett`,
                  offRoute: `${subject} késése most nem ismert`,
                  noData: `${subject}ról nincs friss adat`,
              }[state]
            : {
                  running: `${subject} is ${onTime ? "on time" : `${late} min late`}`,
                  waiting: `${subject} is waiting to depart`,
                  cancelled: `${subject} is cancelled`,
                  arrived: `${subject} has arrived`,
                  offRoute: `${subject}'s delay is unknown right now`,
                  noData: `No fresh data on train ${info.number}`,
              }[state];
    // The next stop's expected time goes with the delay: only for a train
    // on its way
    if (!info.next || (state !== "running" && state !== "waiting")) {
        return status;
    }
    const time = `${info.next.estimated ? "≈" : ""}${info.next.time}`;
    return `${status}, ${info.next.name} ${time}`;
}

export interface DepartureShareInfo {
    /** "04:10", the scheduled time */
    time: string;
    headsign: string;
    /**
     * Minutes late; null when there is no live delay to tell (a train still
     * waiting to leave on time is not "on time" yet, as on the board)
     */
    delay: number | null;
    canceled: boolean;
}

/** "04:00 Miskolc-Tiszai pontos", "04:10 Szolnok" before it is live */
export function departureText(
    locale: Locale,
    departure: DepartureShareInfo,
): string {
    const plain = `${departure.time} ${departure.headsign}`;
    if (!departure.canceled && departure.delay === null) return plain;
    const status = departure.canceled
        ? locale === "hu"
            ? "törölve"
            : "cancelled"
        : getDelayLevel(departure.delay ?? 0) === "onTime"
          ? locale === "hu"
              ? "pontos"
              : "on time"
          : `+${roundMinutes(departure.delay ?? 0)}`;
    return `${plain} ${status}`;
}

/**
 * A station link's preview title: "Szolnok – indulások élőben", so the
 * card says what the link opens even where the site name is not shown.
 */
export function stationShareTitle(locale: Locale, name: string): string {
    return `${name} – ${locale === "hu" ? "indulások élőben" : "live departures"}`;
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

/**
 * Short labels for MÁV's per-train delay reason alerts.
 *
 * Rail trips carry alerts such as "Pálya állapota miatti késés". Known reasons
 * map to a stable code and a one- or two-word label for cards; anything else
 * maps to null and is only shown in full in detail views.
 *
 * Mirrors apps/api/api/util/delay_reasons.py, which the API uses to fill the
 * `reason` fields. apps/api/tests/test_delay_reasons.py keeps the two in sync.
 */
import type { Locale } from "./i18n";

export type DelayReasonCode =
    | "track"
    | "technical"
    | "other_train"
    | "dwell"
    | "partner_railway"
    | "connection"
    | "signalling"
    | "external"
    | "weather"
    | "construction"
    | "accident"
    | "switch"
    | "operational"
    | "overhead_line"
    | "police"
    | "vandalism"
    | "replacement_bus";

export interface DelayReasonInfo {
    hu: string;
    en: string;
    /** Suggested lucide icon name */
    icon: string;
}

export const DELAY_REASONS: Record<DelayReasonCode, DelayReasonInfo> = {
    track: { hu: "Pályahiba", en: "Track issue", icon: "construction" },
    technical: { hu: "Műszaki hiba", en: "Technical fault", icon: "wrench" },
    other_train: { hu: "Más vonat", en: "Other train", icon: "train-front" },
    dwell: { hu: "Hosszú állás", en: "Long dwell", icon: "timer" },
    partner_railway: { hu: "Társvasút", en: "Partner railway", icon: "globe" },
    connection: {
        hu: "Csatlakozásra vár",
        en: "Held for connection",
        icon: "git-merge",
    },
    signalling: { hu: "Jelzőhiba", en: "Signal fault", icon: "traffic-cone" },
    external: { hu: "Külső ok", en: "External cause", icon: "circle-alert" },
    weather: { hu: "Időjárás", en: "Weather", icon: "cloud-lightning" },
    construction: {
        hu: "Pályaépítés",
        en: "Engineering works",
        icon: "hard-hat",
    },
    accident: { hu: "Baleset", en: "Accident", icon: "siren" },
    switch: { hu: "Váltóhiba", en: "Points failure", icon: "split" },
    operational: { hu: "Forgalmi ok", en: "Operational", icon: "list-ordered" },
    overhead_line: { hu: "Felsővezeték", en: "Overhead line", icon: "zap-off" },
    police: { hu: "Hatósági intézkedés", en: "Police action", icon: "shield" },
    vandalism: { hu: "Rongálás", en: "Vandalism", icon: "hammer" },
    replacement_bus: { hu: "Pótlóbusz", en: "Replacement bus", icon: "bus" },
};

/** Normalised alert text (see normalizeAlertText) -> reason code */
export const DELAY_REASON_TEXTS: Record<string, DelayReasonCode> = {
    "pálya állapota miatti késés": "track",
    "vonat műszaki hibája miatti késés": "technical",
    "műszaki ok miatti késés vonatnál": "technical",
    "más vonat által okozott késés": "other_train",
    "más vonattól átvett késés": "other_train",
    "tartózkodási idő túllépése": "dwell",
    "társvasúttól átvett késés": "partner_railway",
    "csatlakozásra várás miatti késés": "connection",
    "biztosítóberendezési hiba miatti késés": "signalling",
    "biztosítóberendezési meghibásodás miatti késés": "signalling",
    "vasútüzemen kívülálló ok miatti késés": "external",
    "időjárási ok miatti késés": "weather",
    "pályaépítés miatti késés": "construction",
    "baleset miatti késés": "accident",
    "váltó meghibásodás miatti késés": "switch",
    "forgalmi ok miatti késés": "operational",
    "felsővezetéki hiba miatti késés": "overhead_line",
    "hatósági intézkedés miatti késés": "police",
    "rongálás miatti késés": "vandalism",
    "vonatpótló busz miatti késés": "replacement_bus",
};

/**
 * Templated variants, matched in order against the normalised text. The first
 * five are "<where> <cause> miatt várakozik", e.g. "Győrben műszaki hiba miatt
 * várakozik".
 */
export const DELAY_REASON_PATTERNS: [RegExp, DelayReasonCode][] = [
    [
        /^(?:a vonat )?(?:[^.]{1,60} )?(?:műszaki (?:hiba|ok|meghibásodás|hibás szerelvény)) miatt várakozik/,
        "technical",
    ],
    [
        /^(?:a vonat )?(?:[^.]{1,60} )?(?:felsővezeték(?:i hiba|-szakadás| szakadás)) miatt várakozik/,
        "overhead_line",
    ],
    [
        /^(?:a vonat )?(?:[^.]{1,60} )?(?:(?:közúti )?baleset) miatt várakozik/,
        "accident",
    ],
    [
        /^(?:a vonat )?(?:[^.]{1,60} )?(?:(?:hatósági|rendőri) intézkedés) miatt várakozik/,
        "police",
    ],
    [
        /^(?:a vonat )?(?:[^.]{1,60} )?(?:biztosítóberendezési (?:hiba|meghibásodás)) miatt várakozik/,
        "signalling",
    ],
    [
        /^biztosítóberendezési hiba miatt a vonatok hosszabb menetidővel közleked(?:het)?nek$/,
        "signalling",
    ],
    [
        /^várhatóan [0-9]+(?:-[0-9]+)? perces késéssel érkezik a magyarországi szakaszra$/,
        "partner_railway",
    ],
];

/** Collapse whitespace, lowercase and drop trailing full stops. */
export function normalizeAlertText(text: string): string {
    return text
        .trim()
        .split(/\s+/)
        .join(" ")
        .toLowerCase()
        .replace(/[. ]+$/, "");
}

/** Reason code of an alert text, or null if it is not a known reason. */
export function delayReasonCode(
    text: string | null | undefined,
): DelayReasonCode | null {
    if (!text) return null;
    const normalized = normalizeAlertText(text);
    if (Object.hasOwn(DELAY_REASON_TEXTS, normalized))
        return DELAY_REASON_TEXTS[normalized];
    for (const [pattern, patternCode] of DELAY_REASON_PATTERNS) {
        if (pattern.test(normalized)) return patternCode;
    }
    return null;
}

export function delayReasonLabel(
    code: DelayReasonCode,
    locale: Locale,
): string {
    return DELAY_REASONS[code][locale];
}

/** Short label of an alert text in the given locale, or null if unknown. */
export function delayReasonLabelOf(
    text: string | null | undefined,
    locale: Locale,
): string | null {
    const code = delayReasonCode(text);
    return code ? delayReasonLabel(code, locale) : null;
}

import { LOCALES, type Locale } from "@megisholavonat/core/i18n";
import { DISPLAY_RULES } from "@megisholavonat/core/tokens";

// Pure settings model: defaults, parsing of the stored JSON and the consent
// rule. No react-native imports, so it is unit tested under Node.

export type ThemePreference = "system" | "light" | "dark";
/** null follows the device language */
export type LanguagePreference = Locale | null;
export type AnalyticsConsent = "unknown" | "granted" | "denied";

export interface Settings {
    language: LanguagePreference;
    theme: ThemePreference;
    /** Android Material You colours; off by default (design system rule) */
    dynamicColor: boolean;
    /** OpenRailwayMap raster overlay ("Detailed railway map"), opt-in */
    railwayLayer: boolean;
    analytics: AnalyticsConsent;
    /** App launches so far, this one included */
    launchCount: number;
    /** A train sheet has been opened at least once */
    openedTrain: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
    language: null,
    theme: "system",
    dynamicColor: DISPLAY_RULES.androidDynamicColorDefault,
    railwayLayer: false,
    analytics: "unknown",
    launchCount: 0,
    openedTrain: false,
};

const THEMES: readonly ThemePreference[] = ["system", "light", "dark"];
const CONSENTS: readonly AnalyticsConsent[] = ["unknown", "granted", "denied"];

function oneOf<T>(values: readonly T[], value: unknown, fallback: T): T {
    return values.includes(value as T) ? (value as T) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

/** Settings from stored JSON; unknown or invalid fields fall back to defaults. */
export function parseSettings(json: string | null | undefined): Settings {
    let raw: Record<string, unknown> = {};
    try {
        const parsed: unknown = json ? JSON.parse(json) : {};
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            raw = parsed as Record<string, unknown>;
        }
    } catch {
        // Corrupt file: start over with the defaults
    }
    const d = DEFAULT_SETTINGS;
    const launchCount = raw.launchCount;
    return {
        language: oneOf<LanguagePreference>(
            [null, ...LOCALES],
            raw.language,
            d.language,
        ),
        theme: oneOf(THEMES, raw.theme, d.theme),
        dynamicColor: bool(raw.dynamicColor, d.dynamicColor),
        railwayLayer: bool(raw.railwayLayer, d.railwayLayer),
        analytics: oneOf(CONSENTS, raw.analytics, d.analytics),
        launchCount:
            typeof launchCount === "number" &&
            Number.isInteger(launchCount) &&
            launchCount >= 0
                ? launchCount
                : d.launchCount,
        openedTrain: bool(raw.openedTrain, d.openedTrain),
    };
}

/**
 * The analytics consent card: a non-blocking card from the second launch on,
 * once a train has been opened, until the user answers. Never on a launch
 * that came from a link or a notification.
 */
export function shouldAskConsent(
    settings: Settings,
    launchedFromLink: boolean,
): boolean {
    return (
        settings.analytics === "unknown" &&
        settings.launchCount >= 2 &&
        settings.openedTrain &&
        !launchedFromLink
    );
}

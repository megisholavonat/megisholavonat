import { useLinkingURL } from "expo-linking";
import { useLastNotificationResponse } from "expo-notifications";
import {
    createContext,
    type ReactNode,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";
import { type Settings, shouldAskConsent } from "./settings";
import { readSettings, writeSettings } from "./storage";

interface SettingsContextValue {
    settings: Settings;
    update: (patch: Partial<Settings>) => void;
    /** Show the analytics consent card on this launch */
    askConsent: boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

/** Opened through a train or station link rather than the launcher. */
function isContentLink(url: string | null): boolean {
    return url !== null && /\/(train|station)\//.test(url);
}

export function SettingsProvider({ children }: { children: ReactNode }) {
    // Counted once per cold start
    const [settings, setSettings] = useState<Settings>(() => {
        const stored = readSettings();
        return { ...stored, launchCount: stored.launchCount + 1 };
    });
    const url = useLinkingURL();
    const notification = useLastNotificationResponse();

    // Decided on the launch values only, so the card doesn't pop up mid-session
    const [launch] = useState(settings);
    const askConsent = shouldAskConsent(
        { ...launch, analytics: settings.analytics },
        isContentLink(url) || !!notification,
    );

    useEffect(() => {
        writeSettings(settings);
    }, [settings]);

    const update = useCallback((patch: Partial<Settings>) => {
        setSettings((current) => ({ ...current, ...patch }));
    }, []);

    const value = useMemo(
        () => ({ settings, update, askConsent }),
        [settings, update, askConsent],
    );

    return (
        <SettingsContext.Provider value={value}>
            {children}
        </SettingsContext.Provider>
    );
}

export function useSettings(): SettingsContextValue {
    const value = useContext(SettingsContext);
    if (!value) throw new Error("useSettings outside SettingsProvider");
    return value;
}

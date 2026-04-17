"use client";

import * as React from "react";

const STORAGE_KEY = "theme";

type ThemePreference = "light" | "dark" | "system";

function getSystemTheme(): "light" | "dark" {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
}

function parseTheme(raw: string | null): ThemePreference {
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
    return "system";
}

function applyDomTheme(resolved: "light" | "dark") {
    const root = document.documentElement;
    root.classList.toggle("dark", resolved === "dark");
    root.style.colorScheme = resolved === "dark" ? "dark" : "light";
}

export interface UseThemeProps {
    themes: string[];
    theme?: string;
    setTheme: React.Dispatch<React.SetStateAction<string>>;
    resolvedTheme?: string;
    systemTheme?: "light" | "dark";
}

const ThemeContext = React.createContext<UseThemeProps | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [theme, setThemeState] = React.useState<ThemePreference>("system");
    const [mounted, setMounted] = React.useState(false);
    const [systemTheme, setSystemTheme] = React.useState<"light" | "dark">(
        "light",
    );

    React.useLayoutEffect(() => {
        setMounted(true);
        setThemeState(parseTheme(localStorage.getItem(STORAGE_KEY)));
        setSystemTheme(getSystemTheme());
    }, []);

    React.useEffect(() => {
        if (!mounted) return;
        const sync = () => setSystemTheme(getSystemTheme());
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        mq.addEventListener("change", sync);
        return () => mq.removeEventListener("change", sync);
    }, [mounted]);

    const resolvedTheme: "light" | "dark" | undefined = React.useMemo(() => {
        if (!mounted) return undefined;
        return theme === "system" ? systemTheme : theme;
    }, [theme, mounted, systemTheme]);

    React.useLayoutEffect(() => {
        if (!mounted || resolvedTheme === undefined) return;
        applyDomTheme(resolvedTheme);
    }, [mounted, resolvedTheme]);

    React.useEffect(() => {
        const onStorage = (e: StorageEvent) => {
            if (e.key !== STORAGE_KEY) return;
            setThemeState(parseTheme(e.newValue));
        };
        window.addEventListener("storage", onStorage);
        return () => window.removeEventListener("storage", onStorage);
    }, []);

    const setTheme = React.useCallback(
        (value: React.SetStateAction<string>) => {
            setThemeState((prev) => {
                const next =
                    typeof value === "function"
                        ? (value as (p: string) => string)(prev)
                        : value;
                const parsed = parseTheme(next);
                try {
                    localStorage.setItem(STORAGE_KEY, parsed);
                } catch {
                    /* ignore */
                }
                return parsed;
            });
        },
        [],
    );

    const value = React.useMemo(
        (): UseThemeProps => ({
            themes: ["light", "dark", "system"],
            theme: mounted ? theme : undefined,
            setTheme,
            resolvedTheme,
            systemTheme: mounted ? systemTheme : undefined,
        }),
        [mounted, theme, resolvedTheme, setTheme, systemTheme],
    );

    return (
        <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
    );
}

export function useTheme(): UseThemeProps {
    const ctx = React.useContext(ThemeContext);
    if (ctx === undefined) {
        throw new Error("useTheme must be used within ThemeProvider");
    }
    return ctx;
}

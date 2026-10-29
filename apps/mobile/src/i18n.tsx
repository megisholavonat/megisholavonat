import {
    DEFAULT_LOCALE,
    LOCALES,
    type Locale,
} from "@megisholavonat/core/i18n";
import { useLocales } from "expo-localization";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import en from "../messages/en.json";
import hu from "../messages/hu.json";
import { useSettings } from "./settings/SettingsProvider";

const MESSAGES = { hu, en } satisfies Record<Locale, typeof hu>;

declare module "use-intl" {
    interface AppConfig {
        Locale: Locale;
        Messages: typeof hu;
    }
}

function isLocale(code: string | null): code is Locale {
    return LOCALES.includes(code as Locale);
}

/** First device language we support, else Hungarian. */
export function useDeviceLocale(): Locale {
    const locales = useLocales();
    const match = locales.find((l) => isLocale(l.languageCode));
    return (match?.languageCode as Locale | undefined) ?? DEFAULT_LOCALE;
}

/** The language setting, else the device language. */
export function useAppLocale(): Locale {
    const device = useDeviceLocale();
    return useSettings().settings.language ?? device;
}

export function I18nProvider({ children }: { children: ReactNode }) {
    const locale = useAppLocale();
    return (
        <IntlProvider
            locale={locale}
            messages={MESSAGES[locale]}
            timeZone="Europe/Budapest"
        >
            {children}
        </IntlProvider>
    );
}

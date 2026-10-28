"use client";

import { useTranslations } from "next-intl";
import { Switch } from "@/components/ui/switch";
import { useAnalyticsConsent } from "@/hooks/useAnalyticsConsent";

export default function AnalyticsConsentSwitch() {
    const t = useTranslations("AnalyticsConsentSwitch");
    const [consent, setConsent] = useAnalyticsConsent();

    return (
        <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
                <p id="analytics-consent-label" className="text-sm font-medium">
                    {t("label")}
                </p>
                <p
                    id="analytics-consent-description"
                    className="text-sm text-muted-foreground"
                >
                    {t("description")}
                </p>
            </div>
            <Switch
                checked={consent === "granted"}
                disabled={consent === null}
                onCheckedChange={(checked) =>
                    setConsent(checked ? "granted" : "denied")
                }
                aria-labelledby="analytics-consent-label"
                aria-describedby="analytics-consent-description"
            />
        </div>
    );
}

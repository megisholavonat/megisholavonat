import type { Alert, InfoService } from "@megisholavonat/api-client";
import type { DelayLevel } from "@megisholavonat/core/delay";
import {
    DELAY_REASONS,
    type DelayReasonCode,
} from "@megisholavonat/core/delayReasons";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useFormatter, useLocale, useTranslations } from "use-intl";
import { withAlpha } from "../theme/palette";
import { type AppTheme, useAppTheme } from "../theme/ThemeProvider";
import { Icon, type IconName, isIconName } from "../ui/Icon";
import { MNR2007_FONT } from "./RouteIcon";
import { serviceGlyph } from "./trainData";

// Parts of the train sheet: the delay reason, MÁV's alerts and services.

const LONG_ALERT_CHARS = 150;

function reasonIcon(code: DelayReasonCode | null | undefined): IconName {
    const icon = code ? DELAY_REASONS[code]?.icon : null;
    return icon && isIconName(icon) ? icon : "warning";
}

function toneColors(theme: AppTheme, tone: DelayLevel | "stale") {
    if (tone === "stale") {
        return { text: theme.stale.text, fill: theme.stale.fill };
    }
    return { text: theme.delay[tone].text, fill: theme.delay[tone].fill };
}

/**
 * "Késés oka: Más vonat": the cause of a delay, with its icon, tinted by
 * the train's delay level. Only shown for a train that is actually late.
 */
export function ReasonLine({
    reason,
    tone,
    compact = false,
}: {
    reason: DelayReasonCode;
    tone: DelayLevel | "stale";
    /** Board and commute rows: plain text, no tile */
    compact?: boolean;
}) {
    const theme = useAppTheme();
    const t = useTranslations("Train");
    const locale = useLocale();
    const label = DELAY_REASONS[reason][locale];
    const text = t("reason", { reason: label });
    const colors = toneColors(theme, tone);
    if (compact) {
        return (
            <View style={styles.compact} accessible accessibilityLabel={text}>
                <Icon name={reasonIcon(reason)} size={14} color={colors.text} />
                <Text
                    style={[styles.compactText, { color: colors.text }]}
                    numberOfLines={1}
                >
                    {text}
                </Text>
            </View>
        );
    }
    return (
        <View
            style={[
                styles.reason,
                {
                    backgroundColor: withAlpha(
                        colors.fill,
                        theme.dark ? 0.2 : 0.12,
                    ),
                },
            ]}
            accessible
            accessibilityLabel={text}
        >
            <Icon name={reasonIcon(reason)} size={20} color={colors.text} />
            <Text style={[styles.reasonText, { color: colors.text }]}>
                {text}
            </Text>
        </View>
    );
}

/** One MÁV alert: the full text, its validity and the "more" link. */
function AlertCard({ alert }: { alert: Alert }) {
    const theme = useAppTheme();
    const t = useTranslations("Train");
    const format = useFormatter();
    const [expanded, setExpanded] = useState(false);
    const text = alert.alertDescriptionText.trim();
    // About three lines at the sheet's width; longer texts open on tap
    const truncated = text.length > LONG_ALERT_CHARS;
    const range = (seconds: number) =>
        format.dateTime(new Date(seconds * 1000), {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    const validity =
        alert.effectiveStartDate > 0 && alert.effectiveEndDate > 0
            ? t("valid", {
                  from: range(alert.effectiveStartDate),
                  to: range(alert.effectiveEndDate),
              })
            : null;
    const url = alert.alertUrl;
    return (
        <View
            style={[styles.alert, { backgroundColor: theme.colors.surface2 }]}
        >
            <Icon
                name={reasonIcon(alert.reason?.code)}
                size={18}
                color={theme.colors.ink2}
                style={styles.alertIcon}
            />
            <View style={styles.flex}>
                <Pressable
                    onPress={() => setExpanded((v) => !v)}
                    disabled={!truncated}
                    accessibilityRole={truncated ? "button" : "text"}
                    accessibilityHint={
                        truncated && !expanded ? t("expand") : undefined
                    }
                >
                    <Text
                        style={[styles.alertText, { color: theme.colors.ink }]}
                        numberOfLines={expanded || !truncated ? undefined : 3}
                    >
                        {text}
                    </Text>
                </Pressable>
                {validity ? (
                    <Text
                        style={[
                            styles.validity,
                            theme.tabularNums,
                            { color: theme.colors.ink2 },
                        ]}
                    >
                        {validity}
                    </Text>
                ) : null}
                {url ? (
                    <Pressable
                        onPress={() => WebBrowser.openBrowserAsync(url)}
                        accessibilityRole="link"
                        hitSlop={8}
                        style={({ pressed }) => [
                            styles.link,
                            pressed && Platform.OS === "ios" && styles.pressed,
                        ]}
                    >
                        <Text
                            style={[
                                styles.linkText,
                                { color: theme.colors.ink },
                            ]}
                        >
                            {t("more_info")}
                        </Text>
                        <Icon
                            name="external"
                            size={13}
                            color={theme.colors.ink}
                        />
                    </Pressable>
                ) : null}
            </View>
        </View>
    );
}

/** Every MÁV alert of the trip, reasons first. */
export function AlertList({ alerts }: { alerts: Alert[] }) {
    if (alerts.length === 0) return null;
    return (
        <View style={styles.alerts}>
            {alerts.map((alert, index) => (
                <AlertCard
                    // biome-ignore lint/suspicious/noArrayIndexKey: alerts have no id
                    key={`${index}-${alert.effectiveStartDate}`}
                    alert={alert}
                />
            ))}
        </View>
    );
}

/** Services for the whole trip: MÁV pictogram and name. */
export function ServiceList({ services }: { services: InfoService[] }) {
    const theme = useAppTheme();
    const t = useTranslations("Train");
    if (services.length === 0) return null;
    return (
        <View style={styles.services} accessibilityLabel={t("services")}>
            {services.map((service) => (
                <View
                    key={`${service.fontCode}-${service.name}`}
                    style={[
                        styles.service,
                        { backgroundColor: theme.colors.surface2 },
                    ]}
                    accessible
                    accessibilityLabel={service.name}
                >
                    <Text
                        style={[styles.glyph, { color: theme.colors.ink }]}
                        allowFontScaling={false}
                    >
                        {serviceGlyph(service)}
                    </Text>
                    <Text
                        style={[
                            styles.serviceName,
                            { color: theme.colors.ink },
                        ]}
                        numberOfLines={1}
                    >
                        {service.name}
                    </Text>
                </View>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    flex: { flex: 1 },
    reason: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    reasonText: { flex: 1, fontSize: 15, fontWeight: "600" },
    compact: { flexDirection: "row", alignItems: "center", gap: 5 },
    compactText: { fontSize: 13, fontWeight: "600", flexShrink: 1 },
    alerts: { gap: 8 },
    alert: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    alertIcon: { marginTop: 1 },
    alertText: { fontSize: 14, lineHeight: 19 },
    validity: { fontSize: 12, marginTop: 6 },
    link: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        marginTop: 8,
        alignSelf: "flex-start",
    },
    linkText: {
        fontSize: 14,
        fontWeight: "600",
        textDecorationLine: "underline",
    },
    pressed: { opacity: 0.6 },
    services: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    service: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        minHeight: 30,
        paddingHorizontal: 10,
        borderRadius: 15,
        maxWidth: "100%",
    },
    glyph: { fontFamily: MNR2007_FONT, fontSize: 17 },
    serviceName: { fontSize: 13, fontWeight: "500", flexShrink: 1 },
});

import { getRunSummaryOptions } from "@megisholavonat/api-client/react-query";
import {
    type DelaySummary,
    delaySummary,
    delaySummaryShareText,
    delaySummaryUrl,
    type RunStops,
} from "@megisholavonat/core/delaySummary";
import { useQuery } from "@tanstack/react-query";
import { Platform, Pressable, Share, StyleSheet, Text } from "react-native";
import { useLocale, useTranslations } from "use-intl";
import { WEB_URL } from "../config";
import { useAppTheme } from "../theme/ThemeProvider";
import { Icon } from "../ui/Icon";

export interface DelayShareTarget {
    number: string;
    /** The run's service date (its departure from the origin) */
    date: string;
    stops?: RunStops;
}

/**
 * The run's delay card (the web's `useDelaySummary`), refreshed while it is
 * on its way; null until there is a delay or a cancellation to tell.
 */
function useDelayCard(target: DelayShareTarget | null): DelaySummary | null {
    const { data } = useQuery({
        ...getRunSummaryOptions({
            path: {
                trainNumber: target?.number ?? "",
                serviceDate: target?.date ?? "",
            },
            query: target?.stops?.from
                ? { from: target.stops.from }
                : undefined,
        }),
        enabled: !!target,
        staleTime: 60_000,
        refetchInterval: (query) =>
            query.state.data?.finished ? false : 120_000,
        retry: false,
    });
    if (!data || !target) return null;
    const card = delaySummary(data, target.stops);
    return card.outcome === "unknown" ? null : card;
}

/** The native share sheet with the card link and its sentence. */
function useShare(target: DelayShareTarget | null, card: DelaySummary | null) {
    const locale = useLocale();
    const t = useTranslations("Train");
    return () => {
        if (!target || !card) return;
        const url = delaySummaryUrl(
            WEB_URL,
            locale,
            target.number,
            target.date,
            target.stops,
        );
        const text = delaySummaryShareText(locale, card);
        // iOS shares the URL as a link; Android only takes text
        Share.share(
            Platform.OS === "ios"
                ? { message: text, url }
                : { message: t("share_text", { train: text, url }) },
        );
    };
}

/** "Megosztom a késést" under the train sheet's actions, once it has left. */
export function DelayShareRow({ target }: { target: DelayShareTarget | null }) {
    const theme = useAppTheme();
    const t = useTranslations("DelayCard");
    const card = useDelayCard(target);
    const share = useShare(target, card);
    if (!card) return null;
    return (
        <Pressable
            onPress={share}
            accessibilityRole="button"
            android_ripple={{ color: theme.colors.line }}
            style={({ pressed }) => [
                styles.row,
                { backgroundColor: theme.colors.surface2 },
                pressed && Platform.OS === "ios" && { opacity: 0.6 },
            ]}
        >
            <Icon name="share" size={18} color={theme.colors.ink} />
            <Text style={[styles.label, { color: theme.colors.ink }]}>
                {card.soFar ? t("share_so_far") : t("share")}
            </Text>
        </Pressable>
    );
}

/** The share icon of a commute row, once the run is over. */
export function DelayShareIcon({
    target,
}: {
    target: DelayShareTarget | null;
}) {
    const theme = useAppTheme();
    const t = useTranslations("DelayCard");
    const card = useDelayCard(target);
    const share = useShare(target, card);
    if (!card || card.soFar) return null;
    return (
        <Pressable
            onPress={share}
            accessibilityRole="button"
            accessibilityLabel={t("share")}
            hitSlop={8}
            style={({ pressed }) => [styles.icon, pressed && { opacity: 0.6 }]}
        >
            <Icon name="share" size={20} color={theme.colors.ink2} />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: {
        minHeight: 44,
        borderRadius: 12,
        paddingHorizontal: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        overflow: "hidden",
    },
    label: { fontSize: 15, fontWeight: "600" },
    icon: {
        width: 36,
        height: 36,
        alignItems: "center",
        justifyContent: "center",
    },
});

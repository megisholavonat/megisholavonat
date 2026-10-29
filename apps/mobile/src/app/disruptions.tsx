import { sortDisruptions } from "@megisholavonat/core/disruptions";
import { useMemo } from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";
import { useTranslations } from "use-intl";
import { DisruptionCard } from "../disruptions/DisruptionViews";
import { interestsOf } from "../disruptions/disruptions";
import { useDisruptions } from "../disruptions/useDisruptions";
import { useFollows } from "../follow/store";
import { useAppTheme } from "../theme/ThemeProvider";
import { StateBlock } from "../ui/ds";
import { useTrackOnOpen } from "../useAnalytics";

/**
 * Line and network disruptions, the user's own trains first. A sheet over
 * the map on iOS, a screen with an app bar on Android (see the root layout).
 */
export default function DisruptionsScreen() {
    const theme = useAppTheme();
    const t = useTranslations("Disruptions");
    const disruptions = useDisruptions();
    const follows = useFollows();
    const sorted = useMemo(
        () => sortDisruptions(disruptions, interestsOf(follows)),
        [disruptions, follows],
    );
    useTrackOnOpen("disruptions_opened", {
        surface: "screen",
        count: disruptions.length,
    });
    const radius = Platform.OS === "ios" ? theme.radii.lg : 20;
    return (
        <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            contentContainerStyle={styles.content}
        >
            {sorted.length === 0 ? (
                <StateBlock icon="noTrains" title={t("empty")} />
            ) : (
                <View
                    style={[
                        styles.list,
                        {
                            backgroundColor: theme.colors.surface,
                            borderRadius: radius,
                        },
                    ]}
                >
                    {sorted.map(({ disruption, mine }) => (
                        <DisruptionCard
                            key={disruption.id}
                            disruption={disruption}
                            mine={mine}
                        />
                    ))}
                </View>
            )}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    content: { padding: 16 },
    list: { overflow: "hidden" },
});

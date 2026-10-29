import { FieldGroup, ListItem, Picker, Switch } from "@expo/ui";
import {
    FilterChip,
    FlowRow,
    LoadingIndicator,
    RNHostView,
    Text,
} from "@expo/ui/jetpack-compose";
import { Stack } from "expo-router";
import { Pressable, Text as RNText, StyleSheet, View } from "react-native";
import { useTranslations } from "use-intl";
import { useAppTheme } from "../theme/ThemeProvider";
import { ComposeHost } from "../ui/ComposeHost";
import { StateBlock } from "../ui/ds";
import { Icon } from "../ui/Icon";
import { FollowHeader } from "./FollowHeader";
import type { FollowForm as Form_ } from "./useFollowForm";

/** M3 full-screen dialog bar: ✕ on the left, a filled "Mentés" on the right. */
function Header({ form }: { form: Form_ }) {
    const theme = useAppTheme();
    const t = useTranslations("Follow");
    const tc = useTranslations("Common");
    return (
        <Stack.Screen
            options={{
                headerLeft: () => (
                    <Pressable
                        onPress={form.close}
                        accessibilityRole="button"
                        accessibilityLabel={tc("close")}
                        android_ripple={{
                            color: theme.colors.line,
                            borderless: true,
                        }}
                        style={styles.close}
                    >
                        <Icon name="close" size={24} color={theme.colors.ink} />
                    </Pressable>
                ),
                headerRight: () => (
                    <Pressable
                        onPress={form.save}
                        disabled={!form.canSave}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: !form.canSave }}
                        android_ripple={{ color: theme.colors.line }}
                        style={[
                            styles.save,
                            {
                                backgroundColor: theme.colors.action,
                                opacity: form.canSave ? 1 : 0.38,
                            },
                        ]}
                    >
                        <RNText
                            style={[
                                styles.saveLabel,
                                { color: theme.colors.onAction },
                            ]}
                        >
                            {t("save")}
                        </RNText>
                    </Pressable>
                ),
            }}
        />
    );
}

/** Android: a Material 3 connected list in Compose (design board 4). */
export function FollowForm({ form }: { form: Form_ }) {
    const theme = useAppTheme();
    const t = useTranslations("Follow");
    const tt = useTranslations("Train");
    const { draft } = form;

    if (form.notFound || !draft) {
        return (
            <View style={styles.center}>
                <Header form={form} />
                {form.notFound ? (
                    <StateBlock icon="warning" title={tt("not_found")} />
                ) : (
                    <ComposeHost matchContents>
                        <LoadingIndicator />
                    </ComposeHost>
                )}
            </View>
        );
    }

    return (
        <>
            <Header form={form} />
            <ComposeHost style={StyleSheet.absoluteFill}>
                <FieldGroup>
                    <FieldGroup.Section>
                        <RNHostView matchContents>
                            <View style={styles.header}>
                                <FollowHeader form={form} />
                            </View>
                        </RNHostView>
                    </FieldGroup.Section>
                    <FieldGroup.Section title={t("days")}>
                        {draft.weekdays.length === 0 ? (
                            <FieldGroup.SectionFooter>
                                <Text color={theme.colors.ink2}>
                                    {t("today_only")}
                                </Text>
                            </FieldGroup.SectionFooter>
                        ) : null}
                        <FlowRow horizontalArrangement={{ spacedBy: 6 }}>
                            {form.weekdays.map((d) => (
                                <FilterChip
                                    key={d.day}
                                    selected={d.selected}
                                    onClick={() => form.toggleDay(d.day)}
                                >
                                    {d.selected ? (
                                        <FilterChip.LeadingIcon>
                                            <Text>✓</Text>
                                        </FilterChip.LeadingIcon>
                                    ) : null}
                                    <FilterChip.Label>
                                        <Text>{d.label}</Text>
                                    </FilterChip.Label>
                                </FilterChip>
                            ))}
                        </FlowRow>
                    </FieldGroup.Section>
                    <FieldGroup.Section title={t("board")}>
                        <Picker
                            selectedValue={draft.from}
                            onValueChange={form.setFrom}
                        >
                            {form.boardOptions.map((o) => (
                                <Picker.Item
                                    key={o.value}
                                    label={o.label}
                                    value={o.value}
                                />
                            ))}
                        </Picker>
                    </FieldGroup.Section>
                    <FieldGroup.Section title={t("alight")}>
                        <Picker
                            selectedValue={draft.to}
                            onValueChange={form.setTo}
                        >
                            {form.alightOptions.map((o) => (
                                <Picker.Item
                                    key={o.value}
                                    label={o.label}
                                    value={o.value}
                                />
                            ))}
                        </Picker>
                    </FieldGroup.Section>
                    {form.notificationsDenied ? (
                        <FieldGroup.Section>
                            <ListItem onPress={form.openSettings}>
                                {t("notifications_off")}
                            </ListItem>
                        </FieldGroup.Section>
                    ) : null}
                    <FieldGroup.Section title={t("delay")}>
                        <Picker
                            selectedValue={draft.delayThresholdMin}
                            onValueChange={form.setThreshold}
                        >
                            {form.thresholds.map((o) => (
                                <Picker.Item
                                    key={o.value}
                                    label={o.label}
                                    value={o.value}
                                />
                            ))}
                        </Picker>
                    </FieldGroup.Section>
                    <FieldGroup.Section>
                        <ListItem
                            onPress={() =>
                                form.setPlatform(!draft.notifyPlatformChange)
                            }
                            trailing={
                                <Switch
                                    value={draft.notifyPlatformChange}
                                    onValueChange={form.setPlatform}
                                />
                            }
                        >
                            {t("platform")}
                        </ListItem>
                    </FieldGroup.Section>
                    {form.existing ? (
                        <FieldGroup.Section>
                            <ListItem onPress={form.remove}>
                                <Text color={theme.delay.severe.text}>
                                    {t("unfollow")}
                                </Text>
                            </ListItem>
                        </FieldGroup.Section>
                    ) : null}
                </FieldGroup>
            </ComposeHost>
        </>
    );
}

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    header: { paddingVertical: 8 },
    close: {
        width: 48,
        height: 48,
        alignItems: "center",
        justifyContent: "center",
        marginLeft: -8,
    },
    save: {
        minHeight: 40,
        paddingHorizontal: 18,
        borderRadius: 20,
        justifyContent: "center",
        overflow: "hidden",
    },
    saveLabel: { fontSize: 14, fontWeight: "600" },
});

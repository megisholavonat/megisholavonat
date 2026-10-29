import {
    Button,
    Form,
    Host,
    HStack,
    Image,
    Picker,
    ProgressView,
    RNHostView,
    Section,
    Spacer,
    Text,
    Toggle,
} from "@expo/ui/swift-ui";
import {
    accessibilityAddTraits,
    accessibilityLabel,
    background,
    buttonStyle,
    font,
    foregroundStyle,
    frame,
    pickerStyle,
    shapes,
    tag,
} from "@expo/ui/swift-ui/modifiers";
import { Stack } from "expo-router";
import { StyleSheet } from "react-native";
import { useTranslations } from "use-intl";
import { useAppTheme } from "../theme/ThemeProvider";
import { StateBlock } from "../ui/ds";
import { FollowHeader } from "./FollowHeader";
import type { FollowForm as Form_ } from "./useFollowForm";

/** H K Sze Cs P Szo V as round toggles: ink when on (design board 4). */
function Days({ form }: { form: Form_ }) {
    const theme = useAppTheme();
    return (
        <HStack>
            {form.weekdays.flatMap((d, i) => [
                ...(i > 0 ? [<Spacer key={`gap-${d.day}`} />] : []),
                <Button
                    key={d.day}
                    onPress={() => form.toggleDay(d.day)}
                    modifiers={[
                        buttonStyle("plain"),
                        accessibilityLabel(d.name),
                        ...(d.selected
                            ? [accessibilityAddTraits(["isSelected"])]
                            : []),
                    ]}
                >
                    <Text
                        modifiers={[
                            font({ size: 14, weight: "semibold" }),
                            foregroundStyle(
                                d.selected
                                    ? theme.colors.onAction
                                    : theme.colors.ink,
                            ),
                            frame({ width: 40, height: 40 }),
                            background(
                                d.selected
                                    ? theme.colors.action
                                    : theme.colors.surface2,
                                shapes.circle(),
                            ),
                        ]}
                    >
                        {d.label}
                    </Text>
                </Button>,
            ])}
        </HStack>
    );
}

/** iOS: a SwiftUI grouped Form with ✕ and ✓ in the navigation bar. */
export function FollowForm({ form }: { form: Form_ }) {
    const t = useTranslations("Follow");
    const tc = useTranslations("Common");
    const tt = useTranslations("Train");
    const { draft } = form;

    return (
        <>
            <Stack.Toolbar placement="left">
                <Stack.Toolbar.Button
                    icon="xmark"
                    accessibilityLabel={tc("close")}
                    onPress={form.close}
                />
            </Stack.Toolbar>
            <Stack.Toolbar placement="right">
                <Stack.Toolbar.Button
                    icon="checkmark"
                    variant="prominent"
                    accessibilityLabel={t("save")}
                    disabled={!form.canSave}
                    onPress={form.save}
                />
            </Stack.Toolbar>
            {form.notFound ? (
                <StateBlock icon="warning" title={tt("not_found")} />
            ) : !draft ? (
                <Host style={StyleSheet.absoluteFill}>
                    <ProgressView />
                </Host>
            ) : (
                <Host style={StyleSheet.absoluteFill}>
                    <Form>
                        <Section>
                            <RNHostView matchContents>
                                <FollowHeader form={form} />
                            </RNHostView>
                        </Section>
                        <Section
                            title={t("days")}
                            footer={
                                draft.weekdays.length === 0 ? (
                                    <Text>{t("today_only")}</Text>
                                ) : undefined
                            }
                        >
                            <Days form={form} />
                        </Section>
                        <Section>
                            <Picker
                                label={t("board")}
                                selection={draft.from}
                                onSelectionChange={form.setFrom}
                                modifiers={[pickerStyle("menu")]}
                            >
                                {form.boardOptions.map((o) => (
                                    <Text
                                        key={o.value}
                                        modifiers={[tag(o.value)]}
                                    >
                                        {o.label}
                                    </Text>
                                ))}
                            </Picker>
                            <Picker
                                label={t("alight")}
                                selection={draft.to}
                                onSelectionChange={form.setTo}
                                modifiers={[pickerStyle("menu")]}
                            >
                                {form.alightOptions.map((o) => (
                                    <Text
                                        key={o.value}
                                        modifiers={[tag(o.value)]}
                                    >
                                        {o.label}
                                    </Text>
                                ))}
                            </Picker>
                        </Section>
                        <Section title={t("alerts")}>
                            {form.notificationsDenied ? (
                                <Button onPress={form.openSettings}>
                                    <HStack spacing={8}>
                                        <Image systemName="bell.slash" />
                                        <Text>{t("notifications_off")}</Text>
                                        <Spacer />
                                        <Image
                                            systemName="arrow.up.right"
                                            modifiers={[
                                                foregroundStyle({
                                                    type: "hierarchical",
                                                    style: "secondary",
                                                }),
                                            ]}
                                        />
                                    </HStack>
                                </Button>
                            ) : null}
                            <Picker
                                label={t("delay")}
                                selection={draft.delayThresholdMin}
                                onSelectionChange={form.setThreshold}
                                modifiers={[pickerStyle("menu")]}
                            >
                                {form.thresholds.map((o) => (
                                    <Text
                                        key={o.value}
                                        modifiers={[tag(o.value)]}
                                    >
                                        {o.label}
                                    </Text>
                                ))}
                            </Picker>
                            <Toggle
                                label={t("platform")}
                                isOn={draft.notifyPlatformChange}
                                onIsOnChange={form.setPlatform}
                            />
                            {form.liveActivityOffered ? (
                                <Toggle
                                    label={t("live_activity")}
                                    isOn={draft.liveActivity}
                                    onIsOnChange={form.setLiveActivity}
                                />
                            ) : null}
                        </Section>
                        {form.existing ? (
                            <Section>
                                {/* biome-ignore lint/a11y/useValidAriaRole: SwiftUI button role */}
                                <Button
                                    role="destructive"
                                    label={t("unfollow")}
                                    onPress={form.remove}
                                />
                            </Section>
                        ) : null}
                    </Form>
                </Host>
            )}
        </>
    );
}

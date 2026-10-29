import {
    Button,
    Form,
    Host,
    HStack,
    Picker,
    Section,
    Spacer,
    Text,
    Toggle,
} from "@expo/ui/swift-ui";
import { foregroundStyle, pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";
import { StyleSheet } from "react-native";
import { useSettingsRows } from "./useSettingsRows";

/** A tappable row with a trailing grey value, like iOS Settings. */
function ValueRow({
    label,
    value,
    onPress,
}: {
    label: string;
    value?: string;
    onPress: () => void;
}) {
    return (
        <Button onPress={onPress}>
            <HStack>
                <Text
                    modifiers={[
                        foregroundStyle({
                            type: "hierarchical",
                            style: "primary",
                        }),
                    ]}
                >
                    {label}
                </Text>
                <Spacer />
                {value ? (
                    <Text
                        modifiers={[
                            foregroundStyle({
                                type: "hierarchical",
                                style: "secondary",
                            }),
                        ]}
                    >
                        {value}
                    </Text>
                ) : null}
            </HStack>
        </Button>
    );
}

/** iOS: a SwiftUI grouped Form (design board 5). */
export function SettingsScreen() {
    const s = useSettingsRows();
    return (
        <Host style={StyleSheet.absoluteFill}>
            <Form>
                <Section>
                    <Picker
                        label={s.t("language")}
                        selection={s.language}
                        onSelectionChange={s.setLanguage}
                        modifiers={[pickerStyle("menu")]}
                    >
                        {s.languages.map((l) => (
                            <Text key={l.value} modifiers={[tag(l.value)]}>
                                {l.label}
                            </Text>
                        ))}
                    </Picker>
                    <Picker
                        label={s.t("theme")}
                        selection={s.settings.theme}
                        onSelectionChange={s.setTheme}
                        modifiers={[pickerStyle("menu")]}
                    >
                        {s.themes.map((theme) => (
                            <Text
                                key={theme.value}
                                modifiers={[tag(theme.value)]}
                            >
                                {theme.label}
                            </Text>
                        ))}
                    </Picker>
                </Section>
                <Section title={s.t("map")}>
                    <Toggle
                        label={s.t("detailed_railway_map")}
                        isOn={s.settings.detailedRailwayMap}
                        onIsOnChange={s.setDetailedRailwayMap}
                    />
                </Section>
                <Section>
                    <Toggle
                        label={s.t("analytics")}
                        isOn={s.settings.analytics === "granted"}
                        onIsOnChange={s.setAnalytics}
                    />
                    <ValueRow label={s.t("privacy")} onPress={s.openPrivacy} />
                </Section>
                <Section>
                    <ValueRow
                        label={s.t("map_data")}
                        value={s.t("map_data_value")}
                        onPress={s.openMapData}
                    />
                    <ValueRow
                        label={s.t("railway_data")}
                        value={s.t("railway_data_value")}
                        onPress={s.openRailwayData}
                    />
                    <ValueRow label={s.t("source")} onPress={s.openSource} />
                </Section>
            </Form>
        </Host>
    );
}

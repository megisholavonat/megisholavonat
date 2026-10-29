import { FieldGroup, ListItem, Switch } from "@expo/ui";
import {
    Column,
    SegmentedButton,
    SingleChoiceSegmentedButtonRow,
    Text,
} from "@expo/ui/jetpack-compose";
import { fillMaxWidth } from "@expo/ui/jetpack-compose/modifiers";
import { StyleSheet } from "react-native";
import { dynamicColorSupported } from "../theme/dynamicColor";
import { ComposeHost } from "../ui/ComposeHost";
import { useSettingsRows } from "./useSettingsRows";

/** A labelled Material 3 segmented button row (language, theme). */
function Choice<T extends string>({
    label,
    options,
    value,
    onChange,
}: {
    label: string;
    options: { value: T; label: string }[];
    value: T;
    onChange: (value: T) => void;
}) {
    return (
        <Column verticalArrangement={{ spacedBy: 8 }}>
            <Text style={{ typography: "bodyLarge" }}>{label}</Text>
            <SingleChoiceSegmentedButtonRow modifiers={[fillMaxWidth()]}>
                {options.map((option) => (
                    <SegmentedButton
                        key={option.value}
                        selected={option.value === value}
                        onClick={() => onChange(option.value)}
                    >
                        <SegmentedButton.Label>
                            <Text>{option.label}</Text>
                        </SegmentedButton.Label>
                    </SegmentedButton>
                ))}
            </SingleChoiceSegmentedButtonRow>
        </Column>
    );
}

/**
 * Android: a Material 3 connected list in Compose (design board 5), with the
 * "Dinamikus színek" switch (off by default) on Android 12+.
 */
export function SettingsScreen() {
    const s = useSettingsRows();
    return (
        <ComposeHost style={StyleSheet.absoluteFill}>
            <FieldGroup>
                <FieldGroup.Section>
                    <Choice
                        label={s.t("language")}
                        options={s.languages}
                        value={s.language}
                        onChange={s.setLanguage}
                    />
                    <Choice
                        label={s.t("theme")}
                        options={s.themes}
                        value={s.settings.theme}
                        onChange={s.setTheme}
                    />
                    {dynamicColorSupported ? (
                        <ListItem
                            onPress={() =>
                                s.setDynamicColor(!s.settings.dynamicColor)
                            }
                            trailing={
                                <Switch
                                    value={s.settings.dynamicColor}
                                    onValueChange={s.setDynamicColor}
                                />
                            }
                        >
                            {s.t("dynamic_color")}
                        </ListItem>
                    ) : null}
                </FieldGroup.Section>
                <FieldGroup.Section title={s.t("map")}>
                    <ListItem
                        onPress={() =>
                            s.setRailwayLayer(!s.settings.railwayLayer)
                        }
                        trailing={
                            <Switch
                                value={s.settings.railwayLayer}
                                onValueChange={s.setRailwayLayer}
                            />
                        }
                    >
                        {s.t("railways")}
                    </ListItem>
                </FieldGroup.Section>
                <FieldGroup.Section>
                    <ListItem
                        onPress={() =>
                            s.setAnalytics(s.settings.analytics !== "granted")
                        }
                        trailing={
                            <Switch
                                value={s.settings.analytics === "granted"}
                                onValueChange={s.setAnalytics}
                            />
                        }
                    >
                        {s.t("analytics")}
                    </ListItem>
                    <ListItem onPress={s.openPrivacy}>
                        {s.t("privacy")}
                    </ListItem>
                </FieldGroup.Section>
                <FieldGroup.Section>
                    <ListItem
                        onPress={s.openMapData}
                        supportingText={s.t("map_data_value")}
                    >
                        {s.t("map_data")}
                    </ListItem>
                    <ListItem
                        onPress={s.openRailwayData}
                        supportingText={s.t("railway_data_value")}
                    >
                        {s.t("railway_data")}
                    </ListItem>
                    <ListItem onPress={s.openSource}>{s.t("source")}</ListItem>
                </FieldGroup.Section>
            </FieldGroup>
        </ComposeHost>
    );
}

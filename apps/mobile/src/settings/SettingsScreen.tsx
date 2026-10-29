import { FieldGroup, ListItem, Switch } from "@expo/ui";
import {
    Column,
    SegmentedButton,
    SingleChoiceSegmentedButtonRow,
    Slider,
    Text,
} from "@expo/ui/jetpack-compose";
import { fillMaxWidth } from "@expo/ui/jetpack-compose/modifiers";
import { StyleSheet } from "react-native";
import { dynamicColorSupported } from "../theme/dynamicColor";
import { useAppTheme } from "../theme/ThemeProvider";
import { ComposeHost } from "../ui/ComposeHost";
import { type MapSwitch, useSettingsRows } from "./useSettingsRows";

/** A list row with a trailing switch; the whole row toggles it. */
function SwitchRow({
    label,
    value,
    onChange,
}: {
    label: string;
    value: boolean;
    onChange: (value: boolean) => void;
}) {
    return (
        <ListItem
            onPress={() => onChange(!value)}
            trailing={<Switch value={value} onValueChange={onChange} />}
        >
            {label}
        </ListItem>
    );
}

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
    const theme = useAppTheme();
    const mapSwitch = (
        key: MapSwitch,
        label: "station_names" | "animation" | "trains" | "hev" | "tramtrain",
    ) => (
        <SwitchRow
            label={s.t(label)}
            value={s.settings[key]}
            onChange={(on) => s.setMapSwitch(key, on)}
        />
    );
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
                            s.setDetailedRailwayMap(
                                !s.settings.detailedRailwayMap,
                            )
                        }
                        trailing={
                            <Switch
                                value={s.settings.detailedRailwayMap}
                                onValueChange={s.setDetailedRailwayMap}
                            />
                        }
                    >
                        {s.t("detailed_railway_map")}
                    </ListItem>
                    {mapSwitch("showStationNames", "station_names")}
                    {s.settings.showStationNames ? (
                        <Column verticalArrangement={{ spacedBy: 4 }}>
                            <Text style={{ typography: "bodyLarge" }}>
                                {s.t("station_names_opacity")}
                            </Text>
                            <Slider
                                value={s.settings.stationNamesOpacity}
                                min={s.opacityRange.min}
                                max={s.opacityRange.max}
                                // Values between the ends: 5, 10 … 95 %
                                steps={
                                    Math.round(
                                        (s.opacityRange.max -
                                            s.opacityRange.min) /
                                            s.opacityRange.step,
                                    ) - 1
                                }
                                onValueChange={s.setStationNamesOpacity}
                                onValueChangeFinished={
                                    s.commitStationNamesOpacity
                                }
                                modifiers={[fillMaxWidth()]}
                            />
                        </Column>
                    ) : null}
                    {mapSwitch("animateVehicles", "animation")}
                </FieldGroup.Section>
                <FieldGroup.Section title={s.t("vehicles")}>
                    {mapSwitch("showTrains", "trains")}
                    {mapSwitch("showHev", "hev")}
                    {mapSwitch("showTramTrains", "tramtrain")}
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
                <FieldGroup.Section>
                    <ListItem
                        onPress={s.deleting ? undefined : s.deleteData}
                        // Material's error red, as for destructive actions
                        colors={{ contentColor: theme.delay.severe.text }}
                    >
                        {s.t("delete_data")}
                    </ListItem>
                </FieldGroup.Section>
            </FieldGroup>
        </ComposeHost>
    );
}

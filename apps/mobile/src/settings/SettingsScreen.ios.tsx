import {
    Button,
    Form,
    Host,
    HStack,
    Picker,
    Section,
    Slider,
    Spacer,
    Text,
    Toggle,
} from "@expo/ui/swift-ui";
import {
    disabled,
    foregroundStyle,
    pickerStyle,
    tag,
} from "@expo/ui/swift-ui/modifiers";
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
                    <Toggle
                        label={s.t("station_names")}
                        isOn={s.settings.showStationNames}
                        onIsOnChange={(on) =>
                            s.setMapSwitch("showStationNames", on)
                        }
                    />
                    {s.settings.showStationNames ? (
                        <HStack spacing={12}>
                            <Text>{s.t("station_names_opacity")}</Text>
                            <Slider
                                value={s.settings.stationNamesOpacity}
                                min={s.opacityRange.min}
                                max={s.opacityRange.max}
                                step={s.opacityRange.step}
                                onValueChange={s.setStationNamesOpacity}
                                onEditingChanged={(editing) => {
                                    if (!editing) {
                                        s.commitStationNamesOpacity();
                                    }
                                }}
                            />
                        </HStack>
                    ) : null}
                    <Toggle
                        label={s.t("animation")}
                        isOn={s.settings.animateVehicles}
                        onIsOnChange={(on) =>
                            s.setMapSwitch("animateVehicles", on)
                        }
                    />
                </Section>
                <Section title={s.t("vehicles")}>
                    <Toggle
                        label={s.t("trains")}
                        isOn={s.settings.showTrains}
                        onIsOnChange={(on) => s.setMapSwitch("showTrains", on)}
                    />
                    <Toggle
                        label={s.t("hev")}
                        isOn={s.settings.showHev}
                        onIsOnChange={(on) => s.setMapSwitch("showHev", on)}
                    />
                    <Toggle
                        label={s.t("tramtrain")}
                        isOn={s.settings.showTramTrains}
                        onIsOnChange={(on) =>
                            s.setMapSwitch("showTramTrains", on)
                        }
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
                <Section>
                    {/* biome-ignore lint/a11y/useValidAriaRole: SwiftUI button role */}
                    <Button
                        role="destructive"
                        label={s.t("delete_data")}
                        onPress={s.deleteData}
                        modifiers={[disabled(s.deleting)]}
                    />
                </Section>
            </Form>
        </Host>
    );
}

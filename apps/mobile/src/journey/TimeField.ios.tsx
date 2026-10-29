import { Button, DatePicker, Host, HStack, Spacer } from "@expo/ui/swift-ui";
import {
    buttonStyle,
    controlSize,
    environment,
    labelsHidden,
} from "@expo/ui/swift-ui/modifiers";
import { useTranslations } from "use-intl";
import { liquidGlass } from "../ui/platform";
import type { TimeFieldProps } from "./TimeField.types";

/** iOS: the compact SwiftUI date and time picker, plus "Now" once changed. */
export function TimeField({ value, onChange }: TimeFieldProps) {
    const t = useTranslations("Journey");
    return (
        <Host
            matchContents={{ vertical: true }}
            style={{ alignSelf: "stretch" }}
        >
            <HStack spacing={8}>
                <DatePicker
                    selection={new Date(value ?? Date.now())}
                    displayedComponents={["date", "hourAndMinute"]}
                    onDateChange={(date) => onChange(date.getTime())}
                    // Train times are Budapest times, also on a visitor's
                    // phone still set to home time
                    modifiers={[
                        labelsHidden(),
                        environment("timeZone", "Europe/Budapest"),
                    ]}
                />
                <Spacer />
                {value !== null ? (
                    <Button
                        label={t("now")}
                        onPress={() => onChange(null)}
                        modifiers={[
                            buttonStyle(liquidGlass ? "glass" : "bordered"),
                            controlSize("regular"),
                        ]}
                    />
                ) : null}
            </HStack>
        </Host>
    );
}

import { Button, Host, HStack } from "@expo/ui/swift-ui";
import {
    buttonStyle,
    controlSize,
    labelStyle,
} from "@expo/ui/swift-ui/modifiers";
import { useTranslations } from "use-intl";
import { liquidGlass } from "../ui/platform";
import type { TrainActionsProps } from "./TrainActions.types";

/**
 * SwiftUI buttons: Liquid Glass (`.glass`) on iOS 26, the bordered system
 * style before it. The follow action joins here with the commute feature.
 */
export function TrainActions({ onShare, onTicket }: TrainActionsProps) {
    const t = useTranslations("Train");
    const style = buttonStyle(liquidGlass ? "glass" : "bordered");
    return (
        <Host matchContents style={{ alignSelf: "flex-start" }}>
            <HStack spacing={8}>
                <Button
                    label={t("share")}
                    systemImage="square.and.arrow.up"
                    onPress={onShare}
                    modifiers={[
                        style,
                        controlSize("large"),
                        labelStyle("iconOnly"),
                    ]}
                />
                <Button
                    label={t("ticket")}
                    systemImage="arrow.up.right"
                    onPress={onTicket}
                    modifiers={[style, controlSize("large")]}
                />
            </HStack>
        </Host>
    );
}

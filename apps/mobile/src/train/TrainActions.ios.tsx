import { Button, Host, HStack, Label } from "@expo/ui/swift-ui";
import {
    buttonStyle,
    controlSize,
    foregroundStyle,
    frame,
    labelStyle,
    tint,
} from "@expo/ui/swift-ui/modifiers";
import { useTranslations } from "use-intl";
import { useAppTheme } from "../theme/ThemeProvider";
import { liquidGlass } from "../ui/platform";
import type { TrainActionsProps } from "./TrainActions.types";

/**
 * SwiftUI buttons: Liquid Glass (`.glass`) on iOS 26, the bordered system
 * style before it. Follow is the prominent ink button until the train is
 * followed (design board 2).
 */
export function TrainActions({
    following,
    onFollow,
    onShare,
    onTicket,
}: TrainActionsProps) {
    const t = useTranslations("Train");
    const tf = useTranslations("Follow");
    const theme = useAppTheme();
    const style = buttonStyle(liquidGlass ? "glass" : "bordered");
    const prominent = buttonStyle(
        liquidGlass ? "glassProminent" : "borderedProminent",
    );
    return (
        <Host
            matchContents={{ vertical: true }}
            style={{ alignSelf: "stretch" }}
        >
            <HStack spacing={8}>
                <Button
                    onPress={onFollow}
                    modifiers={[
                        following ? style : prominent,
                        tint(theme.colors.action),
                        controlSize("large"),
                    ]}
                >
                    {/* The label fills the row, so the button does too */}
                    <Label
                        title={tf(following ? "following" : "follow")}
                        systemImage={following ? "star.fill" : "star"}
                        modifiers={[
                            frame({ maxWidth: Number.POSITIVE_INFINITY }),
                            // Ink is light in dark mode: the label follows
                            ...(following
                                ? []
                                : [foregroundStyle(theme.colors.onAction)]),
                        ]}
                    />
                </Button>
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

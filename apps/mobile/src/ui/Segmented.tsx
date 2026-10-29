import {
    SegmentedButton,
    SingleChoiceSegmentedButtonRow,
    Text,
} from "@expo/ui/jetpack-compose";
import { fillMaxWidth } from "@expo/ui/jetpack-compose/modifiers";
import { ComposeHost } from "./ComposeHost";
import type { SegmentedProps } from "./Segmented.types";

/** Android: Material 3 single-choice segmented buttons. iOS: Segmented.ios.tsx. */
export function Segmented<T extends string>({
    options,
    value,
    onChange,
}: SegmentedProps<T>) {
    return (
        <ComposeHost
            matchContents={{ vertical: true }}
            style={{ alignSelf: "stretch" }}
        >
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
        </ComposeHost>
    );
}

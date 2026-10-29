import { type DelayLevel, getDelayLevel } from "@megisholavonat/core/delay";

// Text colours of the design-system delay scale; `darkBg` is for text on an
// always-dark header. See the `--color-delay-*` theme tokens in globals.css.
const DELAY_CLASSES: Record<DelayLevel, { default: string; darkBg: string }> = {
    severe: {
        default: "text-delay-severe",
        darkBg: "text-delay-severe-on-dark",
    },
    moderate: {
        default: "text-delay-moderate",
        darkBg: "text-delay-moderate-on-dark",
    },
    slight: {
        default: "text-delay-slight",
        darkBg: "text-delay-slight-on-dark",
    },
    onTime: {
        default: "text-delay-on-time",
        darkBg: "text-delay-on-time-on-dark",
    },
};

export function getDelayColor(delay: number, darkBg: boolean = false): string {
    const classes = DELAY_CLASSES[getDelayLevel(delay)];
    return darkBg ? classes.darkBg : classes.default;
}

import { type DelayLevel, getDelayLevel } from "@megisholavonat/core/delay";

const DELAY_CLASSES: Record<DelayLevel, { default: string; darkBg: string }> = {
    severe: { default: "text-red-600", darkBg: "text-red-400" },
    moderate: { default: "text-orange-500", darkBg: "text-orange-300" },
    slight: {
        default: "text-yellow-700 dark:text-yellow-400",
        darkBg: "text-yellow-200",
    },
    onTime: { default: "text-green-600", darkBg: "text-green-400" },
};

export function getDelayColor(delay: number, darkBg: boolean = false): string {
    const classes = DELAY_CLASSES[getDelayLevel(delay)];
    return darkBg ? classes.darkBg : classes.default;
}

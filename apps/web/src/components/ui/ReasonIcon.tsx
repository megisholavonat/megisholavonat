import {
    DELAY_REASONS,
    type DelayReasonCode,
} from "@megisholavonat/core/delayReasons";
import {
    Bus,
    CircleAlert,
    CloudLightning,
    Construction,
    GitMerge,
    Globe,
    Hammer,
    HardHat,
    ListOrdered,
    type LucideIcon,
    Shield,
    Siren,
    Split,
    Timer,
    TrafficCone,
    TrainFront,
    TriangleAlert,
    Wrench,
    ZapOff,
} from "lucide-react";

// The lucide names packages/core suggests for each reason
const ICONS: Record<string, LucideIcon> = {
    construction: Construction,
    wrench: Wrench,
    "train-front": TrainFront,
    timer: Timer,
    globe: Globe,
    "git-merge": GitMerge,
    "traffic-cone": TrafficCone,
    "circle-alert": CircleAlert,
    "cloud-lightning": CloudLightning,
    "hard-hat": HardHat,
    siren: Siren,
    split: Split,
    "list-ordered": ListOrdered,
    "zap-off": ZapOff,
    shield: Shield,
    hammer: Hammer,
    bus: Bus,
};

export function ReasonIcon({
    code,
    className,
}: {
    code: DelayReasonCode | null;
    className?: string;
}) {
    const Icon = (code && ICONS[DELAY_REASONS[code].icon]) || TriangleAlert;
    return <Icon className={className} aria-hidden />;
}

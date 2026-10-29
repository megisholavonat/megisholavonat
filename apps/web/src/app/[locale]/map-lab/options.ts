import type { ColorScheme } from "@megisholavonat/core/tokens";
import type { Basemap } from "./styles";

export type RailMode = "off" | "ours" | "orm";
export type LabelMode = "off" | "poi" | "ours";
export type MarkerVariant = "current" | "calm";
export type ViewId = "hu" | "bp" | "keleti" | "line" | "border" | "zahony";

export interface LabOptions {
    basemap: Basemap;
    /** null: follow the system / app setting */
    theme: ColorScheme | null;
    rail: RailMode;
    labels: LabelMode;
    markers: MarkerVariant;
    focus: boolean;
    onlyLate: boolean;
    onlyFollowed: boolean;
    view: ViewId;
}

/** The recommended combination, also the lab's default */
export const RECOMMENDED: LabOptions = {
    basemap: "transit",
    theme: null,
    rail: "ours",
    labels: "ours",
    markers: "calm",
    focus: true,
    onlyLate: false,
    onlyFollowed: false,
    view: "hu",
};

/** What production shows today */
export const TODAY: Partial<LabOptions> = {
    basemap: "current",
    rail: "orm",
    labels: "off",
    markers: "current",
    focus: false,
};

export const VIEWS: Record<
    ViewId,
    {
        label: string;
        /** [west, south, east, north] */
        bounds?: [number, number, number, number];
        center?: [number, number];
        zoom?: number;
    }
> = {
    hu: { label: "Hungary", bounds: [16.1, 45.72, 22.9, 48.6] },
    bp: { label: "Budapest", bounds: [18.88, 47.36, 19.32, 47.64] },
    keleti: { label: "Keleti", center: [19.0835, 47.5005], zoom: 14 },
    line: { label: "Szolnok–Debrecen", bounds: [20.1, 47.1, 21.7, 47.6] },
    border: { label: "Hegyeshalom", bounds: [16.95, 47.78, 17.4, 48.06] },
    zahony: { label: "Záhony", bounds: [21.95, 48.3, 22.45, 48.5] },
};

const pick = <T extends string>(
    value: string | null,
    allowed: readonly T[],
    fallback: T,
): T => (allowed.includes(value as T) ? (value as T) : fallback);

export function readOptions(params: URLSearchParams): LabOptions {
    const r = RECOMMENDED;
    const flag = (key: string, fallback: boolean) =>
        params.has(key) ? params.get(key) === "1" : fallback;
    return {
        basemap: pick(
            params.get("base"),
            ["current", "quiet", "transit", "protomaps"] as const,
            r.basemap,
        ),
        theme:
            params.get("theme") === "dark"
                ? "dark"
                : params.get("theme") === "light"
                  ? "light"
                  : null,
        rail: pick(params.get("rail"), ["off", "ours", "orm"] as const, r.rail),
        labels: pick(
            params.get("labels"),
            ["off", "poi", "ours"] as const,
            r.labels,
        ),
        markers: pick(
            params.get("markers"),
            ["current", "calm"] as const,
            r.markers,
        ),
        focus: flag("focus", r.focus),
        onlyLate: flag("late", false),
        onlyFollowed: flag("followed", false),
        view: pick(params.get("view"), Object.keys(VIEWS) as ViewId[], r.view),
    };
}

export function writeOptions(o: LabOptions, extra: URLSearchParams): string {
    const p = new URLSearchParams();
    p.set("base", o.basemap);
    if (o.theme) p.set("theme", o.theme);
    p.set("rail", o.rail);
    p.set("labels", o.labels);
    p.set("markers", o.markers);
    p.set("focus", o.focus ? "1" : "0");
    if (o.onlyLate) p.set("late", "1");
    if (o.onlyFollowed) p.set("followed", "1");
    p.set("view", o.view);
    for (const [k, v] of extra) p.set(k, v);
    return p.toString();
}

"use client";

import {
    getTrainDetailsOptions,
    getTrainsOptions,
} from "@megisholavonat/api-client/react-query";
import { POLL_INTERVAL_MS } from "@megisholavonat/core/constants";
import type { ColorScheme } from "@megisholavonat/core/tokens";
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { MapProvider } from "react-map-gl/maplibre";
import {
    followedVehicleIds,
    useCommute,
} from "@/components/commute/useCommute";
import { RouteGlyph } from "@/components/ui/RouteGlyph";
import { useTheme } from "@/components/ui/ThemeProvider";
import { useFollows } from "@/hooks/useFollows";
import { useIsDesktop } from "@/hooks/useIsMobile";
import { cn } from "@/lib/utils";
import { contrastRows } from "./contrast";
import {
    type LabOptions,
    RECOMMENDED,
    readOptions,
    TODAY,
    VIEWS,
    type ViewId,
    writeOptions,
} from "./options";

const LabMap = dynamic(() => import("./LabMap"), {
    ssr: false,
    loading: () => <div className="h-full w-full bg-map" />,
});

const PANEL_W = 300;

function Segmented<T extends string>({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: T;
    options: readonly (readonly [T, string])[];
    onChange: (v: T) => void;
}) {
    return (
        <div className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-ink-2">{label}</span>
            <div
                role="radiogroup"
                aria-label={label}
                className="flex rounded-[10px] bg-surface-2 p-0.5"
            >
                {options.map(([v, text]) => (
                    // biome-ignore lint/a11y/useSemanticElements: segment
                    <button
                        key={v}
                        type="button"
                        role="radio"
                        aria-checked={v === value}
                        onClick={() => onChange(v)}
                        className={cn(
                            "min-h-8 flex-1 rounded-[8px] px-1.5 text-[12px] font-semibold text-ink-2",
                            v === value && "bg-surface text-ink shadow-sm",
                        )}
                    >
                        {text}
                    </button>
                ))}
            </div>
        </div>
    );
}

function Toggle({
    label,
    checked,
    onChange,
}: {
    label: string;
    checked: boolean;
    onChange: (v: boolean) => void;
}) {
    return (
        <label className="flex min-h-8 items-center justify-between gap-2 text-[13px] text-ink">
            {label}
            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                className="size-4 accent-[var(--mhav-action)]"
            />
        </label>
    );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="flex flex-col gap-2 border-line border-t pt-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-ink-2">
                {title}
            </h2>
            {children}
        </section>
    );
}

/** Tile requests by host since the page loaded, for the performance notes */
function useTileStats(): Record<string, number> {
    const [stats, setStats] = useState<Record<string, number>>({});
    useEffect(() => {
        const hosts: [RegExp, string][] = [
            [/tiles\.openfreemap\.org\/planet/, "OFM vector"],
            [/tiles\.openfreemap\.org\/fonts/, "glyphs"],
            [/tiles\.openfreemap\.org\/natural_earth/, "OFM relief"],
            [/megisholavonat\.info\/orm|openrailwaymap/, "ORM raster"],
            [/localhost:3478|\.mvt/, "Protomaps"],
        ];
        const counts: Record<string, number> = {};
        const obs = new PerformanceObserver((list) => {
            let changed = false;
            for (const e of list.getEntries()) {
                const hit = hosts.find(([re]) => re.test(e.name));
                if (!hit) continue;
                counts[hit[1]] = (counts[hit[1]] ?? 0) + 1;
                changed = true;
            }
            if (changed) setStats({ ...counts });
        });
        obs.observe({ type: "resource", buffered: true });
        return () => obs.disconnect();
    }, []);
    return stats;
}

export function MapLab() {
    const [opts, setOpts] = useState<LabOptions>(RECOMMENDED);
    const [panel, setPanel] = useState(true);
    const [ready, setReady] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const { resolvedTheme, setTheme } = useTheme();
    const isDesktop = useIsDesktop();
    const tiles = useTileStats();

    // Options come from the URL once, then go back into it on every change
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        setOpts(readOptions(params));
        setPanel(params.get("panel") !== "0");
        setSelectedId(params.get("vehicleId"));
        setReady(true);
    }, []);
    useEffect(() => {
        if (!ready) return;
        const extra = new URLSearchParams();
        if (!panel) extra.set("panel", "0");
        if (selectedId) extra.set("vehicleId", selectedId);
        window.history.replaceState(
            null,
            "",
            `${window.location.pathname}?${writeOptions(opts, extra)}`,
        );
    }, [opts, panel, selectedId, ready]);
    useEffect(() => {
        if (opts.theme) setTheme(opts.theme);
    }, [opts.theme, setTheme]);

    const scheme: ColorScheme =
        opts.theme ?? (resolvedTheme === "dark" ? "dark" : "light");
    const set = <K extends keyof LabOptions>(key: K, value: LabOptions[K]) =>
        setOpts((o) => ({ ...o, [key]: value }));

    const trainsQuery = useQuery({
        ...getTrainsOptions(),
        refetchInterval: POLL_INTERVAL_MS,
    });
    const trains = trainsQuery.data;
    const details = useQuery({
        ...getTrainDetailsOptions({ path: { vehicle_id: selectedId ?? "" } }),
        enabled: !!selectedId,
        refetchInterval: selectedId ? 5000 : false,
        retry: 1,
    });
    const follows = useFollows();
    const commute = useCommute(follows, trains);
    const followedKey = [...followedVehicleIds(commute)].sort().join(",");
    const followedIds = useMemo(
        () => new Set(followedKey ? followedKey.split(",") : []),
        [followedKey],
    );
    const selected = trains?.features.find(
        (f) => f.properties.vehicleId === selectedId,
    )?.properties;
    const rows = contrastRows(opts.basemap, scheme);
    const showPanel = panel && isDesktop;
    const insets = useMemo(
        () => ({ bottom: 0, left: showPanel ? PANEL_W + 16 : 0 }),
        [showPanel],
    );
    const late = trains?.features.filter((f) => f.properties.delay >= 5).length;

    if (!ready) return <div className="h-dvh w-full bg-map" />;

    return (
        <MapProvider>
            <main className="relative h-dvh w-full overflow-hidden bg-map">
                <LabMap
                    lab={opts}
                    scheme={scheme}
                    trains={trains}
                    selectedId={selectedId}
                    followedIds={followedIds}
                    onSelectTrain={setSelectedId}
                    train={details.data}
                    station={null}
                    flyTarget={null}
                    insets={insets}
                    isDesktop={isDesktop}
                    panelOpen={showPanel}
                />
                {showPanel && (
                    <aside
                        className="absolute top-3 bottom-3 left-3 z-20 flex flex-col gap-3 overflow-y-auto rounded-[14px] bg-surface p-4 text-ink shadow-lg"
                        style={{ width: PANEL_W }}
                    >
                        <header className="flex items-start justify-between gap-2">
                            <div>
                                <h1 className="text-[17px] font-semibold">
                                    Map lab
                                </h1>
                                <p className="text-[12px] text-ink-2">
                                    {trains
                                        ? `${trains.features.length} trains live · ${late} late`
                                        : "Loading trains…"}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setPanel(false)}
                                className="min-h-8 rounded-[8px] px-2 text-[12px] font-semibold text-ink-2 hover:bg-surface-2"
                            >
                                Hide
                            </button>
                        </header>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() =>
                                    setOpts((o) => ({ ...o, ...TODAY }))
                                }
                                className={cn(
                                    "min-h-9 flex-1 rounded-[10px] border border-line text-[13px] font-semibold",
                                )}
                            >
                                Today
                            </button>
                            <button
                                type="button"
                                onClick={() =>
                                    setOpts((o) => ({
                                        ...RECOMMENDED,
                                        theme: o.theme,
                                        view: o.view,
                                    }))
                                }
                                className="min-h-9 flex-1 rounded-[10px] bg-action text-[13px] font-semibold text-on-action"
                            >
                                Recommended
                            </button>
                        </div>

                        <Section title="View">
                            <div className="grid grid-cols-3 gap-1">
                                {(Object.keys(VIEWS) as ViewId[]).map((v) => (
                                    <button
                                        key={v}
                                        type="button"
                                        onClick={() => set("view", v)}
                                        aria-pressed={opts.view === v}
                                        className={cn(
                                            "min-h-8 rounded-[8px] bg-surface-2 px-1 text-[12px] font-semibold text-ink-2",
                                            opts.view === v &&
                                                "bg-action text-on-action",
                                        )}
                                    >
                                        {VIEWS[v].label}
                                    </button>
                                ))}
                            </div>
                            <Segmented
                                label="Theme"
                                value={scheme}
                                options={[
                                    ["light", "Light"],
                                    ["dark", "Dark"],
                                ]}
                                onChange={(v) => set("theme", v)}
                            />
                        </Section>

                        <Section title="Map">
                            <Segmented
                                label="Basemap"
                                value={opts.basemap}
                                options={[
                                    ["current", "Today"],
                                    ["quiet", "Quiet"],
                                    ["transit", "Transit"],
                                    ["protomaps", "Protomaps"],
                                ]}
                                onChange={(v) => set("basemap", v)}
                            />
                            <Segmented
                                label="Rail network"
                                value={opts.rail}
                                options={[
                                    ["off", "Off"],
                                    ["ours", "Ours"],
                                    ["orm", "ORM raster"],
                                ]}
                                onChange={(v) => set("rail", v)}
                            />
                            <Segmented
                                label="Station names"
                                value={opts.labels}
                                options={[
                                    ["off", "Off"],
                                    ["poi", "OSM POI"],
                                    ["ours", "Ours"],
                                ]}
                                onChange={(v) => set("labels", v)}
                            />
                        </Section>

                        <Section title="Trains">
                            <Segmented
                                label="Markers"
                                value={opts.markers}
                                options={[
                                    ["current", "Today"],
                                    ["calm", "Calm on time"],
                                ]}
                                onChange={(v) => set("markers", v)}
                            />
                            <Toggle
                                label="Focus the selected train"
                                checked={opts.focus}
                                onChange={(v) => set("focus", v)}
                            />
                            <Toggle
                                label="Only late trains"
                                checked={opts.onlyLate}
                                onChange={(v) => set("onlyLate", v)}
                            />
                            <Toggle
                                label="Only followed trains"
                                checked={opts.onlyFollowed}
                                onChange={(v) => set("onlyFollowed", v)}
                            />
                        </Section>

                        <Section title="Contrast vs land">
                            <table className="w-full text-[12px] tabular-nums">
                                <tbody>
                                    {rows.map((r) => (
                                        <tr key={r.label}>
                                            <td className="py-0.5">
                                                <span
                                                    className="mr-1.5 inline-block size-2.5 rounded-full align-middle"
                                                    style={{
                                                        background: r.fg,
                                                        boxShadow: `0 0 0 1px ${r.bg}`,
                                                    }}
                                                />
                                                {r.label}
                                            </td>
                                            <td
                                                className={cn(
                                                    "text-right font-semibold",
                                                    r.ratio < r.target &&
                                                        "text-delay-severe",
                                                )}
                                            >
                                                {r.ratio.toFixed(2)}:1
                                            </td>
                                            <td className="w-10 text-right text-ink-2">
                                                ≥{r.target}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </Section>

                        <Section title="Tile requests">
                            <p className="text-[12px] text-ink-2 tabular-nums">
                                {Object.entries(tiles)
                                    .map(([k, v]) => `${k} ${v}`)
                                    .join(" · ") || "None yet"}
                            </p>
                        </Section>
                    </aside>
                )}
                {!showPanel && isDesktop && (
                    <button
                        type="button"
                        onClick={() => setPanel(true)}
                        className="absolute top-3 left-3 z-20 min-h-9 rounded-[10px] bg-surface px-3 text-[13px] font-semibold text-ink shadow-lg"
                    >
                        Lab
                    </button>
                )}
                {selected && (
                    <div className="absolute right-3 bottom-8 z-20 flex items-center gap-2 rounded-[14px] bg-surface px-3 py-2 text-ink shadow-lg">
                        <RouteGlyph
                            routeShortName={selected.routeShortName}
                            className="text-[22px]"
                        />
                        <span className="text-[15px] font-semibold">
                            {selected.tripShortName}
                        </span>
                        <span className="text-[13px] text-ink-2 tabular-nums">
                            {selected.delay >= 1
                                ? `+${Math.round(selected.delay)} min`
                                : "on time"}
                        </span>
                        <button
                            type="button"
                            onClick={() => setSelectedId(null)}
                            className="ml-1 min-h-8 rounded-[8px] px-2 text-[12px] font-semibold text-ink-2 hover:bg-surface-2"
                        >
                            Close
                        </button>
                    </div>
                )}
            </main>
        </MapProvider>
    );
}
